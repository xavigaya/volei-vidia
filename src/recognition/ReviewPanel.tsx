import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { saveFile } from '../lib/download';
import type { UseMatch } from '../matches/useMatch';
import { VideoPlayer, type PlayerHandle, type VideoSource } from '../video/VideoPlayer';
import { sourceFromMatch } from '../video/VideoPanel';
import { formatTime } from '../video/youtube';
import { jsonBlob, slug } from './exchange';
import { rallySequence, type Rally } from './scoresheet';
import {
  emptyReview,
  guessSkills,
  importDetections,
  reviewToJson,
  setAt,
  summarize,
  workList,
  type Detections,
  type ReviewState,
  type WorkRally,
} from './review';
import type { UseRecognition } from './useRecognition';

interface Props {
  m: UseMatch;
  r: UseRecognition;
  canEdit: boolean;
}

const isMissingTable = (msg?: string) => !!msg && /relation .* does not exist|could not find the table|schema cache/i.test(msg);
const PRE = 2; // segons de marge abans i després de la jugada en reproduir-la
const POST = 2;

export function ReviewPanel({ m, r, canEdit }: Props) {
  const { t } = useTranslation();
  const match = m.match!;

  // --- Dades desades ------------------------------------------------------
  const [det, setDet] = useState<Detections | null>(null);
  const [review, setReview] = useState<ReviewState>(emptyReview);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState<'idle' | 'pending' | 'saving' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.from('vision_reviews').select('detections, review').eq('match_id', match.id).maybeSingle();
      if (cancelled) return;
      if (error) {
        if (isMissingTable(error.message)) setMissing(true);
        else setMsg({ ok: false, text: error.message });
      } else if (data) {
        setDet(data.detections as Detections);
        const rv = (data.review ?? {}) as Partial<ReviewState>;
        setReview({ rallies: rv.rallies ?? {}, added: rv.added ?? [] });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [match.id]);

  // Desa la revisió poc després de cada canvi
  const saveTimer = useRef<number | null>(null);
  const latest = useRef(review);
  latest.current = review;
  const persist = useCallback(async () => {
    setSaving('saving');
    const { error } = await supabase.from('vision_reviews').update({ review: latest.current }).eq('match_id', match.id);
    setSaving(error ? 'error' : 'idle');
    if (error) setMsg({ ok: false, text: error.message });
  }, [match.id]);
  const changeReview = (f: (rv: ReviewState) => ReviewState) => {
    if (!canEdit) return;
    setReview((prev) => f(structuredClone(prev)));
    setSaving('pending');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void persist(), 800);
  };
  useEffect(
    () => () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        void persist();
      }
    },
    [persist],
  );

  async function onImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMsg({ ok: true, text: t('recognition.review.importing') });
    const res = importDetections(await file.text());
    if (!res.ok) {
      setMsg({ ok: false, text: t(`recognition.review.importErrors.${res.error}`) });
      return;
    }
    const hasReview = Object.keys(review.rallies).length > 0 || review.added.length > 0;
    if (det && hasReview && !window.confirm(t('recognition.review.replace'))) return;
    const fresh = emptyReview();
    const { error } = await supabase
      .from('vision_reviews')
      .upsert({ match_id: match.id, club_id: match.club_id, detections: res.detections, review: fresh });
    if (error) {
      setMsg({ ok: false, text: isMissingTable(error.message) ? t('recognition.review.missingMigration') : error.message });
      return;
    }
    setDet(res.detections);
    setReview(fresh);
    setCurrent(0);
    setMsg({ ok: true, text: t('recognition.review.imported', { count: res.detections.rallies.length }) });
  }

  // --- Acta i llista de treball ------------------------------------------------
  const acta = useMemo(() => {
    const out: Record<number, Rally[]> = {};
    const tiebreak = match.sets_to_win * 2 - 1;
    for (const s of r.scoresheet?.sets ?? []) {
      const seq = rallySequence(s, s.number === tiebreak ? match.tiebreak_points : match.points_per_set);
      if (seq.rallies.length) out[s.number] = seq.rallies;
    }
    return out;
  }, [r.scoresheet, match]);
  const list = useMemo(() => workList(det, review, acta), [det, review, acta]);
  const summary = useMemo(() => summarize(list), [list]);
  const sets = useMemo(() => [...new Set(list.map((w) => w.set).filter((s): s is number => s != null))].sort(), [list]);
  const [setFilter, setSetFilter] = useState<number | 'all'>('all');
  const [onlyPending, setOnlyPending] = useState(false);
  const visible = useMemo(
    () => list.filter((w) => (setFilter === 'all' || w.set === setFilter) && (!onlyPending || w.status === 'pending')),
    [list, setFilter, onlyPending],
  );
  const [current, setCurrent] = useState(0);
  const cur: WorkRally | null = visible[Math.min(current, visible.length - 1)] ?? null;

  // --- Vídeo ------------------------------------------------------------------
  const [source, setSource] = useState<VideoSource | null>(() => sourceFromMatch(match.video_url));
  const player = useRef<PlayerHandle | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const stopAt = useRef<number | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const tt = player.current?.getTime() ?? null;
      setNow(tt);
      if (tt != null && stopAt.current != null && tt >= stopAt.current) {
        player.current?.pause();
        stopAt.current = null;
      }
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  const playRally = useCallback((w: WorkRally | null) => {
    if (!w || !player.current) return;
    player.current.seek(w.start - PRE);
    stopAt.current = w.end + POST;
    player.current.play();
  }, []);

  // En canviar de jugada, el vídeo hi salta
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (cur && cur.key !== lastKey.current) {
      lastKey.current = cur.key;
      if (player.current) {
        stopAt.current = null;
        player.current.pause();
        player.current.seek(cur.start - PRE);
      }
    }
  }, [cur]);

  // --- Accions de revisió ----------------------------------------------------
  const setStatus = (w: WorkRally, status: 'ok' | 'rejected' | 'pending') => {
    if (w.detected) {
      const id = w.detected.id;
      changeReview((rv) => {
        rv.rallies[id] = { ...(rv.rallies[id] ?? {}), status };
        return rv;
      });
    } else if (status === 'rejected') {
      const id = w.key.slice(1);
      changeReview((rv) => ({ ...rv, added: rv.added.filter((a) => a.id !== id) }));
    }
  };
  const next = () => setCurrent((i) => Math.min(i + 1, Math.max(visible.length - 1, 0)));
  const prev = () => setCurrent((i) => Math.max(i - 1, 0));
  const decide = (status: 'ok' | 'rejected') => {
    if (!cur) return;
    setStatus(cur, status);
    // Amb el filtre de pendents, la jugada desapareix de la llista: no cal avançar
    if (!onlyPending) next();
  };
  const setBound = (which: 'start' | 'end') => {
    if (!cur || now == null) return;
    const v = Math.round(now * 10) / 10;
    if (cur.detected) {
      const id = cur.detected.id;
      changeReview((rv) => {
        const old = rv.rallies[id] ?? { status: 'pending' as const };
        rv.rallies[id] = { ...old, [which]: v };
        return rv;
      });
    } else {
      const id = cur.key.slice(1);
      changeReview((rv) => {
        rv.added = rv.added.map((a) => (a.id === id ? { ...a, [which]: v } : a));
        return rv;
      });
    }
  };
  const resetBounds = () => {
    if (!cur?.detected) return;
    const id = cur.detected.id;
    changeReview((rv) => {
      rv.rallies[id] = { status: rv.rallies[id]?.status ?? 'pending' };
      return rv;
    });
  };
  const addRally = () => {
    if (now == null) return;
    const start = Math.round(now * 10) / 10;
    const id = Math.random().toString(36).slice(2, 9);
    const set = setFilter === 'all' ? setAt(list, start) : setFilter;
    changeReview((rv) => ({ ...rv, added: [...rv.added, { id, set, start, end: start + 6 }] }));
    setMsg({ ok: true, text: t('recognition.review.addedHelp') });
  };

  // Teclat (quan no s'escriu en un camp)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const handled = (() => {
      if (k === 'Enter' && canEdit) decide('ok');
      else if ((k === 'Delete' || k === 'Backspace' || k === 'x' || k === 'X') && canEdit) decide('rejected');
      else if (k === 'ArrowRight' || k === 'j' || k === 'J') next();
      else if (k === 'ArrowLeft' || k === 'k' || k === 'K') prev();
      else if (k === ' ') player.current?.toggle();
      else if (k === 'p' || k === 'P') playRally(cur);
      else if ((k === 'i' || k === 'I') && canEdit) setBound('start');
      else if ((k === 'f' || k === 'F') && canEdit) setBound('end');
      else if ((k === 'a' || k === 'A') && canEdit) addRally();
      else if (k === ',') player.current && now != null && player.current.seek(now - 2);
      else if (k === '.') player.current && now != null && player.current.seek(now + 2);
      else return false;
      return true;
    })();
    if (handled) e.preventDefault();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  async function exportReview() {
    const date = match.played_at ? match.played_at.slice(0, 10) : null;
    const data = reviewToJson(det, list, { home: match.home.name, away: match.away.name, date });
    await saveFile(`${slug('revisio', match.home.name, match.away.name, date)}.json`, jsonBlob(data)).catch((e: Error) =>
      setMsg({ ok: false, text: e.message }),
    );
  }

  function openLocal(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) setSource({ kind: 'file', url: URL.createObjectURL(file), name: file.name, file });
  }

  if (loading) return <div className="muted">{t('app.loading')}</div>;
  if (missing) return <div className="notice">{t('recognition.review.missingMigration')}</div>;

  const teamName = (s: string | null | undefined) => (s === 'H' ? match.home.name : s === 'A' ? match.away.name : '—');
  const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)} %`);
  const skills = cur?.detected ? guessSkills(cur.detected.contacts, cur.acta?.server ?? null) : [];

  return (
    <div className="stack rv-panel">
      <p className="muted small">{t('recognition.review.help')}</p>
      <div className="row wrap rv-toolbar">
        {canEdit && (
          <label className="btn btn-sm">
            {det ? t('recognition.review.reimport') : t('recognition.review.import')}
            <input type="file" accept="application/json,.json" hidden onChange={(e) => void onImport(e)} />
          </label>
        )}
        <label className="btn btn-sm">
          {t('recognition.review.openLocal')}
          <input type="file" accept="video/*" hidden onChange={openLocal} />
        </label>
        {det && (
          <button className="btn btn-sm" onClick={() => void exportReview()}>
            {t('recognition.review.export')}
          </button>
        )}
        {saving !== 'idle' && <span className="small muted">{t(`recognition.review.saving.${saving}`)}</span>}
        {msg && <span className={`small ${msg.ok ? 'ok' : 'warn-text'}`}>{msg.text}</span>}
      </div>

      {!det ? (
        <div className="notice">{t('recognition.review.empty')}</div>
      ) : (
        <>
          <div className="rv-summary card">
            <span>
              <strong>{summary.detected}</strong> {t('recognition.review.sum.detected')}
            </span>
            <span className="ok">
              ✓ {summary.ok} {t('recognition.review.sum.ok')}
            </span>
            <span className="warn">
              ✗ {summary.rejected} {t('recognition.review.sum.rejected')}
            </span>
            <span>
              + {summary.added} {t('recognition.review.sum.added')}
            </span>
            <span className="muted">
              {summary.pending} {t('recognition.review.sum.pending')}
            </span>
            <span title={t('recognition.review.sum.precisionHelp')}>
              {t('recognition.review.sum.precision')}: <strong>{pct(summary.precision)}</strong>
            </span>
            <span title={t('recognition.review.sum.recallHelp')}>
              {t('recognition.review.sum.recall')}: <strong>{pct(summary.recall)}</strong>
            </span>
          </div>

          <div className="rv-layout">
            <div className="stack-sm rv-video">
              {source ? (
                <VideoPlayer ref={player} source={source} />
              ) : (
                <div className="notice">{t('recognition.review.noVideo')}</div>
              )}
              {cur && (
                <div className="card stack-sm rv-current">
                  <div className="row wrap rv-current-head">
                    <strong>
                      {t('recognition.set')} {cur.set ?? '?'} · {cur.index != null ? t('recognition.review.point', { n: cur.index + 1 }) : t('recognition.review.discarded')}
                    </strong>
                    <span className="mono small">
                      {formatTime(cur.start)} – {formatTime(cur.end)} ({Math.round(cur.end - cur.start)} s)
                    </span>
                    <span className={`badge rv-st-${cur.status}`}>{t(`recognition.review.status.${cur.status}`)}</span>
                    {!cur.detected && <span className="badge">{t('recognition.review.manual')}</span>}
                    {cur.adjusted && <span className="badge">{t('recognition.review.adjusted')}</span>}
                  </div>
                  {cur.acta && (
                    <div className="small">
                      {t('recognition.review.actaInfo', {
                        score: `${cur.acta.before.h}-${cur.acta.before.a}`,
                        server: teamName(cur.acta.server),
                        player: cur.acta.serverPlayer ?? '?',
                        winner: teamName(cur.acta.winner),
                      })}
                    </div>
                  )}
                  {cur.detected && (
                    <div className="small muted">
                      {t('recognition.review.detInfo', {
                        contacts: cur.detected.contacts.length,
                        audio: cur.detected.contacts.filter((c) => c.audio).length,
                        net: cur.detected.aboveNet ?? '—',
                      })}
                      {cur.detected.whistle ? ` · ${t('recognition.review.whistle')}` : ''}
                    </div>
                  )}
                  <div className="row wrap rv-buttons">
                    <button className="btn btn-sm" onClick={prev} title="←">
                      ◀
                    </button>
                    <button className="btn btn-sm" onClick={() => playRally(cur)} title="P">
                      ▶ {t('recognition.review.play')}
                    </button>
                    {canEdit && (
                      <>
                        <button className="btn btn-sm btn-primary" onClick={() => decide('ok')} title="Retorn">
                          ✓ {t('recognition.review.confirm')}
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => decide('rejected')} title="Supr">
                          ✗ {cur.detected ? t('recognition.review.reject') : t('recognition.review.remove')}
                        </button>
                        {cur.status !== 'pending' && cur.detected && (
                          <button className="btn btn-sm" onClick={() => setStatus(cur, 'pending')}>
                            ↺ {t('recognition.review.undo')}
                          </button>
                        )}
                        <button className="btn btn-sm" onClick={() => setBound('start')} title="I">
                          [ {t('recognition.review.setStart')}
                        </button>
                        <button className="btn btn-sm" onClick={() => setBound('end')} title="F">
                          ] {t('recognition.review.setEnd')}
                        </button>
                        {cur.adjusted && (
                          <button className="btn btn-sm" onClick={resetBounds}>
                            {t('recognition.review.resetBounds')}
                          </button>
                        )}
                        <button className="btn btn-sm" onClick={addRally} title="A">
                          + {t('recognition.review.add')}
                        </button>
                      </>
                    )}
                    <button className="btn btn-sm" onClick={next} title="→">
                      ▶▶
                    </button>
                  </div>
                  {cur.detected && cur.detected.contacts.length > 0 && (
                    <div className="rv-contacts">
                      {cur.detected.contacts.map((c, i) => (
                        <button
                          key={i}
                          className={`chip-btn rv-contact ${c.audio ? 'audio' : ''} ${now != null && Math.abs(now - c.t) < 0.25 ? 'on' : ''}`}
                          onClick={() => {
                            stopAt.current = null;
                            player.current?.seek(c.t - 1);
                            player.current?.play();
                          }}
                          title={`${formatTime(c.t)} · ${c.audio ? t('recognition.review.sound') : ''} ${c.visual ? t('recognition.review.ball') : ''}`}
                        >
                          <span className="mono">{skills[i] ?? '·'}</span>
                          <span className="small">{c.side === 'H' || c.side === 'A' ? (c.side === 'H' ? match.home.short_name ?? 'L' : match.away.short_name ?? 'V') : ''}</span>
                          <span className="small muted">+{(c.t - cur.start).toFixed(1)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="small muted">{t('recognition.review.keys')}</p>
                </div>
              )}
            </div>

            <div className="stack-sm rv-list-col">
              <div className="row wrap">
                <select value={setFilter} onChange={(e) => { setSetFilter(e.target.value === 'all' ? 'all' : Number(e.target.value)); setCurrent(0); }}>
                  <option value="all">{t('recognition.review.allSets')}</option>
                  {sets.map((s) => (
                    <option key={s} value={s}>
                      {t('recognition.set')} {s} ({list.filter((w) => w.set === s && w.index != null).length}
                      {acta[s] ? `/${acta[s].length}` : ''})
                    </option>
                  ))}
                </select>
                <label className="check small">
                  <input type="checkbox" checked={onlyPending} onChange={(e) => { setOnlyPending(e.target.checked); setCurrent(0); }} />
                  {t('recognition.review.onlyPending')}
                </label>
              </div>
              <ol className="rv-list">
                {visible.map((w, i) => (
                  <li key={w.key}>
                    <button className={`rv-item rv-st-${w.status} ${cur?.key === w.key ? 'on' : ''}`} onClick={() => setCurrent(i)}>
                      <span className="rv-mark">{w.status === 'ok' ? '✓' : w.status === 'rejected' ? '✗' : '·'}</span>
                      <span className="mono small">{formatTime(w.start)}</span>
                      <span className="small">
                        {w.set != null && `S${w.set}`}
                        {w.index != null && ` #${w.index + 1}`}
                        {w.acta && ` ${w.acta.before.h}-${w.acta.before.a}`}
                      </span>
                      <span className="small muted">{w.detected ? `${w.detected.contacts.length}c` : t('recognition.review.manualShort')}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
