"""Calibració de la càmera (equivalent a src/recognition/calibration.ts de l'app).

Coordenades "de càmera" de la pista, en metres:
  u: 0..9   d'esquerra a dreta vist des de la càmera
  v: 0..18  de la línia de fons propera (0) a la llunyana (18); xarxa a v = 9
  z: alçada

Coordenades de l'app (Point2): x 0..18 amb el local a l'esquerra i la xarxa a
x = 9; y 0..9. La conversió depèn de quin equip és al costat de la càmera.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

ANTENNA_ABOVE_NET = 0.8
CAL_POINTS = ("nl", "nr", "fr", "fl", "netL", "netR", "antL", "antR")


def world_of(key: str, net_height: float) -> tuple[float, float, float]:
    return {
        "nl": (0.0, 0.0, 0.0),
        "nr": (9.0, 0.0, 0.0),
        "fr": (9.0, 18.0, 0.0),
        "fl": (0.0, 18.0, 0.0),
        "netL": (0.0, 9.0, net_height),
        "netR": (9.0, 9.0, net_height),
        "antL": (0.0, 9.0, net_height + ANTENNA_ABOVE_NET),
        "antR": (9.0, 9.0, net_height + ANTENNA_ABOVE_NET),
    }[key]


def homography(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """Homografia 3×3 que porta 4 punts src (N×2) a dst (N×2)."""
    a, b = [], []
    for (x, y), (X, Y) in zip(src, dst):
        a.append([x, y, 1, 0, 0, 0, -x * X, -y * X])
        b.append(X)
        a.append([0, 0, 0, x, y, 1, -x * Y, -y * Y])
        b.append(Y)
    h = np.linalg.solve(np.asarray(a, float), np.asarray(b, float))
    return np.append(h, 1.0).reshape(3, 3)


def apply_h(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Aplica una homografia a punts N×2."""
    pts = np.atleast_2d(np.asarray(pts, float))
    hom = np.hstack([pts, np.ones((len(pts), 1))]) @ H.T
    return hom[:, :2] / hom[:, 2:3]


def camera_dlt(world: np.ndarray, img: np.ndarray) -> np.ndarray:
    """Matriu de càmera 3×4 (DLT) a partir de ≥ 6 punts no coplanaris."""
    c = img.mean(axis=0)
    s = np.sqrt(2) / max(np.mean(np.linalg.norm(img - c, axis=1)), 1e-9)
    T = np.array([[s, 0, -s * c[0]], [0, s, -s * c[1]], [0, 0, 1]])
    imn = (np.hstack([img, np.ones((len(img), 1))]) @ T.T)[:, :2]
    rows = []
    for (X, Y, Z), (x, y) in zip(world, imn):
        rows.append([X, Y, Z, 1, 0, 0, 0, 0, -x * X, -x * Y, -x * Z, -x])
        rows.append([0, 0, 0, 0, X, Y, Z, 1, -y * X, -y * Y, -y * Z, -y])
    _, _, vt = np.linalg.svd(np.asarray(rows, float))
    Pn = vt[-1].reshape(3, 4)
    return np.linalg.inv(T) @ Pn


def project(P: np.ndarray, pts3: np.ndarray) -> np.ndarray:
    pts3 = np.atleast_2d(np.asarray(pts3, float))
    hom = np.hstack([pts3, np.ones((len(pts3), 1))]) @ P.T
    return hom[:, :2] / hom[:, 2:3]


@dataclass
class Calibration:
    from_time: float
    width: int
    height: int
    points: dict[str, tuple[float, float]]  # normalitzats 0..1
    net_height: float = 2.43
    near_side: dict[int, str] = field(default_factory=dict)  # set → 'H' / 'A'

    # Resultat
    ground: np.ndarray | None = None  # pista (u, v) → imatge (px)
    ground_inv: np.ndarray | None = None
    camera: np.ndarray | None = None  # 3×4
    rmse: float | None = None

    @classmethod
    def from_json(cls, d: dict) -> "Calibration":
        pts = {k: (float(v["x"]), float(v["y"])) for k, v in (d.get("points") or {}).items() if k in CAL_POINTS}
        near = {int(k): v for k, v in (d.get("nearSide") or {}).items() if v in ("H", "A")}
        c = cls(
            from_time=float(d.get("fromTime", 0) or 0),
            width=int(d.get("width", 1920)),
            height=int(d.get("height", 1080)),
            points=pts,
            net_height=float(d.get("netHeight", 2.43) or 2.43),
            near_side=near,
        )
        c.solve()
        return c

    def px(self, key: str) -> tuple[float, float]:
        x, y = self.points[key]
        return x * self.width, y * self.height

    def solve(self) -> None:
        corners = ("nl", "nr", "fr", "fl")
        if all(k in self.points for k in corners):
            src = np.array([world_of(k, self.net_height)[:2] for k in corners])
            dst = np.array([self.px(k) for k in corners])
            self.ground = homography(src, dst)
            self.ground_inv = np.linalg.inv(self.ground)
        keys = [k for k in CAL_POINTS if k in self.points]
        if len(keys) >= 6 and any(world_of(k, self.net_height)[2] > 0 for k in keys):
            world = np.array([world_of(k, self.net_height) for k in keys])
            img = np.array([self.px(k) for k in keys])
            self.camera = camera_dlt(world, img)
            err = np.linalg.norm(project(self.camera, world) - img, axis=1)
            self.rmse = float(np.sqrt(np.mean(err**2)))

    def scaled(self, width: int, height: int) -> "Calibration":
        """La mateixa calibració per a un vídeo processat a una altra resolució."""
        c = Calibration(self.from_time, width, height, dict(self.points), self.net_height, dict(self.near_side))
        c.solve()
        return c

    # --- conversions -----------------------------------------------------
    def image_to_court(self, pts_px: np.ndarray) -> np.ndarray:
        """Punts de la imatge (px) sobre el terra → (u, v) en metres."""
        if self.ground_inv is None:
            raise ValueError("calibració sense les 4 cantonades")
        return apply_h(self.ground_inv, pts_px)

    def court_to_image(self, uv: np.ndarray, z: float = 0.0) -> np.ndarray:
        uv = np.atleast_2d(np.asarray(uv, float))
        if self.camera is not None:
            return project(self.camera, np.hstack([uv, np.full((len(uv), 1), z)]))
        if z != 0 or self.ground is None:
            raise ValueError("cal la xarxa o les antenes per a punts amb alçada")
        return apply_h(self.ground, uv)

    def inside_court(self, uv: np.ndarray, margin: float = 0.0) -> np.ndarray:
        uv = np.atleast_2d(uv)
        return (uv[:, 0] >= -margin) & (uv[:, 0] <= 9 + margin) & (uv[:, 1] >= -margin) & (uv[:, 1] <= 18 + margin)

    def net_line_y(self, u: float) -> float | None:
        """Fila de la imatge (px) de la cinta superior de la xarxa a la posició u."""
        if self.camera is None:
            return None
        return float(self.court_to_image(np.array([[u, 9.0]]), z=self.net_height)[0, 1])


def camera_to_app(u: float, v: float, near: str) -> tuple[float, float]:
    return (v, u) if near == "H" else (18 - v, 9 - u)


def side_of_v(v: float, near: str) -> str:
    """Equip que juga a la meitat on és la profunditat v."""
    if v < 9:
        return near
    return "A" if near == "H" else "H"


def calibration_at(calibrations: list[Calibration], t: float) -> Calibration | None:
    cur = None
    for c in sorted(calibrations, key=lambda c: c.from_time):
        if cur is None or c.from_time <= t:
            cur = c
    return cur
