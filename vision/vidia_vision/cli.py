"""Línia d'ordres de vidia-vision.

  vidia-vision check
  vidia-vision info VIDEO
  vidia-vision analyze PAQUET.json --video VIDEO [--out deteccions.json] [--start S] [--end S]
                       [--debug-video depuracio.mp4] [--no-players] [--device cuda|cpu]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def _parse_time(s: str | None) -> float | None:
    """Accepta segons (75) o mm:ss / hh:mm:ss (1:15, 0:01:15)."""
    if s is None:
        return None
    parts = [float(p) for p in s.split(":")]
    v = 0.0
    for p in parts:
        v = v * 60 + p
    return v


def main(argv: list[str] | None = None) -> int:
    # Consola de Windows: sortida en UTF-8 (accents)
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass
    ap = argparse.ArgumentParser(prog="vidia-vision", description="Volei VidIA — anàlisi local del vídeo d'un partit")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check", help="comprova la instal·lació i la GPU")
    p_info = sub.add_parser("info", help="mostra la informació d'un vídeo")
    p_info.add_argument("video")
    p_an = sub.add_parser("analyze", help="analitza el vídeo d'un partit")
    p_an.add_argument("package", help="paquet d'anàlisi o calibració exportats des de l'app (.json)")
    p_an.add_argument("--video", required=True, help="fitxer de vídeo original del partit")
    p_an.add_argument("--out", help="fitxer de resultats (per defecte: <vídeo>.deteccions.json)")
    p_an.add_argument("--start", help="inici (segons o mm:ss)")
    p_an.add_argument("--end", help="final (segons o mm:ss)")
    p_an.add_argument("--debug-video", help="desa un vídeo amb les deteccions dibuixades (per revisar-les)")
    p_an.add_argument("--no-players", action="store_true", help="sense detecció de jugadors (no cal PyTorch)")
    p_an.add_argument("--players-fps", type=float, default=5.0, help="deteccions de jugadors per segon (per defecte 5)")
    p_an.add_argument("--device", choices=["cuda", "cpu"], help="on s'executa el detector (per defecte, la GPU si n'hi ha)")
    args = ap.parse_args(argv)

    if args.cmd == "check":
        from .env import check

        return check()

    if args.cmd == "info":
        from .media import video_info

        i = video_info(args.video)
        print(f"{i.path}\n  {i.width}×{i.height} · {i.fps:.2f} fps · {i.duration / 60:.1f} min · àudio: {'sí' if i.has_audio else 'no'}")
        return 0

    if args.cmd == "analyze":
        from .package import load_package
        from .pipeline import Options, analyze, save

        try:
            pkg = load_package(args.package)
        except Exception as e:  # noqa: BLE001
            print(f"Error en llegir el paquet: {e}", file=sys.stderr)
            return 2
        if not Path(args.video).exists():
            print(f"No es troba el vídeo: {args.video}", file=sys.stderr)
            return 2
        out = args.out or str(Path(args.video).with_suffix("")) + ".deteccions.json"
        opts = Options(
            start=_parse_time(args.start) or 0.0,
            end=_parse_time(args.end),
            players=not args.no_players,
            players_fps=args.players_fps,
            device=args.device,
            debug_video=args.debug_video,
        )
        result = analyze(pkg, args.video, opts)
        save(result, out)
        print(f"Resultats desats a {out} ({result['elapsed']} s)")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
