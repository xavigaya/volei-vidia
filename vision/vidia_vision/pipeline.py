"""Anàlisi completa d'un vídeo: àudio, pilota, jugadors, contactes i jugades."""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from . import __version__
from .audio import analyze_audio
from .ball import BallDetector, ball_path, expected_diameter_fn, link_tracks
from .calibration import Calibration, calibration_at
from .contacts import attribute, fuse, trajectory_breaks
from .media import audio_mono, frames, video_info
from .package import AnalysisPackage
from .players import Tracker, on_court
from .rallies import assign_sets, match_acta, segment


@dataclass
class Options:
    start: float = 0.0
    end: float | None = None
    ball_width: int = 960  # amplada de processament per a la pilota
    players: bool = True
    players_fps: float = 5.0  # deteccions de persones per segon
    device: str | None = None
    debug_video: str | None = None


def _progress(msg: str) -> None:
    print(msg, flush=True)


class CalLookup:
    """Calibració i set per a cada instant (amb la mida del vídeo real)."""

    def __init__(self, pkg: AnalysisPackage, width: int, height: int):
        self.pkg = pkg
        self.cals = [c.scaled(width, height) for c in pkg.calibrations]

    def __call__(self, t: float) -> Calibration:
        return calibration_at(self.cals, t)  # type: ignore[return-value]

    def set_at(self, t: float) -> int | None:
        return self.pkg.set_at(t)


