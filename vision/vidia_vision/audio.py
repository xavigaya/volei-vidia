"""Àudio: cops de pilota (transitoris curts) i xiulets (to sostingut 2–4,5 kHz)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import signal


@dataclass
class AudioEvents:
    onsets: list[tuple[float, float]]  # (temps, força 0..1)
    whistles: list[tuple[float, float]]  # (inici, final)


def _stft(x: np.ndarray, rate: int, nfft: int = 1024, hop: int = 256):
    f, t, Z = signal.stft(x, fs=rate, nperseg=nfft, noverlap=nfft - hop, boundary=None, padded=False)
    return f, t, np.abs(Z)


def detect_onsets(x: np.ndarray, rate: int, band=(800.0, 6000.0), min_gap: float = 0.12, k: float = 4.0) -> list[tuple[float, float]]:
    """Cops: flux espectral positiu a la banda dels impactes, amb llindar adaptatiu (mediana + k·MAD)."""
    if len(x) < rate // 2:
        return []
    f, t, S = _stft(x, rate)
    sel = (f >= band[0]) & (f <= band[1])
    L = np.log1p(S[sel] * 100)
    flux = np.maximum(np.diff(L, axis=1), 0).sum(axis=0)
    flux = np.concatenate([[0.0], flux])
    # Llindar adaptatiu en finestres de ~3 s
    win = max(3, int(3.0 / (t[1] - t[0])))
    med = signal.medfilt(flux, kernel_size=win | 1)
    mad = signal.medfilt(np.abs(flux - med), kernel_size=win | 1) + 1e-9
    score = (flux - med) / (k * 1.4826 * mad)
    dist = max(1, int(min_gap / (t[1] - t[0])))
    peaks, props = signal.find_peaks(score, height=1.0, distance=dist)
    if len(peaks) == 0:
        return []
    h = props["peak_heights"]
    strength = np.clip(h / (np.percentile(h, 90) + 1e-9), 0, 1)
    return [(float(t[p]), float(s)) for p, s in zip(peaks, strength)]


def detect_whistles(x: np.ndarray, rate: int, band=(2000.0, 4500.0), min_dur: float = 0.25, peakiness: float = 6.0) -> list[tuple[float, float]]:
    """Xiulets: un pic tonal dominant dins la banda durant almenys `min_dur` segons."""
    if len(x) < rate // 2:
        return []
    f, t, S = _stft(x, rate, nfft=2048, hop=512)
    sel = (f >= band[0]) & (f <= band[1])
    B = S[sel] + 1e-9
    peak = B.max(axis=0)
    ratio = peak / np.median(B, axis=0)
    band_energy = (B**2).sum(axis=0)
    total = (S**2).sum(axis=0) + 1e-9
    tonal = (ratio > peakiness) & (band_energy / total > 0.3)
    # Tram continu (amb forats d'un sol fotograma)
    tonal = signal.medfilt(tonal.astype(float), 3) > 0.5
    out: list[tuple[float, float]] = []
    dt = t[1] - t[0]
    i = 0
    while i < len(tonal):
        if tonal[i]:
            j = i
            while j + 1 < len(tonal) and tonal[j + 1]:
                j += 1
            if (j - i + 1) * dt >= min_dur:
                out.append((float(t[i]), float(t[j] + dt)))
            i = j + 1
        else:
            i += 1
    return out


def analyze_audio(x: np.ndarray, rate: int, offset: float = 0.0) -> AudioEvents:
    whistles = detect_whistles(x, rate)
    onsets = detect_onsets(x, rate)
    # Els extrems de l'àudio (inici i final de la descodificació) donen falsos cops
    dur = len(x) / rate
    onsets = [(t, s) for t, s in onsets if 0.6 <= t <= dur - 0.6]
    # Els xiulets no són cops
    onsets = [(t, s) for t, s in onsets if not any(a - 0.05 <= t <= b + 0.05 for a, b in whistles)]
    return AudioEvents(
        onsets=[(t + offset, s) for t, s in onsets],
        whistles=[(a + offset, b + offset) for a, b in whistles],
    )
