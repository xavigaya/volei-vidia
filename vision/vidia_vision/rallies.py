"""Segmentació en jugades i lligam amb la seqüència de punts de l'acta.

Una jugada comença amb el xiulet de servei (o, si no se sent, amb el primer
contacte després d'una pausa) i acaba quan deixa d'haver-hi contactes durant
uns segons o quan torna a xiular l'àrbitre. Si el paquet porta l'acta, se
sap quantes jugades té cada set i qui serveix i guanya cadascuna: això limita
la segmentació i dona a cada jugada el servidor i el guanyador.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .contacts import Contact
from .package import Rally as ActaRally


@dataclass
class Segment:
    start: float
    end: float
    contacts: list[int] = field(default_factory=list)  # índexs a la llista de contactes
    whistle: bool = False
    set: int | None = None
    index: int | None = None  # índex del punt dins el set (segons l'acta)
    server: str | None = None
    server_player: int | None = None
    winner: str | None = None
    score_before: tuple[int, int] | None = None

    @property
    def strength(self) -> float:
        return len(self.contacts) + (1.5 if self.whistle else 0)


def segment(contacts: list[Contact], whistles: list[tuple[float, float]], gap: float = 4.0, min_contacts: int = 2) -> list[Segment]:
    segs: list[Segment] = []
    cur: Segment | None = None
    w_starts = sorted(a for a, _ in whistles)
    wi = 0
    for i, c in enumerate(contacts):
        # Xiulet entre l'últim contacte i aquest: comença una jugada nova
        whistle_before = False
        while wi < len(w_starts) and w_starts[wi] <= c.t:
            if cur is None or w_starts[wi] > cur.end:
                whistle_before = c.t - w_starts[wi] < 12
            wi += 1
        if cur is None or c.t - cur.end > gap or (whistle_before and c.t - cur.end > 1.0):
            if cur is not None:
                segs.append(cur)
            cur = Segment(start=c.t, end=c.t, contacts=[i], whistle=whistle_before)
        else:
            cur.contacts.append(i)
            cur.end = c.t
    if cur is not None:
        segs.append(cur)
    return [s for s in segs if len(s.contacts) >= min_contacts or s.whistle]


def assign_sets(segs: list[Segment], set_at) -> None:
    for s in segs:
        s.set = set_at(s.start)


def match_acta(segs: list[Segment], acta: dict[int, list[ActaRally]]) -> dict:
    """Ajusta les jugades de cada set al nombre de punts de l'acta i hi posa servidor i guanyador.

    Si hi ha més segments que punts, es descarten els més febles (pocs contactes i
    sense xiulet); si n'hi ha menys, s'informa dels que falten.
    """
    report: dict[int, dict] = {}
    by_set: dict[int, list[Segment]] = {}
    for s in segs:
        if s.set is not None:
            by_set.setdefault(s.set, []).append(s)
    for set_no, rallies in acta.items():
        found = sorted(by_set.get(set_no, []), key=lambda s: s.start)
        expected = len(rallies)
        kept = found
        if len(found) > expected:
            strongest = sorted(found, key=lambda s: -s.strength)[:expected]
            keep_ids = {id(s) for s in strongest}
            kept = [s for s in found if id(s) in keep_ids]
            for s in found:
                if id(s) not in keep_ids:
                    s.set = None  # descartat
        for i, (s, r) in enumerate(zip(kept, rallies)):
            s.index = i
            s.server = r.server
            s.server_player = r.server_player
            s.winner = r.winner
            s.score_before = r.before
        report[set_no] = {"expected": expected, "found": len(found), "kept": len(kept), "missing": max(0, expected - len(found))}
    return report
