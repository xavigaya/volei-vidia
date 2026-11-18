"""Lectura del vídeo i de l'àudio amb PyAV (inclou FFmpeg: no cal instal·lar res més)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import av
import numpy as np


@dataclass
class VideoInfo:
    path: str
    width: int
    height: int
    fps: float
    duration: float
    has_audio: bool


def video_info(path: str | Path) -> VideoInfo:
    with av.open(str(path)) as c:
        vs = c.streams.video[0]
        fps = float(vs.average_rate or vs.guessed_rate or 25)
        duration = float(c.duration / av.time_base) if c.duration else float(vs.frames / fps if vs.frames else 0)
        return VideoInfo(str(path), vs.codec_context.width, vs.codec_context.height, fps, duration, len(c.streams.audio) > 0)


def frames(
    path: str | Path,
    width: int | None = None,
    start: float = 0.0,
    end: float | None = None,
    step: int = 1,
) -> Iterator[tuple[float, np.ndarray]]:
    """Fotogrames (temps en s, imatge BGR uint8), opcionalment reduïts a una amplada."""
    with av.open(str(path)) as c:
        vs = c.streams.video[0]
        vs.thread_type = "AUTO"
        if start > 0:
            c.seek(int(start / vs.time_base), stream=vs, any_frame=False, backward=True)
        k = 0
        for fr in c.decode(vs):
            t = float(fr.pts * vs.time_base) if fr.pts is not None else 0.0
            if t < start:
                continue
            if end is not None and t > end:
                break
            if k % step == 0:
                if width and fr.width != width:
                    h = int(round(fr.height * width / fr.width / 2) * 2)
                    img = fr.to_ndarray(format="bgr24", width=width, height=h)
                else:
                    img = fr.to_ndarray(format="bgr24")
                yield t, img
            k += 1


def audio_mono(path: str | Path, rate: int = 22050, start: float = 0.0, end: float | None = None) -> tuple[np.ndarray, int]:
    """Àudio del vídeo en mono float32 a `rate` Hz (buit si no en té)."""
    with av.open(str(path)) as c:
        if not c.streams.audio:
            return np.zeros(0, np.float32), rate
        st = c.streams.audio[0]
        res = av.AudioResampler(format="flt", layout="mono", rate=rate)
        chunks: list[np.ndarray] = []
        if start > 0:
            c.seek(int(start / st.time_base), stream=st, backward=True)
        first_t: float | None = None
        for fr in c.decode(st):
            t = float(fr.pts * st.time_base) if fr.pts is not None else 0.0
            if end is not None and t > end:
                break
            if first_t is None:
                first_t = t
            for out in res.resample(fr):
                chunks.append(out.to_ndarray().reshape(-1))
        for out in res.resample(None):
            chunks.append(out.to_ndarray().reshape(-1))
        audio = np.concatenate(chunks) if chunks else np.zeros(0, np.float32)
        # Alinea amb `start` (el seek cau a un fotograma anterior)
        if first_t is not None and start > first_t:
            audio = audio[int((start - first_t) * rate):]
        return audio.astype(np.float32), rate
