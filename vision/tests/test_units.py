import json

import numpy as np

from synth import H, W, calibration, calibration_json, camera
from vidia_vision.audio import detect_onsets, detect_whistles
from vidia_vision.ball import Candidate, ball_path, link_tracks
from vidia_vision.calibration import camera_to_app, project, side_of_v
from vidia_vision.contacts import fuse, trajectory_breaks
from vidia_vision.package import Rally, load_package
from vidia_vision.rallies import match_acta, segment

P = camera()


def test_calibration_recovers_camera():
    cal = calibration(P)
    assert cal.rmse is not None and cal.rmse < 0.01
    x, y = project(P, np.array([[3.2, 7.4, 0]]))[0]
    u, v = cal.image_to_court(np.array([[x, y]]))[0]
    assert abs(u - 3.2) < 1e-3 and abs(v - 7.4) < 1e-3
    a = project(P, np.array([[6, 12, 3]]))[0]
    b = cal.court_to_image(np.array([[6, 12]]), z=3)[0]
    assert np.hypot(*(a - b)) < 0.05


def test_calibration_scaled_to_another_resolution():
    cal = calibration(P).scaled(W * 2, H * 2)
    x, y = project(P, np.array([[4.5, 3.0, 0]]))[0]
    u, v = cal.image_to_court(np.array([[x * 2, y * 2]]))[0]
    assert abs(u - 4.5) < 1e-3 and abs(v - 3.0) < 1e-3


def test_app_coordinates_match_the_app():
    # Mateixos casos que src/recognition/calibration.test.ts
    assert camera_to_app(0.5, 1, "H") == (1, 0.5)
    assert camera_to_app(2, 13, "A") == (5, 7)
    assert side_of_v(3, "A") == "A" and side_of_v(12, "A") == "H"


def test_audio_onsets_and_whistle():
    rate = 22050
    rng = np.random.default_rng(0)
    x = rng.normal(0, 0.01, rate * 10).astype(np.float32)
    hits = [1.0, 2.3, 2.9, 5.5, 7.25]
    for t in hits:
        i = int(t * rate)
        k = np.arange(int(0.03 * rate))
        x[i : i + len(k)] += 0.6 * np.exp(-k / (0.004 * rate)) * rng.normal(0, 1, len(k))
    k = np.arange(int(0.6 * rate))
    x[int(3.8 * rate) : int(3.8 * rate) + len(k)] += 0.3 * np.sin(2 * np.pi * 3200 * k / rate)
    on = [t for t, _ in detect_onsets(x, rate)]
    for t in hits:
        assert min(abs(o - t) for o in on) < 0.03, (t, on)
    wh = detect_whistles(x, rate)
    assert len(wh) == 1 and abs(wh[0][0] - 3.8) < 0.1 and wh[0][1] - wh[0][0] > 0.4


def _flight(t0, p0, v0, n, g=900.0):
    return [Candidate(t0 + i / 30, p0[0] + v0[0] * i / 30, p0[1] + v0[1] * i / 30 + 0.5 * g * (i / 30) ** 2, 8, 0.9) for i in range(n)]


def test_ball_linking_and_contact_breaks():
    # Pilota que puja i, al segon 1, canvia de direcció de cop (contacte)
    a = _flight(0.0, (200, 600), (300, -700), 31)  # fins a t = 1,0 s
    last = a[-1]
    b = _flight(1.0, (last.x, last.y), (-400, -500), 30)[1:]
    per_frame = [[c] for c in a + b]
    # Soroll: una taca aïllada
    per_frame[10].append(Candidate(per_frame[10][0].t, 900, 100, 8, 0.4))
    tracks = link_tracks(per_frame, gate=120)
    path = ball_path(tracks)
    assert len(path) >= 55
    br = trajectory_breaks(path)
    assert any(abs(t - 1.0) < 0.05 for t, *_ in br)
    # L'àpex de la paràbola no compta com a contacte
    assert not any(0.3 < t < 0.9 for t, *_ in br)


def test_fuse_and_segment_and_acta():
    breaks = [(10.0, 100, 100, 0.8), (11.2, 120, 90, 0.6), (12.0, 300, 200, 0.7), (30.0, 100, 100, 0.9), (31.0, 100, 100, 0.5)]
    onsets = [(10.03, 0.9), (12.05, 0.8), (20.0, 0.9), (30.02, 1.0)]
    contacts = fuse(breaks, onsets)
    assert sum(c.audio and c.visual for c in contacts) == 3
    assert any(not c.visual for c in contacts)  # cop sense pilota visible (segon 20)
    segs = segment(contacts, whistles=[(8.0, 8.5), (28.0, 28.6)])
    assert len(segs) == 2 and segs[0].whistle and segs[1].whistle
    for s in segs:
        s.set = 1
    acta = {1: [Rally(1, 0, "A", 13, "H", (0, 0), (1, 0)), Rally(1, 1, "H", 2, "H", (1, 0), (2, 0))]}
    rep = match_acta(segs, acta)
    assert rep[1]["expected"] == 2 and rep[1]["missing"] == 0
    assert segs[0].server == "A" and segs[0].server_player == 13 and segs[1].winner == "H"


def test_load_package_formats(tmp_path):
    cal = calibration_json(P)
    f = tmp_path / "cal.json"
    f.write_text(json.dumps({"format": "volei-vidia/calibration", "version": 1, "calibrations": [cal]}))
    pkg = load_package(f)
    assert pkg.calibrations[0].camera is not None
    g = tmp_path / "pkg.json"
    g.write_text(
        json.dumps(
            {
                "format": "volei-vidia/analysis-package",
                "version": 1,
                "calibrations": [cal],
                "events": [{"seq": 1, "set": 1, "type": "lineup", "videoTime": 5.0}, {"seq": 40, "set": 2, "type": "lineup", "videoTime": 1500.0}],
                "rallies": {"1": [{"index": 0, "server": "A", "serverPlayer": 13, "winner": "H", "before": {"h": 0, "a": 0}, "after": {"h": 1, "a": 0}}]},
            }
        )
    )
    pkg = load_package(g)
    assert pkg.set_at(100) == 1 and pkg.set_at(2000) == 2 and pkg.set_at(1) is None
    assert pkg.near_side(2, 2000) == "A"
    assert pkg.rallies[1][0].server_player == 13


def test_segment_splits_at_whistle_and_caps_length():
    from vidia_vision.contacts import Contact

    # Contactes seguits cada 2 s durant 30 s, amb un xiulet al segon 13,0: dues jugades
    cs = [Contact(10 + 2 * k, 100, 100, 0.9, True, True) for k in range(16)]
    segs = segment(cs, whistles=[(13.0, 13.5)])
    assert [(s.start, s.end) for s in segs] == [(10, 12), (14, 40)]
    # Sense xiulets, una cadena de 90 s es parteix (cap jugada no dura tant)
    cs = [Contact(k * 1.5 + (5 if k > 30 else 0), 100, 100, 0.9, True, True) for k in range(60)]
    segs = segment(cs, whistles=[], gap=6)
    assert len(segs) >= 2 and all(s.end - s.start <= 40 for s in segs)
