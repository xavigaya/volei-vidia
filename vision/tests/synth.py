"""Dades sintètiques per a les proves: càmera, pista dibuixada, pilota, àudio i vídeo."""

from __future__ import annotations

import math

import av
import cv2
import numpy as np

from vidia_vision.calibration import CAL_POINTS, Calibration, project, world_of

W, H = 1280, 720


def camera(width: int = W, height: int = H) -> np.ndarray:
    f = 1400 * width / 1920
    cx, cy = width / 2, height / 2
    C = np.array([4.5, -7.0, 5.5])
    T = np.array([4.5, 9.0, 0.5])
    z = (T - C) / np.linalg.norm(T - C)
    x = np.cross(z, [0, 0, 1])
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    R = np.stack([x, y, z])
    t = -R @ C
    K = np.array([[f, 0, cx], [0, f, cy], [0, 0, 1]])
    return K @ np.hstack([R, t[:, None]])


def calibration_json(P: np.ndarray, width: int = W, height: int = H, near: str = "H") -> dict:
    pts = {}
    for k in CAL_POINTS:
        x, y = project(P, np.array([world_of(k, 2.43)]))[0]
        pts[k] = {"x": x / width, "y": y / height}
    return {"fromTime": 0, "width": width, "height": height, "points": pts, "netHeight": 2.43, "nearSide": {"1": near, "2": "A" if near == "H" else "H"}}


def court_image(P: np.ndarray, width: int = W, height: int = H) -> np.ndarray:
    img = np.zeros((height, width, 3), np.uint8)
    img[:] = (60, 70, 90)
    rng = np.random.default_rng(1)
    img = np.clip(img + rng.normal(0, 4, img.shape), 0, 255).astype(np.uint8)  # textura

    def pp(u, v, z=0.0):
        return tuple(int(round(c)) for c in project(P, np.array([[u, v, z]]))[0])

    floor = np.array([pp(0, 0), pp(9, 0), pp(9, 18), pp(0, 18)], np.int32)
    cv2.fillPoly(img, [floor], (70, 125, 205))
    for a, b in [((0, 0), (9, 0)), ((9, 0), (9, 18)), ((9, 18), (0, 18)), ((0, 18), (0, 0)), ((0, 6), (9, 6)), ((0, 12), (9, 12)), ((0, 9), (9, 9))]:
        cv2.line(img, pp(*a), pp(*b), (255, 255, 255), 3)
    cv2.line(img, pp(0, 9, 2.43), pp(9, 9, 2.43), (245, 245, 245), 4)
    return img


def ball_flights(contacts_uvz: list[tuple[float, float, float, float]]) -> list[tuple[float, float, float, float]]:
    """Posicions (t, u, v, z) a 30 fps entre contactes successius (paràboles amb gravetat)."""
    out = []
    for (t0, u0, v0, z0), (t1, u1, v1, z1) in zip(contacts_uvz, contacts_uvz[1:]):
        T = t1 - t0
        g = 9.81
        vz = (z1 - z0 + 0.5 * g * T * T) / T
        n = int(round(T * 30))
        for i in range(n):
            s = i / 30
            out.append((t0 + s, u0 + (u1 - u0) * s / T, v0 + (v1 - v0) * s / T, z0 + vz * s - 0.5 * g * s * s))
    return out


def render_video(path: str, P: np.ndarray, rallies: list[list[tuple[float, float, float, float]]], duration: float, rate: int = 22050) -> list[float]:
    """Vídeo de prova amb àudio: per cada jugada, un xiulet 2 s abans del servei, la pilota volant
    entre els contactes i un cop sonor a cada contacte. Retorna els temps reals dels contactes."""
    bg = court_image(P)
    positions = {}
    contact_times = []
    for contacts in rallies:
        for t, u, v, z in ball_flights(contacts):
            positions[round(t * 30)] = (u, v, z)
        contact_times += [c[0] for c in contacts[:-1]]
    # Àudio
    n = int(duration * rate)
    rng = np.random.default_rng(7)
    audio = rng.normal(0, 0.01, n).astype(np.float32)
    for t in contact_times:
        i = int(t * rate)
        k = np.arange(int(0.03 * rate))
        audio[i : i + len(k)] += (0.6 * np.exp(-k / (0.004 * rate)) * rng.normal(0, 1, len(k))).astype(np.float32)
    for contacts in rallies:
        tw = contacts[0][0] - 2.0
        k = np.arange(int(0.6 * rate))
        audio[int(tw * rate) : int(tw * rate) + len(k)] += (0.3 * np.sin(2 * math.pi * 3200 * k / rate)).astype(np.float32)
    audio = np.clip(audio, -1, 1)

    with av.open(path, "w") as c:
        vs = c.add_stream("mpeg4", rate=30)
        vs.width, vs.height = W, H
        vs.pix_fmt = "yuv420p"
        vs.bit_rate = 4_000_000
        aus = c.add_stream("aac", rate=rate)
        aus.layout = "mono"
        for fi in range(int(duration * 30)):
            img = bg.copy()
            if fi in positions:
                u, v, z = positions[fi]
                x, y = project(P, np.array([[u, v, z]]))[0]
                d = np.linalg.norm(project(P, np.array([[u + 0.21, v, z]]))[0] - [x, y])
                cv2.circle(img, (int(x), int(y)), max(2, int(d / 2)), (40, 220, 250), -1)
            frame = av.VideoFrame.from_ndarray(img, format="bgr24")
            for pkt in vs.encode(frame):
                c.mux(pkt)
        for pkt in vs.encode():
            c.mux(pkt)
        step = 1024
        for i in range(0, len(audio), step):
            chunk = audio[i : i + step]
            if len(chunk) < step:
                chunk = np.pad(chunk, (0, step - len(chunk)))
            af = av.AudioFrame.from_ndarray(chunk.reshape(1, -1), format="flt", layout="mono")
            af.sample_rate = rate
            af.pts = i
            for pkt in aus.encode(af):
                c.mux(pkt)
        for pkt in aus.encode():
            c.mux(pkt)
    return contact_times


def calibration(P: np.ndarray) -> Calibration:
    return Calibration.from_json(calibration_json(P))
