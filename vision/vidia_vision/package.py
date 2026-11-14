"""Lectura del paquet d'anàlisi exportat des de l'app (o d'una calibració sola).

Formats acceptats:
  * volei-vidia/analysis-package  (pestanya Anàlisi assistida → Exporta el paquet d'anàlisi)
  * volei-vidia/calibration       (apartat Calibració del vídeo → Exporta)
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .calibration import Calibration


@dataclass
class Rally:
    set: int
    index: int
    server: str
    server_player: int | None
    winner: str
    before: tuple[int, int]
    after: tuple[int, int]


@dataclass
class AnalysisPackage:
    match: dict = field(default_factory=dict)
    calibrations: list[Calibration] = field(default_factory=list)
    roster: list[dict] = field(default_factory=list)
    sets: list[dict] = field(default_factory=list)
    events: list[dict] = field(default_factory=list)
    # Seqüència de punts de l'acta, per set
    rallies: dict[int, list[Rally]] = field(default_factory=dict)

    @property
    def video_name(self) -> str | None:
        v = (self.match or {}).get("video") or {}
        return v.get("localName") if isinstance(v, dict) else v

    def set_at(self, t: float) -> int | None:
        """Set que es juga en un instant del vídeo, segons les accions codificades amb temps."""
        best: tuple[float, int] | None = None
        for e in self.events:
            vt = e.get("videoTime")
            if vt is None or vt > t:
                continue
            if best is None or vt >= best[0]:
                best = (vt, int(e.get("set", 0)))
        return best[1] if best else None

    def near_side(self, set_number: int | None, t: float) -> str:
        from .calibration import calibration_at

        cal = calibration_at(self.calibrations, t)
        if cal and set_number and set_number in cal.near_side:
            return cal.near_side[set_number]
        for s in self.sets:
            if s.get("number") == set_number and s.get("nearSide") in ("H", "A"):
                return s["nearSide"]
        return "H"


def load_package(path: str | Path) -> AnalysisPackage:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    fmt = data.get("format")
    pkg = AnalysisPackage()
    if fmt == "volei-vidia/calibration":
        pkg.match = data.get("match") or {}
        pkg.calibrations = [Calibration.from_json(c) for c in data.get("calibrations", [])]
    elif fmt == "volei-vidia/analysis-package":
        pkg.match = data.get("match") or {}
        pkg.calibrations = [Calibration.from_json(c) for c in data.get("calibrations", [])]
        pkg.roster = data.get("roster") or []
        pkg.sets = data.get("sets") or []
        pkg.events = data.get("events") or []
        for key, lst in (data.get("rallies") or {}).items():
            pkg.rallies[int(key)] = [
                Rally(
                    set=int(key),
                    index=int(r["index"]),
                    server=r["server"],
                    server_player=r.get("serverPlayer"),
                    winner=r["winner"],
                    before=(r["before"]["h"], r["before"]["a"]),
                    after=(r["after"]["h"], r["after"]["a"]),
                )
                for r in lst
            ]
    else:
        raise ValueError(f"format desconegut: {fmt!r} (cal un paquet d'anàlisi o una calibració de l'app)")
    if not pkg.calibrations:
        raise ValueError("el fitxer no té cap calibració: calibra el vídeo a l'app (Anàlisi assistida → Calibració del vídeo)")
    if not any(c.ground is not None for c in pkg.calibrations):
        raise ValueError("la calibració no té les 4 cantonades de la pista")
    return pkg
