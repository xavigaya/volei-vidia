import numpy as np
import pytest

from synth import calibration, camera, court_image
from vidia_vision.calibration import project
from vidia_vision.players import Detection, Tracker, on_court

P = camera()


def _det_at(u, v, t=0.0, h=120):
    x, y = project(P, np.array([[u, v, 0]]))[0]
    return Detection(t, (x - 20, y - h, x + 20, y), 0.9)


def test_on_court_filters_bench_and_referees():
    cal = calibration(P)
    dets = [_det_at(4, 3), _det_at(6, 14), _det_at(-3, 5), _det_at(-1.0, 9.0), _det_at(4.5, -0.8)]
    kept = on_court(dets, cal)
    uv = [(round(d.u, 1), round(d.v, 1)) for d in kept]
    # Dins la pista i el servidor (darrere la línia de fons); fora: banqueta i àrbitre
    assert uv == [(4.0, 3.0), (6.0, 14.0), (4.5, -0.8)]


def test_tracker_keeps_identities():
    cal = calibration(P)
    tr = Tracker()
    for k in range(10):
        t = k / 5
        tr.update(on_court([_det_at(2 + 0.1 * k, 3, t), _det_at(7, 4 - 0.1 * k, t), _det_at(4, 13, t)], cal))
    tracks = tr.tracks()
    assert len(tracks) == 3
    assert all(len(t.samples) == 10 for t in tracks)


def test_person_detector_runs():
    torch = pytest.importorskip("torch")
    from vidia_vision.players import PersonDetector

    try:
        det = PersonDetector(device="cpu", input_width=640)
    except Exception as e:  # sense xarxa per baixar els pesos
        pytest.skip(f"no s'han pogut carregar els pesos: {e}")
    out = det(court_image(P), 1.0)
    assert isinstance(out, list)  # la pista buida no té persones
    assert torch is not None
