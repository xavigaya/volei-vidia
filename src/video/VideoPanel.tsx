import { useCallback, useEffect, useState, type FormEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../components/ui';
import type { UseMatch } from '../matches/useMatch';
import { eventCode } from '../engine/commands';
import { formatTime, parseYouTubeId } from './youtube';
import { VideoPlayer, type PlayerHandle, type VideoSource } from './VideoPlayer';
import { clampDelay, type AutoPause } from './autoPause';
import { YouTubeUploadDialog } from './YouTubeUploadDialog';

interface Props {
  m: UseMatch;
  source: VideoSource | null;
  setSource: (s: VideoSource | null) => void;
  playerRef: RefObject<PlayerHandle | null>;
  autoPause: AutoPause;
  setAutoPause: (v: AutoPause) => void;
  active?: boolean;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function sourceFromMatch(url: string | null | undefined): VideoSource | null {
  const id = url ? parseYouTubeId(url) : null;
  return id ? { kind: 'youtube', id } : null;
}

export function VideoPanel({ m, source, setSource, playerRef, autoPause, setAutoPause, active = true }: Props) {
  const { t } = useTranslation();
  const match = m.match!;
  const [url, setUrl] = useState(match.video_url ?? '');
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState(1);
  const [syncOpen, setSyncOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const p = () => playerRef.current;
  const skip = useCallback((d: number) => {
    const now = playerRef.current?.getTime();
    if (now != null) playerRef.current?.seek(now + d);
  }, [playerRef]);

  // Dreceres: Ctrl+Espai (reprodueix/pausa), Ctrl+←/→ (−3/+3 s; amb Maj, 10 s)
  useEffect(() => {
    if (!source || !active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        playerRef.current?.toggle();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 3;
        skip(e.key === 'ArrowLeft' ? -step : step);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [source, active, playerRef, skip]);

  async function onYouTube(e: FormEvent) {
    e.preventDefault();
    const id = parseYouTubeId(url);
    if (!id) {
      setError(t('video.badUrl'));
      return;
    }
    setError(null);
    setSource({ kind: 'youtube', id });
    setChanging(false);
    if (m.canCode) await m.saveVideo({ video_url: url.trim(), video_local_name: null });
  }

  function onFile(f: File) {
    if (source?.kind === 'file') URL.revokeObjectURL(source.url);
    setError(null);
    setSource({ kind: 'file', url: URL.createObjectURL(f), name: f.name, file: f });
    setChanging(false);
    if (m.canCode) void m.saveVideo({ video_local_name: f.name, video_url: null });
  }

  const onPlayerError = useCallback((code: string) => setError(t(`video.err.${code}`)), [t]);

  if (!source || changing) {
    return (
      <details className="card video-setup" open={changing || undefined}>
        <summary>
          <span className="video-setup-title">🎬 {t('video.add')}</span>
          {changing && (
            <button className="btn btn-sm" onClick={() => setChanging(false)}>
              {t('common.cancel')}
            </button>
          )}
        </summary>
        <div className="stack video-setup-body">
        <form onSubmit={onYouTube} className="row wrap">
          <input
            className="grow"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('video.youtubePlaceholder')}
            aria-label={t('video.youtube')}
          />
          <button className="btn btn-primary">{t('video.load')}</button>
        </form>
        <div className="row wrap">
          <label className="btn">
            {t('video.localFile')}
            <input
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = '';
              }}
            />
          </label>
          {match.video_local_name && <span className="small muted">{t('video.localHint', { name: match.video_local_name })}</span>}
        </div>
        <p className="small muted">{t('video.help')}</p>
        {error && <div className="error-box">{error}</div>}
        </div>
      </details>
    );
  }

  return (
    <section className="card video-panel stack">
      <VideoPlayer
        ref={playerRef}
        source={source}
        onError={onPlayerError}
        resumeKey={`${match.id}:${source.kind === 'youtube' ? source.id : source.name}`}
      />
      <div className="video-controls row wrap">
        <button className="btn btn-sm" onClick={() => skip(-10)} title="Ctrl+Shift+←">
          ⏪ 10
        </button>
        <button className="btn btn-sm" onClick={() => skip(-3)} title="Ctrl+←">
          ◀ 3
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => p()?.toggle()} title="Ctrl+Espai">
          ⏯
        </button>
        <button className="btn btn-sm" onClick={() => skip(3)} title="Ctrl+→">
          3 ▶
        </button>
        <button className="btn btn-sm" onClick={() => skip(10)} title="Ctrl+Shift+→">
          10 ⏩
        </button>
        <select
          value={rate}
          onChange={(e) => {
            const r = Number(e.target.value);
            setRate(r);
            p()?.setRate(r);
          }}
          aria-label={t('video.speed')}
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
        <span className="grow" />
        {m.canCode && m.events.length > 0 && (
          <button className="btn btn-sm" onClick={() => setSyncOpen(true)}>
            {t('video.sync')}
          </button>
        )}
        {m.canCode && source.kind === 'file' && source.file && (
          <button className="btn btn-sm" onClick={() => setUploadOpen(true)} title={t('youtube.uploadHelp')}>
            ⤒ YouTube
          </button>
        )}
        <button className="btn btn-sm" onClick={() => setChanging(true)}>
          {t('video.change')}
        </button>
      </div>
      {m.canCode && (
        <div className="row wrap small auto-pause">
          <label className="check">
            <input
              type="checkbox"
              checked={autoPause.enabled}
              onChange={(e) => setAutoPause({ ...autoPause, enabled: e.target.checked })}
            />
            {t('video.autoPause')}
          </label>
          <label className="row">
            {t('video.autoPauseResume')}
            <input
              type="number"
              min={0.3}
              max={10}
              step={0.1}
              value={autoPause.delay}
              disabled={!autoPause.enabled}
              onChange={(e) => setAutoPause({ ...autoPause, delay: clampDelay(Number(e.target.value)) })}
              className="num-input"
              aria-label={t('video.autoPauseResume')}
            />
            s
          </label>
        </div>
      )}
      {source.kind === 'file' && <div className="small muted">{source.name}</div>}
      {error && <div className="error-box">{error}</div>}

      {source.kind === 'file' && source.file && (
        <Modal title={t('youtube.uploadTitle')} open={uploadOpen} onClose={() => setUploadOpen(false)}>
          <YouTubeUploadDialog m={m} file={source.file} onClose={() => setUploadOpen(false)} />
        </Modal>
      )}

      <Modal title={t('video.sync')} open={syncOpen} onClose={() => setSyncOpen(false)}>
        <SyncForm m={m} playerRef={playerRef} onDone={() => setSyncOpen(false)} />
      </Modal>
    </section>
  );
}

// Sincronització d'un partit codificat sense vídeo
function SyncForm({ m, playerRef, onDone }: { m: UseMatch; playerRef: RefObject<PlayerHandle | null>; onDone: () => void }) {
  const { t } = useTranslation();
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [result, setResult] = useState<number | null>(null);
  const candidates = m.events.filter((e) => e.type !== 'lineup').slice(0, 40);
  const now = playerRef.current?.getTime() ?? null;

  async function choose(seq: number) {
    const time = playerRef.current?.getTime();
    if (time == null) return;
    setResult(await m.syncVideo(seq, time, onlyMissing));
  }

  if (result !== null) {
    return (
      <div className="stack">
        <div className="notice">{t('video.synced', { count: result })}</div>
        <div className="row end">
          <button className="btn btn-primary" onClick={onDone}>
            {t('common.close')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="small">{t('video.syncHelp', { time: formatTime(now) })}</p>
      <label className="check">
        <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
        {t('video.syncOnlyMissing')}
      </label>
      <div className="pick-grid wide sync-list">
        {candidates.map((e) => (
          <button key={e.seq} className="pick" onClick={() => void choose(e.seq)}>
            <span className="mono small muted">#{e.seq}</span>
            <span className="mono">{eventCode(e)}</span>
            <span className="small muted">{formatTime(e.videoTime)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
