"""Segmentació en jugades i lligam amb la seqüència de punts de l'acta.

Una jugada comença amb el xiulet de servei (o, si no se sent, amb el primer
contacte després d'una pausa) i acaba quan deixa d'haver-hi contactes durant
uns segons o quan torna a xiular l'àrbitre. Si el paquet porta l'acta, se
sap quantes jugades té cada set i qui serveix i guanya cadascuna: això limita
la segmentació i dona a cada jugada el servidor i el guanyador.
"""

from __future__ import annotations

import bisect
from dataclasses import dataclass, field

import numpy as np

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


def segment(
    contacts: list[Contact],
    whistles: list[tuple[float, float]],
    gap: float = 4.0,
    min_contacts: int = 2,
    max_len: float = 40.0,
) -> list[Segment]:
    """Agrupa els contactes en jugades.

    Es talla quan passen més de `gap` segons sense contactes o quan l'àrbitre xiula
    entre dos contactes (final del punt o autorització del servei). Una jugada ha de
    tenir almenys `min_contacts` contactes, un d'ells confirmat pel so. Les jugades
    més llargues que `max_len` (impossibles) es tallen pel buit més gran.
    """
    w_starts = sorted(a for a, _ in whistles)

    def whistle_between(t0: float, t1: float) -> bool:
        i = bisect.bisect_right(w_starts, t0 + 0.3)
        return i < len(w_starts) and w_starts[i] < t1 - 0.3

    def whistle_before(t: float) -> bool:
        i = bisect.bisect_right(w_starts, t) - 1
        return i >= 0 and t - w_starts[i] < 12

    groups: list[list[int]] = []
    for i, c in enumerate(contacts):
        if groups and c.t - contacts[groups[-1][-1]].t <= gap and not whistle_between(contacts[groups[-1][-1]].t, c.t):
            groups[-1].append(i)
        else:
            groups.append([i])

    # Jugades impossiblement llargues: es parteixen pel buit més gran
    def split(g: list[int]) -> list[list[int]]:
        if len(g) < 2 or contacts[g[-1]].t - contacts[g[0]].t <= max_len:
            return [g]
        gaps = [contacts[g[k + 1]].t - contacts[g[k]].t for k in range(len(g) - 1)]
        k = int(np.argmax(gaps))
        return split(g[: k + 1]) + split(g[k + 1 :])

    segs: list[Segment] = []
    for g in [h for g in groups for h in split(g)]:
        if not any(contacts[i].audio for i in g):
            continue
        wb = whistle_before(contacts[g[0]].t)
        # Un servei directe (ace o error) té un sol contacte: compta si hi ha xiulet de servei
        if len(g) < min_contacts and not wb:
            continue
        segs.append(Segment(start=contacts[g[0]].t, end=contacts[g[-1]].t, contacts=g, whistle=wb))
    return segs


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