def analyze(pkg: AnalysisPackage, video: str, opts: Options, progress: Callable[[str], None] = _progress) -> dict:
    t0 = time.time()
    info = video_info(video)
    end = opts.end if opts.end is not None else info.duration
    progress(f"Vídeo: {info.width}×{info.height}, {info.fps:.2f} fps, {info.duration / 60:.1f} min · analitzant {opts.start:.0f}–{end:.0f} s")
    cal_for = CalLookup(pkg, info.width, info.height)

    # --- Àudio ---------------------------------------------------------------
    progress("Àudio: cops i xiulets…")
    audio, rate = audio_mono(video, start=opts.start, end=end)
    aev = analyze_audio(audio, rate, offset=opts.start)
    progress(f"  {len(aev.onsets)} cops, {len(aev.whistles)} xiulets")

    # --- Vídeo: pilota i jugadors ---------------------------------------------
    scale = opts.ball_width / info.width
    detector = None
    if opts.players:
        try:
            from .players import PersonDetector

            detector = PersonDetector(device=opts.device)
            progress(f"Jugadors: detector de persones a {detector.device}")
        except Exception as e:  # noqa: BLE001
            progress(f"  ! Sense detecció de jugadors ({e}). Instal·la PyTorch amb install.ps1 o fes servir --no-players.")
    tracker = Tracker()
    every = max(1, int(round(info.fps / opts.players_fps)))
    ball_dets: dict[int, BallDetector] = {}
    per_frame = []
    writer = None
    if opts.debug_video:
        import cv2

        writer = cv2.VideoWriter(opts.debug_video, cv2.VideoWriter_fourcc(*"mp4v"), info.fps, (info.width // 2 * 2, info.height // 2 * 2))
    k = 0
    last_print = time.time()
    for t, img in frames(video, start=opts.start, end=end):
        cal = cal_for(t)
        key = id(cal)
        if key not in ball_dets:
            ball_dets[key] = BallDetector(expected_diameter_fn(cal, scale))
        small = img if scale == 1 else __import__("cv2").resize(img, (opts.ball_width, int(img.shape[0] * scale)))
        cands = ball_dets[key].push(t, small)
        for c in cands:
            c.x /= scale
            c.y /= scale
            c.size /= scale
        per_frame.append(cands)
        if detector is not None and k % every == 0:
            tracker.update(on_court(detector(img, t), cal))
        if writer is not None:
            _draw_debug(writer, img, cal, cands, tracker)
        k += 1
        if time.time() - last_print > 10:
            last_print = time.time()
            progress(f"  {t:.0f}/{end:.0f} s ({100 * (t - opts.start) / max(end - opts.start, 1):.0f} %)")
    if writer is not None:
        writer.release()

    # Radi de cerca en px del vídeo original (~60 px a l'amplada de processament)
    tracks = link_tracks(per_frame, gate=60.0 / scale)
    path = ball_path(tracks)
    players = tracker.tracks()
    progress(f"Pilota: {len(tracks)} trajectòries, {len(path)} posicions · jugadors: {len(players)} seguiments")

    # --- Contactes i jugades -------------------------------------------------
    breaks = trajectory_breaks(path)
    contacts = fuse(breaks, aev.onsets)
    def near_for(t: float):
        set_no = pkg.set_at(t)
        return pkg.near_side(set_no, t) if set_no else None

    attribute(contacts, players, path, near_for)
    segs = segment(contacts, aev.whistles)
    assign_sets(segs, pkg.set_at)
    report = match_acta(segs, pkg.rallies) if pkg.rallies else {}
    segs = [s for s in segs if s.set is not None or not pkg.rallies]
    progress(f"Contactes: {len(contacts)} · jugades: {len(segs)}")
    for set_no, r in sorted(report.items()):
        progress(f"  Set {set_no}: {r['found']} jugades trobades, {r['expected']} segons l'acta" + (f" (en falten {r['missing']})" if r["missing"] else ""))

    return {
        "format": "volei-vidia/vision-detections",
        "version": 1,
        "tool": {"name": "vidia-vision", "version": __version__},
        "video": {"name": Path(video).name, "width": info.width, "height": info.height, "fps": info.fps, "duration": info.duration},
        "range": {"start": opts.start, "end": end},
        "audio": {"onsets": [[round(t, 3), round(s, 3)] for t, s in aev.onsets], "whistles": [[round(a, 3), round(b, 3)] for a, b in aev.whistles]},
        "ball": [[round(c.t, 3), round(c.x, 1), round(c.y, 1), round(c.score, 3)] for c in path],
        "players": [
            {
                "id": tr.id,
                "samples": [[round(s.t, 3), round(s.u, 2), round(s.v, 2), *[round(b, 1) for b in s.box], round(s.score, 3)] for s in tr.samples],
            }
            for tr in players
        ],
        "contacts": [{k: (round(v, 3) if isinstance(v, float) else v) for k, v in asdict(c).items()} for c in contacts],
        "rallies": [
            {
                "set": s.set,
                "index": s.index,
                "start": round(s.start, 3),
                "end": round(s.end, 3),
                "contacts": s.contacts,
                "whistle": s.whistle,
                "server": s.server,
                "serverPlayer": s.server_player,
                "winner": s.winner,
                "scoreBefore": list(s.score_before) if s.score_before else None,
            }
            for s in segs
        ],
        "acta": {str(k): v for k, v in report.items()},
        "elapsed": round(time.time() - t0, 1),
    }


def _draw_debug(writer, img: np.ndarray, cal: Calibration, cands, tracker: Tracker) -> None:
    import cv2

    out = img.copy()
    # Pista projectada
    if cal.ground is not None:
        for a, b in [((0, 0), (9, 0)), ((9, 0), (9, 18)), ((9, 18), (0, 18)), ((0, 18), (0, 0)), ((0, 6), (9, 6)), ((0, 12), (9, 12)), ((0, 9), (9, 9))]:
            p = cal.court_to_image(np.array([a, b], float)).astype(int)
            cv2.line(out, tuple(p[0]), tuple(p[1]), (80, 220, 120), 2)
    for tr in tracker.active:
        s = tr.last
        x1, y1, x2, y2 = map(int, s.box)
        color = (255, 160, 40) if s.v < 9 else (60, 60, 255)
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
        cv2.putText(out, str(tr.id), (x1, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
    for c in cands[:3]:
        cv2.circle(out, (int(c.x), int(c.y)), max(4, int(c.size)), (0, 255, 255), 2)
    h, w = out.shape[:2]
    writer.write(out[: h // 2 * 2, : w // 2 * 2])


def save(result: dict, path: str) -> None:
    Path(path).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
