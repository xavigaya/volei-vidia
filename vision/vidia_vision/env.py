"""Comprovació de l'entorn: Python, biblioteques i GPU."""

from __future__ import annotations

import platform
import sys


def check() -> int:
    ok = True
    print(f"Python {platform.python_version()} ({sys.executable})")
    print(f"Sistema: {platform.system()} {platform.release()}")
    for mod in ("numpy", "scipy", "cv2", "av"):
        try:
            m = __import__(mod)
            print(f"  ✓ {mod} {getattr(m, '__version__', '')}")
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"  ✗ {mod}: {e}")
    try:
        import torch  # type: ignore
        import torchvision  # type: ignore

        print(f"  ✓ torch {torch.__version__} · torchvision {torchvision.__version__}")
        if torch.cuda.is_available():
            p = torch.cuda.get_device_properties(0)
            print(f"  ✓ GPU: {p.name} · {p.total_memory / 2**30:.1f} GB · CUDA {torch.version.cuda}")
        else:
            print("  ! PyTorch no veu cap GPU NVIDIA: la detecció de jugadors anirà per CPU (molt més lenta).")
            print("    Actualitza el controlador de NVIDIA i torna a executar install.ps1.")
    except Exception as e:  # noqa: BLE001
        print(f"  ! torch no està instal·lat ({e}): no hi haurà detecció de jugadors (es pot fer servir --no-players).")
    print("Tot a punt." if ok else "Falten biblioteques: torna a executar install.ps1.")
    return 0 if ok else 1
