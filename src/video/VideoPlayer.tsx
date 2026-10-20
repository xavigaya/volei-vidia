import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { loadYouTubeApi, type YTPlayer } from './youtube';

export type VideoSource = { kind: 'youtube'; id: string } | { kind: 'file'; url: string; name: string; file?: File };

// API comuna per als dos tipus de vídeo
export interface PlayerHandle {
  getTime(): number | null;
  seek(t: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
  isPlaying(): boolean;
  setRate(rate: number): void;
}

interface Props {
  source: VideoSource;
  onError?: (code: string) => void;
  // Si s'indica, es recorda on s'ha quedat el vídeo (en aquest dispositiu)
  // i en tornar-lo a obrir continua des d'aquell punt
  resumeKey?: string;
}

const POS_PREFIX = 'svidia.videoPos.';

function readPos(key: string | undefined): number {
  if (!key) return 0;
  try {
    const v = Number(localStorage.getItem(POS_PREFIX + key));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function writePos(key: string | undefined, t: number | null) {
  if (!key || t == null || !Number.isFinite(t)) return;
  try {
    localStorage.setItem(POS_PREFIX + key, String(Math.round(t * 10) / 10));
  } catch {
    /* sense emmagatzematge */
  }
}

export const VideoPlayer = forwardRef<PlayerHandle, Props>(function VideoPlayer({ source, onError, resumeKey }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytHost = useRef<HTMLDivElement>(null);
  const yt = useRef<YTPlayer | null>(null);
  const [ytReady, setYtReady] = useState(false);

  // Crea el reproductor de YouTube
  useEffect(() => {
    if (source.kind !== 'youtube' || !ytHost.current) return;
    let cancelled = false;
    setYtReady(false);
    const mount = document.createElement('div');
    ytHost.current.innerHTML = '';
    ytHost.current.appendChild(mount);
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        const start = Math.floor(readPos(resumeKey));
        yt.current = new YT.Player(mount, {
          videoId: source.id,
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, ...(start > 0 ? { start } : {}) },
          events: { onReady: () => !cancelled && setYtReady(true) },
        });
      })
      .catch(() => onError?.('youtube_api'));
    return () => {
      cancelled = true;
      try {
        const t = yt.current?.getCurrentTime();
        if (t && t > 0) writePos(resumeKey, t);
      } catch {
        /* reproductor no disponible */
      }
      try {
        yt.current?.destroy();
      } catch {
        /* ja destruït */
      }
      yt.current = null;
    };
  }, [source, onError]);

  // Desa periòdicament on és el vídeo (i en tancar-lo)
  const timeNow = useRef<() => number | null>(() => null);
  timeNow.current = () => {
    if (source.kind === 'file') return videoRef.current ? videoRef.current.currentTime : null;
    try {
      return yt.current && ytReady ? yt.current.getCurrentTime() : null;
    } catch {
      return null;
    }
  };
  useEffect(() => {
    if (!resumeKey) return;
    const save = () => {
      const t = timeNow.current();
      if (t != null && t > 0) writePos(resumeKey, t);
    };
    const id = window.setInterval(save, 2000);
    window.addEventListener('pagehide', save);
    return () => {
      save();
      window.clearInterval(id);
      window.removeEventListener('pagehide', save);
    };
  }, [resumeKey]);

  useImperativeHandle(
    ref,
    () => ({
      getTime() {
        if (source.kind === 'file') return videoRef.current ? videoRef.current.currentTime : null;
        if (!yt.current || !ytReady) return null;
        try {
          return yt.current.getCurrentTime();
        } catch {
          return null;
        }
      },
      seek(t: number) {
        const to = Math.max(0, t);
        if (source.kind === 'file' && videoRef.current) videoRef.current.currentTime = to;
        else if (ytReady) yt.current?.seekTo(to, true);
      },
      play() {
        if (source.kind === 'file') void videoRef.current?.play();
        else if (ytReady) yt.current?.playVideo();
      },
      pause() {
        if (source.kind === 'file') videoRef.current?.pause();
        else if (ytReady) yt.current?.pauseVideo();
      },
      toggle() {
        if (this.isPlaying()) this.pause();
        else this.play();
      },
      isPlaying() {
        if (source.kind === 'file') return !!videoRef.current && !videoRef.current.paused;
        try {
          const st = yt.current?.getPlayerState();
          return ytReady && (st === 1 || st === 3); // reproduint o carregant
        } catch {
          return false;
        }
      },
      setRate(rate: number) {
        if (source.kind === 'file' && videoRef.current) videoRef.current.playbackRate = rate;
        else if (ytReady) yt.current?.setPlaybackRate(rate);
      },
    }),
    [source, ytReady],
  );

  return (
    <div className="video-frame">
      {source.kind === 'file' ? (
        <video
          ref={videoRef}
          src={source.url}
          controls
          playsInline
          preload="metadata"
          onError={() => onError?.('file')}
          onLoadedMetadata={(e) => {
            const pos = readPos(resumeKey);
            if (pos > 0 && pos < e.currentTarget.duration - 1) e.currentTarget.currentTime = pos;
          }}
        />
      ) : (
        <div ref={ytHost} className="yt-host" />
      )}
    </div>
  );
});
