"""Contactes: canvis bruscos de la trajectòria de la pilota, reforçats pel so dels cops.

Un contacte (servei, recepció, col·locació, atac, bloqueig, defensa) canvia de
cop la velocitat de la pilota; el punt més alt d'una paràbola, en canvi, és un
canvi suau. Es combina amb els cops detectats a l'àudio: un canvi de
trajectòria amb un cop a menys de ~0,15 s és un contacte gairebé segur, i un
cop sense pilota visible (oclusió) es manté com a contacte possible.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .ball import Candidate
from .calibration import side_of_v
from .players import PlayerTrack


@dataclass
class Contact:
    t: float
    x: float | None  # px del vídeo original
    y: float | None
    score: float
    audio: bool
    visual: bool
    track: int | None = None  # jugador més proper
    side: str | None = None  # equip ('H' / 'A') segons la posició del jugador o de la pilota
    u: float | None = None  # posició a terra del jugador (m, coordenades de càmera)
    v: float | None = None


def trajectory_breaks(
    path: list[Candidate],
    min_angle: float = 25.0,
    max_gap: float = 0.25,
    window: int = 4,
    min_disp: float = 6.0,
) -> list[tuple[float, float, float, float]]:
    """(t, x, y, força) on la trajectòria de la pilota es trenca (contacte).

    En vol lliure, a curt termini la trajectòria a la imatge s'ajusta bé a una
    paràbola (també al punt més alt i quan la pilota s'allunya i sembla que
    frena per la perspectiva). Un contacte, en canvi, hi fa una punta: l'ajust
    parabòlic d'una finestra centrada en el contacte té un error gran, i la
    direcció abans i després canvia. Es demanen les dues coses.
    """
    out = []
    n = len(path)
    for i in range(window, n - window):
        seg = path[i - window : i + window + 1]
        if any(q.t - p.t > max_gap for p, q in zip(seg, seg[1:])):
            continue
        t = np.array([p.t for p in seg]) - path[i].t
        xy = np.array([[p.x, p.y] for p in seg])
        a, b, c = path[i - window], path[i], path[i + window]
        d1 = np.array([b.x - a.x, b.y - a.y])
        d2 = np.array([c.x - b.x, c.y - b.y])
        n1, n2 = np.linalg.norm(d1), np.linalg.norm(d2)
        if n1 < min_disp or n2 < min_disp:
            continue
        ang = np.degrees(np.arccos(np.clip(np.dot(d1, d2) / (n1 * n2), -1, 1)))
        if ang < min_angle:
            continue
        # Error de l'ajust parabòlic de tota la finestra, respecte al soroll esperat
        res = []
        for k in range(2):
            coef = np.polyfit(t, xy[:, k], 2)
            res.append(xy[:, k] - np.polyval(coef, t))
        rms = float(np.sqrt(np.mean(np.square(res))))
        noise = max(1.5, 0.15 * float(np.mean([p.size for p in seg])))
        kink = rms / noise
        if kink < 1.2:
            continue
        strength = float(min(1.0, 0.5 * min(1.0, ang / 90) + 0.5 * min(1.0, kink / 6)))
        # Canvi de direcció local (±2 fotogrames) per situar el contacte amb precisió
        loc = 0.0
        if 2 <= i < n - 2:
            e1 = np.array([b.x - path[i - 2].x, b.y - path[i - 2].y])
            e2 = np.array([path[i + 2].x - b.x, path[i + 2].y - b.y])
            m1, m2 = np.linalg.norm(e1), np.linalg.norm(e2)
            if m1 > 1e-6 and m2 > 1e-6:
                loc = float(np.degrees(np.arccos(np.clip(np.dot(e1, e2) / (m1 * m2), -1, 1))))
        out.append((b.t, b.x, b.y, strength, loc))
    # Un sol contacte per tram (0,2 s): la força és la màxima del tram, i el
    # moment, el del canvi de direcció local més gran
    merged: list[list[float]] = []
    for e in out:
        if merged and e[0] - merged[-1][0] < 0.2:
            m = merged[-1]
            if e[4] > m[4]:
                m[0], m[1], m[2], m[4] = e[0], e[1], e[2], e[4]
            m[3] = max(m[3], e[3])
        else:
            merged.append(list(e))
    return [(m[0], m[1], m[2], m[3]) for m in merged]


def fuse(
    breaks: list[tuple[float, float, float, float]],
    onsets: list[tuple[float, float]],
    tol: float = 0.15,
    min_audio_only: float = 0.6,
    min_visual_only: float = 0.55,
) -> list[Contact]:
    """Combina trencaments de trajectòria i cops d'àudio.

    Trencament + cop → contacte segur. Només trencament → es manté si és fort
    (quan la pilota és lluny, el soroll de posició fa trencaments febles falsos).
    Només cop fort → contacte possible (pilota tapada).
    """
    contacts: list[Contact] = []
    used: set[int] = set()
    for t, x, y, s in breaks:
        best, bd = -1, tol
        for j, (ta, _) in enumerate(onsets):
            if j in used:
                continue
            d = abs(ta - t)
            if d <= bd:
                best, bd = j, d
        if best >= 0:
            used.add(best)
            ta, sa = onsets[best]
            contacts.append(Contact((t + ta) / 2, x, y, min(1.0, 0.55 + 0.25 * s + 0.2 * sa), True, True))
        elif s >= min_visual_only:
            contacts.append(Contact(t, x, y, 0.35 + 0.3 * s, False, True))
    for j, (ta, sa) in enumerate(onsets):
        if j not in used and sa >= min_audio_only:
            contacts.append(Contact(ta, None, None, 0.25 + 0.2 * sa, True, False))
    contacts.sort(key=lambda c: c.t)
    return contacts


def ball_at(path: list[Candidate], t: float, max_dt: float = 0.2) -> Candidate | None:
    if not path:
        return None
    ts = np.array([c.t for c in path])
    i = int(np.argmin(np.abs(ts - t)))
    return path[i] if abs(ts[i] - t) <= max_dt else None


def attribute(contacts: list[Contact], tracks: list[PlayerTrack], path: list[Candidate], near_for, max_dt: float = 0.4) -> None:
    """Jugador més proper a la pilota en el moment del contacte, i equip.

    near_for(t) → equip ('H' / 'A') al costat de la càmera en aquell instant, o None si no se sap.
    """
    for c in contacts:
        if c.x is None:
            b = ball_at(path, c.t)
            if b:
                c.x, c.y = b.x, b.y
        best: tuple[float, PlayerTrack, object] | None = None
        for tr in tracks:
            samples = tr.samples
            ts = np.array([s.t for s in samples])
            i = int(np.argmin(np.abs(ts - c.t)))
            if abs(ts[i] - c.t) > max_dt:
                continue
            s = samples[i]
            x1, y1, x2, y2 = s.box
            hgt = max(y2 - y1, 1.0)
            if c.x is None:
                continue
            # Distància de la pilota al requadre ampliat (braços per sobre del cap)
            dx = max(x1 - c.x, 0, c.x - x2)
            dy = max(y1 - 0.6 * hgt - c.y, 0, c.y - y2)
            d = np.hypot(dx, dy) / hgt
            if d < 0.8 and (best is None or d < best[0]):
                best = (d, tr, s)
        if best:
            _, tr, s = best
            near = near_for(c.t)
            c.track = tr.id
            c.u, c.v = s.u, s.v
            c.side = side_of_v(s.v, near) if near else ("near" if s.v < 9 else "far")
            c.score = min(1.0, c.score + 0.1)
