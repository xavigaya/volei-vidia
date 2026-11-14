import json

from synth import calibration_json, camera, render_video
from vidia_vision.cli import main


def rally(t0: float):
    # (t, u, v, z): servei des de darrere la línia de fons propera, recepció, col·locació,
    # atac, defensa, i la pilota cau a terra (últim punt, no és contacte)
    return [
        (t0, 4.0, -0.8, 2.6),
        (t0 + 1.3, 3.0, 15.0, 0.8),
        (t0 + 2.3, 5.5, 10.0, 2.6),
        (t0 + 3.2, 6.0, 10.4, 3.2),
        (t0 + 3.7, 2.0, 4.0, 0.6),
        (t0 + 4.9, 4.5, 13.0, 0.0),
    ]


def test_analyze_synthetic_video(tmp_path):
    P = camera()
    video = str(tmp_path / "partit.mp4")
    rallies = [rally(5.0), rally(19.0), rally(33.0)]
    truth = render_video(video, P, rallies, duration=42.0)

    pkg = tmp_path / "paquet.json"
    pkg.write_text(
        json.dumps(
            {
                "format": "volei-vidia/analysis-package",
                "version": 1,
                "match": {"home": {"name": "Local"}, "away": {"name": "Visitant"}},
                "calibrations": [calibration_json(P)],
                "events": [{"seq": 1, "set": 1, "type": "lineup", "videoTime": 0.0}],
                "rallies": {
                    "1": [
                        {"index": i, "server": "H", "serverPlayer": 7, "winner": "H", "before": {"h": i, "a": 0}, "after": {"h": i + 1, "a": 0}}
                        for i in range(3)
                    ]
                },
            }
        )
    )
    out = tmp_path / "det.json"
    debug = tmp_path / "debug.mp4"
    assert main(["analyze", str(pkg), "--video", video, "--out", str(out), "--no-players", "--debug-video", str(debug)]) == 0
    res = json.loads(out.read_text())

    assert res["format"] == "volei-vidia/vision-detections"
    assert len(res["audio"]["whistles"]) == 3
    # Quasi tots els contactes reals s'han detectat (a menys de 0,2 s)
    found = [c["t"] for c in res["contacts"]]
    hits = sum(any(abs(f - t) < 0.2 for f in found) for t in truth)
    assert hits >= 0.8 * len(truth), (hits, len(truth), found)
    # I pocs falsos positius (com a molt un per jugada)
    false = [f for f in found if min(abs(f - t) for t in truth) > 0.25]
    assert len(false) <= len(rallies), false
    # Tres jugades, cadascuna amb el servidor i el guanyador de l'acta
    assert len(res["rallies"]) == 3
    for i, (r, src) in enumerate(zip(res["rallies"], rallies)):
        assert r["set"] == 1 and r["index"] == i and r["server"] == "H" and r["serverPlayer"] == 7
        assert abs(r["start"] - src[0][0]) < 0.5
        assert r["whistle"]
    assert res["acta"]["1"]["missing"] == 0
    assert debug.exists() and debug.stat().st_size > 10_000
