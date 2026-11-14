"""Jugadors: detector de persones preentrenat (torchvision, COCO) i seguiment a la pista.

Es fa servir Faster R-CNN de torchvision (codi BSD-3) amb els pesos de COCO.
Les persones fora de la pista (banquetes, àrbitres, públic) es descarten amb
la calibració: es mira on trepitgen (el centre de la base del requadre).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import linear_sum_assignment

from .calibration import Calibration


@dataclass
class Detection:
    t: float
    box: tuple[float, float, float, float]  # x1, y1, x2, y2 (px del vídeo original)
    score: float
    u: float = 0.0
    v: float = 0.0


class PersonDetector:
    def __init__(self, device: str | None = None, min_score: float = 0.5, input_width: int = 1280):
        import torch  # type: ignore
        from torchvision.models.detection import (  # type: ignore
            FasterRCNN_ResNet50_FPN_V2_Weights,
            fasterrcnn_resnet50_fpn_v2,
        )

        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        weights = FasterRCNN_ResNet50_FPN_V2_Weights.COCO_V1
        self.model = fasterrcnn_resnet50_fpn_v2(weights=weights, box_score_thresh=min_score).eval().to(self.device)
        self.min_score = min_score
        self.input_width = input_width

    def __call__(self, frame_bgr: np.ndarray, t: float) -> list[Detection]:
        torch = self.torch
        h, w = frame_bgr.shape[:2]
        scale = min(1.0, self.input_width / w)
        rgb = frame_bgr[:, :, ::-1]
        if scale < 1.0:
            import cv2

            rgb = cv2.resize(rgb, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        x = torch.from_numpy(np.ascontiguousarray(rgb)).permute(2, 0, 1).float().div(255).to(self.device)
        with torch.inference_mode():
            out = self.model([x])[0]
        dets = []
        for box, label, score in zip(out["boxes"].cpu().numpy(), out["labels"].cpu().numpy(), out["scores"].cpu().numpy()):
            if label == 1 and score >= self.min_score:  # 1 = persona a COCO
                x1, y1, x2, y2 = (box / scale).tolist()
                dets.append(Detection(t, (x1, y1, x2, y2), float(score)))
        return dets


def on_court(dets: list[Detection], cal: Calibration, margin: float = 1.2) -> list[Detection]:
    """Es queda amb les persones que trepitgen la pista (amb un marge) i n'afegeix la posició (u, v)."""
    if not dets:
        return []
    feet = np.array([[(d.box[0] + d.box[2]) / 2, d.box[3]] for d in dets])
    uv = cal.image_to_court(feet)
    out = []
    for d, (u, v) in zip(dets, uv):
        if not (-margin <= u <= 9 + margin and -margin <= v <= 18 + margin):
            continue
        # Primer i segon àrbitre: al costat dels pals de la xarxa
        if (u < -0.4 or u > 9.4) and abs(v - 9) < 1.6:
            continue
        d.u, d.v = float(u), float(v)
        out.append(d)
    return out


@dataclass
class PlayerTrack:
    id: int
    samples: list[Detection] = field(default_factory=list)
    misses: int = 0

    @property
    def last(self) -> Detection:
        return self.samples[-1]


class Tracker:
    """Seguiment per assignació òptima (algorisme hongarès) de distàncies a la pista."""

    def __init__(self, gate_m: float = 1.6, max_misses: int = 10):
        self.gate = gate_m
        self.max_misses = max_misses
        self.active: list[PlayerTrack] = []
        self.finished: list[PlayerTrack] = []
        self.next_id = 1

    def update(self, dets: list[Detection]) -> None:
        if self.active and dets:
            C = np.array([[np.hypot(tr.last.u - d.u, tr.last.v - d.v) for d in dets] for tr in self.active])
            rows, cols = linear_sum_assignment(C)
            used_t, used_d = set(), set()
            for r, c in zip(rows, cols):
                if C[r, c] <= self.gate * (1 + 0.3 * self.active[r].misses):
                    self.active[r].samples.append(dets[c])
                    self.active[r].misses = 0
                    used_t.add(r)
                    used_d.add(c)
            for i, tr in enumerate(self.active):
                if i not in used_t:
                    tr.misses += 1
            new = [d for j, d in enumerate(dets) if j not in used_d]
        else:
            for tr in self.active:
                tr.misses += 1
            new = dets
        for d in new:
            self.active.append(PlayerTrack(self.next_id, [d]))
            self.next_id += 1
        keep = []
        for tr in self.active:
            (self.finished if tr.misses > self.max_misses else keep).append(tr)
        self.active = keep

    def tracks(self, min_len: int = 3) -> list[PlayerTrack]:
        return [tr for tr in self.finished + self.active if len(tr.samples) >= min_len]
