"""Prova amb jugadors que es mouen (com al vídeo real): els braços i caps es mouen com la pilota."""

import numpy as np

from synth import StubDetector, calibration_json, camera, render_video
from test_end_to_end import rally
from vidia_vision.package import load_package
from vidia_vision.pipeline import Options, analyze

import json


def run(tmp_path):
    P = camera()
    video = str(tmp_path / "partit.mp4")
    rallies = [rally(5.0), rally(19.0), rally(33.0)]
    truth = render_video(video, P, rallies, duration=42.0, people=True, end_whistle=True)
    pkg_file = tmp_path / "paquet.json"
    pkg_file.write_text(json.dumps({"format": "volei-vidia/calibration", "version": 1, "calibrations": [calibration_json(P)]}))
    res = analyze(load_package(pkg_file), video, Options(players_fps=10), progress=lambda m: None, detector=StubDetector(P))
    return res, truth, rallies


def test_with_moving_players(tmp_path):
    res, truth, rallies = run(tmp_path)
    found = [c["t"] for c in res["contacts"]]
    hits = sum(any(abs(f - t) < 0.2 for f in found) for t in truth)
    false = [f for f in found if min(abs(f - t) for t in truth) > 0.25]
    # La pilota detectada ha de ser la pilota (no els braços): la majoria de posicions
    # durant el vol coincideixen amb la trajectòria real
    assert hits >= 0.7 * len(truth), (hits, len(truth))
    assert len(false) <= 2 * len(rallies), (len(false), false[:20])
    assert len(res["rallies"]) == 3, [(r["start"], r["end"]) for r in res["rallies"]]
    for r, src in zip(res["rallies"], rallies):
        assert abs(r["start"] - src[0][0]) < 0.6
        assert abs(r["end"] - src[-2][0]) < 1.5
