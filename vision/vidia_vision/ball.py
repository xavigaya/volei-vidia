"""Pilota: candidats per moviment (diferència de tres fotogrames) i trajectòries.

Sense entrenament propi: la pilota és un objecte petit, gairebé rodó i que es
mou de pressa. Es busquen taques en moviment de la mida esperada (segons la
calibració) i s'enllacen en trajectòries amb predicció de velocitat. En la
fase 2 s'hi podrà afegir un detector entrenat amb els partits del club.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

BALL_DIAMETER = 0.21  # m


@dataclass
class Candidate:
    t: float
    x: float
    y: float
    size: float  # diàmetre aproximat (px)
    score: float


@dataclass
class Track:
    points: list[Candidate] = field(default_factory=list)
    misses: int = 0

    @property
    def last(self) -> Candidate:
        return self.points[-1]

    def predict(self, t: float) -> tuple[float, float]:
        p = self.points
        if len(p) < 2:
            return p[-1].x, p[-1].y
        a, b = p[-2], p[-1]
        dt = max(b.t - a.t, 1e-3)
        vx, vy = (b.x - a.x) / dt, (b.y - a.y) / dt
        h = t - b.t
        return b.x + vx * h, b.y + vy * h


class BallDetector:
    """Candidats per fotograma a partir de la diferència entre fotogrames consecutius."""

    def __init__(self, expected_diameter, diff_threshold: int = 18):
        # expected_diameter(x, y) → diàmetre esperat de la pilota en px a aquesta posició
        self.expected = expected_diameter
        self.thr = diff_threshold
        self.prev: list[np.ndarray] = []
        self.times: list[float] = []

    def push(self, t: float, frame_bgr: np.ndarray) -> list[Candidate]:
        g = cv2.GaussianBlur(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY), (3, 3), 0)
        self.prev.append(g)
        self.times.append(t)
        if len(self.prev) > 3:
            self.prev.pop(0)
            self.times.pop(0)
        if len(self.prev) < 3:
            return []
        a, b, c = self.prev
        d1 = cv2.absdiff(b, a)
        d2 = cv2.absdiff(c, b)
        m = cv2.bitwise_and((d1 > self.thr).astype(np.uint8), (d2 > self.thr).astype(np.uint8))
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
        n, _, stats, cents = cv2.connectedComponentsWithStats(m, connectivity=8)
        out: list[Candidate] = []
        for i in range(1, n):
            x, y, w, h, area = stats[i]
            cx, cy = cents[i]
            exp = max(self.expected(cx, cy), 2.0)
            size = float(max(w, h))
            if not (0.45 * exp <= size <= 2.6 * exp):
                continue
            fill = area / max(w * h, 1)
            aspect = min(w, h) / max(w, h)
            if fill < 0.35 or aspect < 0.35:  # massa allargat (desenfocament fort o una cama)
                continue
            score = float(aspect * min(1.0, fill / 0.7) * np.exp(-abs(np.log(size / exp))))
            out.append(Candidate(self.times[1], float(cx), float(cy), size, score))
        out.sort(key=lambda c: -c.score)
        return out[:12]


def link_tracks(
    per_frame: list[list[Candidate]],
    gate: float = 60.0,
    max_misses: int = 4,
    min_len: int = 5,
) -> list[Track]:
    """Enllaça candidats en trajectòries (veí més proper a la posició prevista)."""
    active: list[Track] = []
    done: list[Track] = []
    for cands in per_frame:
        if not cands:
            for tr in active:
                tr.misses += 1
        else:
            t = cands[0].t
            used: set[int] = set()
            # Primer les trajectòries més llargues
            for tr in sorted(active, key=lambda tr: -len(tr.points)):
                px, py = tr.predict(t)
                g = gate * (1 + 0.5 * tr.misses)
                best, bd = -1, g
                for i, c in enumerate(cands):
                    if i in used:
                        continue
                    d = np.hypot(c.x - px, c.y - py)
                    if d < bd:
                        best, bd = i, d
                if best >= 0:
                    tr.points.append(cands[best])
                    tr.misses = 0
                    used.add(best)
                else:
                    tr.misses += 1
            for i, c in enumerate(cands):
                if i not in used and c.score > 0.25:
                    active.append(Track([c]))
        still = []
        for tr in active:
            (done if tr.misses > max_misses else still).append(tr)
        active = still
    done.extend(active)
    return [tr for tr in done if len(tr.points) >= min_len]


def ball_path(tracks: list[Track]) -> list[Candidate]:
    """Una sola posició de la pilota per instant: la de la trajectòria més llarga i consistent."""
    best: dict[float, tuple[float, Candidate]] = {}
    for tr in tracks:
        q = len(tr.points) * float(np.mean([c.score for c in tr.points]))
        for c in tr.points:
            if c.t not in best or best[c.t][0] < q:
                best[c.t] = (q, c)
    return [best[t][1] for t in sorted(best)]


def expected_diameter_fn(cal, scale: float):
    """Diàmetre esperat de la pilota (px, a l'escala de processament) segons la posició a la imatge.

    S'aproxima amb l'escala de la pista a terra a sota d'aquell punt (la pilota
    sol ser més amunt i, per tant, una mica més a prop: es fa servir un marge ampli).
    """

    def f(x: float, y: float) -> float:
        X, Y = x / scale, y / scale
        try:
            uv = cal.image_to_court(np.array([[X, Y]]))[0]
            uv[1] = float(np.clip(uv[1], -2, 20))
            uv[0] = float(np.clip(uv[0], -2, 11))
            p0 = cal.court_to_image(np.array([uv]))[0]
            p1 = cal.court_to_image(np.array([[uv[0] + BALL_DIAMETER, uv[1]]]))[0]
            return float(np.hypot(*(p1 - p0))) * scale
        except Exception:  # noqa: BLE001
            return 6.0 * scale

    return f
