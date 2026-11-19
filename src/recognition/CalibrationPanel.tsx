import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { saveFile } from '../lib/download';
import type { UseMatch } from '../matches/useMatch';
import { formatTime } from '../video/youtube';
import {
  applyH,
  CAL_POINTS,
  courtSegments,
  defaultNearSides,
  NET_HEIGHTS,
  ANTENNA_ABOVE_NET,
  project,
  quality,
  solveCalibration,
  type CalPointKey,
  type Calibration,
  type CalibrationModel,
  type ImgPt,
  type Side,
} from './calibration';
import { jsonBlob, slug } from './exchange';

interface Props {
  m: UseMatch;
  canEdit: boolean;
}

type Frame = { kind: 'video'; url: string; name: string } | { kind: 'image'; url: string; name: string };

const isMissingTable = (msg?: string) => !!msg && /relation .* does not exist|could not find the table|schema cache/i.test(msg);

// "1:23:45", "29:45" o "75" → segons
function parseClock(s: string): number | null {
  const v = s.trim();
  if (!v) return null;
  if (!/^\d+(:\d{1,2}){0,2}$/.test(v)) return null;
  return v.split(':').reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function CalibrationPanel({ m, canEdit }: Props) {
  const { t } = useTranslation();
  const match = m.match!;
  const maxSets = match.sets_to_win * 2 - 1;

  // --- Calibracions desades ---------------------------------------------
  const [saved, setSaved] = useState<Calibration[]>([]);
  const [missing, setMissing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('video_calibrations').select('from_time, data').eq('match_id', match.id).order('from_time');
    if (error) {
      if (isMissingTable(error.message)) setMissing(true);
      else setMsg({ ok: false, text: error.message });
      return;
    }
    setSaved(((data ?? []) as { from_time: number; data: Omit<Calibration, 'fromTime'> }[]).map((r) => ({ ...r.data, fromTime: r.from_time })));
  }, [match.id]);
  useEffect(() => {
    void load();
  }, [load]);

  // --- Calibració en edició ---------------------------------------------
  const [cal, setCal] = useState<Calibration>(() => ({
    fromTime: 0,
    width: 1920,
    height: 1080,
    points: {},
    netHeight: NET_HEIGHTS.M,
    nearSide: defaultNearSides('H', maxSets),
  }));
  const [dirty, setDirty] = useState(false);
  // Només si es mouen els punts la calibració passa a valer des del fotograma actual
  // (canviar els equips o l'inici dels sets no crea un tram nou)
  const [pointsDirty, setPointsDirty] = useState(false);
  const [active, setActive] = useState<CalPointKey>('nl');
  const update = (patch: Partial<Calibration>) => {
    setCal((c) => ({ ...c, ...patch }));
    setDirty(true);
    setMsg(null);
  };
  // En carregar la primera calibració desada, s'obre per editar-la
  const loadedFirst = useRef(false);
  useEffect(() => {
    if (!loadedFirst.current && saved.length) {
      loadedFirst.current = true;
      setCal(saved[0]);
    }
  }, [saved]);

  const model: CalibrationModel = useMemo(() => solveCalibration(cal), [cal]);
  const q = quality(model.rmse, cal.height);

  // --- Fotograma ----------------------------------------------------------
  const [frame, setFrame] = useState<Frame | null>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => () => {
    if (frame) URL.revokeObjectURL(frame.url);
  }, [frame]);

  const draw = useCallback((src: CanvasImageSource, w: number, h: number) => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = w;
    c.height = h;
    c.getContext('2d')?.drawImage(src, 0, 0, w, h);
  }, []);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (file.type.startsWith('video/')) setFrame({ kind: 'video', url, name: file.name });
    else if (file.type.startsWith('image/')) {
      setFrame({ kind: 'image', url, name: file.name });
      const img = new Image();
      img.onload = () => {
        draw(img, img.naturalWidth, img.naturalHeight);
        setCal((c) => ({ ...c, width: img.naturalWidth, height: img.naturalHeight }));
      };
      img.src = url;
    } else setMsg({ ok: false, text: t('recognition.calib.unsupported') });
  }

  function onVideoMeta() {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration || 0);
    setCal((c) => ({ ...c, width: v.videoWidth, height: v.videoHeight }));
    v.currentTime = Math.min(cal.fromTime || 60, (v.duration || 1) - 0.1);
  }

  function onSeeked() {
    const v = videoRef.current;
    if (!v) return;
    setTime(v.currentTime);
    // Es dibuixa quan el fotograma ja està descodificat
    const rv = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (rv.requestVideoFrameCallback) rv.requestVideoFrameCallback(() => draw(v, v.videoWidth, v.videoHeight));
    draw(v, v.videoWidth, v.videoHeight);
    window.setTimeout(() => draw(v, v.videoWidth, v.videoHeight), 150);
  }

  // --- Marcar i arrossegar punts ------------------------------------------
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<CalPointKey | null>(null);

  function toImg(e: PointerEvent): ImgPt | null {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const v = pt.matrixTransform(ctm.inverse());
    return { x: Math.min(1, Math.max(0, v.x / cal.width)), y: Math.min(1, Math.max(0, v.y / cal.height)) };
  }

  function setPoint(key: CalPointKey, p: ImgPt) {
    setPointsDirty(true);
    setCal((c) => ({ ...c, points: { ...c.points, [key]: p } }));
    setDirty(true);
    setMsg(null);
  }

  function onCanvasDown(e: PointerEvent<SVGSVGElement>) {
    if (!canEdit || drag.current) return;
    const p = toImg(e);
    if (!p) return;
    setPoint(active, p);
    // Passa al següent punt sense marcar
    const next = CAL_POINTS.find((k) => k !== active && !cal.points[k]);
    if (next) setActive(next);
  }

  function onPointDown(e: PointerEvent<SVGGElement>, key: CalPointKey) {
    e.stopPropagation();
    setActive(key);
    if (!canEdit) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = key;
  }

  function onPointMove(e: PointerEvent<SVGGElement>) {
    if (!drag.current) return;
    const p = toImg(e);
    if (p) setPoint(drag.current, p);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const p = cal.points[active];
    if (!p || !canEdit) return;
    const step = (e.shiftKey ? 5 : 1) / cal.width;
    const stepY = (e.shiftKey ? 5 : 1) / cal.height;
    const moves: Record<string, ImgPt> = {
      ArrowLeft: { x: p.x - step, y: p.y },
      ArrowRight: { x: p.x + step, y: p.y },
      ArrowUp: { x: p.x, y: p.y - stepY },
      ArrowDown: { x: p.x, y: p.y + stepY },
    };
    if (moves[e.key]) {
      e.preventDefault();
      setPoint(active, moves[e.key]);
    }
  }

  // --- Superposició de la pista projectada ---------------------------------
  const toPx = (u: number, v: number, z = 0): [number, number] | null => {
    if (model.camera) return project(model.camera, u, v, z);
    if (model.ground && z === 0) return applyH(model.ground, u, v);
    return null;
  };
  const r = Math.max(cal.width, cal.height) / 160;
  const overlayLines: { a: [number, number]; b: [number, number]; cls: string }[] = [];
  if (model.ground || model.camera) {
    for (const s of courtSegments()) {
      const a = toPx(s.a[0], s.a[1]);
      const b = toPx(s.b[0], s.b[1]);
      if (a && b) overlayLines.push({ a, b, cls: `cal-${s.kind}` });
    }
    for (const u of [3, 6]) {
      const a = toPx(u, 0);
      const b = toPx(u, 18);
      if (a && b) overlayLines.push({ a, b, cls: 'cal-grid' });
    }
    for (const v of [3, 15]) {
      const a = toPx(0, v);
      const b = toPx(9, v);
      if (a && b) overlayLines.push({ a, b, cls: 'cal-grid' });
    }
  }
  if (model.camera) {
    const h = cal.netHeight;
    const pairs: [[number, number, number], [number, number, number], string][] = [
      [[0, 9, h], [9, 9, h], 'cal-net'],
      [[0, 9, h - 1], [9, 9, h - 1], 'cal-net-low'],
      [[0, 9, h], [0, 9, h + ANTENNA_ABOVE_NET], 'cal-antenna'],
      [[9, 9, h], [9, 9, h + ANTENNA_ABOVE_NET], 'cal-antenna'],
    ];
    for (const [a, b, cls] of pairs) overlayLines.push({ a: project(model.camera, ...a), b: project(model.camera, ...b), cls });
  }

  // --- Desar, carregar, eliminar, exportar --------------------------------
  const complete = (['nl', 'nr', 'fr', 'fl'] as CalPointKey[]).every((k) => cal.points[k]);

  async function save() {
    const isSaved = saved.some((c) => c.fromTime === cal.fromTime);
    const fromTime = frame?.kind === 'video' && (pointsDirty || !isSaved) ? Math.round(time * 10) / 10 : cal.fromTime;
    const data = { width: cal.width, height: cal.height, netHeight: cal.netHeight, points: cal.points, nearSide: cal.nearSide, setStarts: cal.setStarts ?? {} };
    const { error } = await supabase
      .from('video_calibrations')
      .upsert({ match_id: match.id, club_id: match.club_id, from_time: fromTime, data });
    if (error) {
      setMsg({ ok: false, text: isMissingTable(error.message) ? t('recognition.calib.missingMigration') : error.message });
      return;
    }
    setCal((c) => ({ ...c, fromTime }));
    setDirty(false);
    setPointsDirty(false);
    setMsg({ ok: true, text: t('recognition.calib.saved', { time: formatTime(fromTime) }) });
    await load();
  }

  async function remove(c: Calibration) {
    if (!window.confirm(t('recognition.calib.confirmDelete', { time: formatTime(c.fromTime) }))) return;
    const { error } = await supabase.from('video_calibrations').delete().eq('match_id', match.id).eq('from_time', c.fromTime);
    if (error) setMsg({ ok: false, text: error.message });
    await load();
  }

  async function exportJson() {
    const list = saved.length ? saved : [cal];
    const data = {
      format: 'volei-vidia/calibration',
      version: 1,
      match: { home: match.home.name, away: match.away.name, video: match.video_local_name ?? match.video_url ?? null },
      calibrations: list.map((c) => {
        const mm = solveCalibration(c);
        return { ...c, model: { ground: mm.ground, camera: mm.camera, rmse: mm.rmse } };
      }),
    };
    await saveFile(`${slug('calibracio', match.home.name, match.away.name)}.json`, jsonBlob(data)).catch((e: Error) =>
      setMsg({ ok: false, text: e.message }),
    );
  }

  if (missing) return <div className="notice">{t('recognition.calib.missingMigration')}</div>;

  const teamName = (s: Side) => (s === 'H' ? match.home.name : match.away.name);
  const presetValue = cal.netHeight === NET_HEIGHTS.M ? 'M' : cal.netHeight === NET_HEIGHTS.F ? 'F' : 'X';

  return (
    <div className="stack cal-panel">
      <p className="muted small">{t('recognition.calib.help')}</p>

      <div className="row wrap cal-toolbar">
        <label className="btn btn-sm">
          {frame ? t('recognition.calib.changeFile') : t('recognition.calib.openFile')}
          <input type="file" accept="video/*,image/*" hidden onChange={onFile} />
        </label>
        {match.video_local_name && !frame && <span className="small muted">{t('recognition.calib.localHint', { name: match.video_local_name })}</span>}
        {frame && (
          <>
            <button className="btn btn-sm" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label={t('recognition.sheet.viewer.zoomOut')}>
              −
            </button>
            <span className="small mono">{Math.round(zoom * 100)}%</span>
            <button className="btn btn-sm" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} aria-label={t('recognition.sheet.viewer.zoomIn')}>
              +
            </button>
          </>
        )}
      </div>

      {frame?.kind === 'video' && (
        <div className="row wrap cal-seek">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={time}
            onChange={(e) => {
              const v = videoRef.current;
              const tt = Number(e.target.value);
              setTime(tt);
              if (v) v.currentTime = tt;
            }}
            aria-label={t('recognition.calib.frameTime')}
          />
          <span className="mono small">
            {formatTime(time)} / {formatTime(duration)}
          </span>
          <span className="small muted">{t('recognition.calib.fromTimeHelp')}</span>
          {/* Invisible però no amagat: amb display:none alguns navegadors no descodifiquen el fotograma */}
          <video
            ref={videoRef}
            src={frame.url}
            muted
            playsInline
            preload="auto"
            className="cal-video"
            onLoadedMetadata={onVideoMeta}
            onLoadedData={onSeeked}
            onSeeked={onSeeked}
          />
        </div>
      )}
      {frame?.kind === 'image' && (
        <label className="field cal-inline">
          <span>{t('recognition.calib.fromTime')}</span>
          <input type="number" min={0} step={1} value={cal.fromTime} onChange={(e) => update({ fromTime: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
      )}
      {!frame && <div className="notice small">{t('recognition.calib.noFrame')}</div>}

      <div className="cal-editor">
        <div className="cal-frame" tabIndex={0} onKeyDown={onKey} aria-label={t('recognition.calib.frameLabel')}>
          <div className="cal-stage" style={{ width: `${zoom * 100}%`, aspectRatio: `${cal.width} / ${cal.height}` }}>
            <canvas ref={canvasRef} className="cal-canvas" />
            <svg
              ref={svgRef}
              className={`cal-overlay ${canEdit ? 'editable' : ''}`}
              viewBox={`0 0 ${cal.width} ${cal.height}`}
              preserveAspectRatio="none"
              onPointerDown={onCanvasDown}
            >
              {overlayLines.map((l, i) => (
                <line key={i} x1={l.a[0]} y1={l.a[1]} x2={l.b[0]} y2={l.b[1]} className={l.cls} style={{ strokeWidth: r / 4 }} />
              ))}
              {CAL_POINTS.map((key) => {
                const p = cal.points[key];
                if (!p) return null;
                const err = model.errors[key];
                return (
                  <g
                    key={key}
                    className={`cal-point ${active === key ? 'active' : ''} ${key.startsWith('n') && key.length === 2 ? 'near' : ''} ${key.startsWith('f') ? 'far' : ''} ${err != null && err > 8 ? 'bad' : ''}`}
                    transform={`translate(${p.x * cal.width} ${p.y * cal.height})`}
                    onPointerDown={(e) => onPointDown(e, key)}
                    onPointerMove={onPointMove}
                    onPointerUp={() => (drag.current = null)}
                    onPointerCancel={() => (drag.current = null)}
                  >
                    <circle r={r} style={{ strokeWidth: r / 4 }} />
                    <line x1={-r * 2} y1={0} x2={r * 2} y2={0} style={{ strokeWidth: r / 6 }} />
                    <line x1={0} y1={-r * 2} x2={0} y2={r * 2} style={{ strokeWidth: r / 6 }} />
                    <text x={r * 1.4} y={-r * 1.4} style={{ fontSize: r * 2.2 }}>
                      {CAL_POINTS.indexOf(key) + 1}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        <div className="stack-sm cal-side">
          <ol className="cal-steps">
            {CAL_POINTS.map((key) => (
              <li key={key}>
                <button className={`cal-step ${active === key ? 'on' : ''} ${cal.points[key] ? 'done' : ''}`} onClick={() => setActive(key)}>
                  <span className="mono">{CAL_POINTS.indexOf(key) + 1}</span> {t(`recognition.calib.points.${key}`)}
                  {cal.points[key] ? ' ✓' : ''}
                  {model.errors[key] != null && <span className="muted small"> · {model.errors[key]!.toFixed(1)} px</span>}
                </button>
              </li>
            ))}
          </ol>
          {canEdit && cal.points[active] && (
            <button
              className="btn btn-sm"
              onClick={() => {
                setPointsDirty(true);
                const points = { ...cal.points };
                delete points[active];
                update({ points });
              }}
            >
              {t('recognition.calib.clearPoint')}
            </button>
          )}
          <div className="small">
            {!complete ? (
              <span className="muted">{t('recognition.calib.needCorners')}</span>
            ) : !model.camera ? (
              <span className="muted">{t('recognition.calib.groundOnly')}</span>
            ) : (
              <span className={q === 'good' ? 'ok' : q === 'fair' ? 'warn' : 'warn-text'}>
                {t(`recognition.calib.quality.${q}`, { rmse: model.rmse!.toFixed(1) })}
              </span>
            )}
          </div>
          <p className="small muted">{t('recognition.calib.editHelp')}</p>
        </div>
      </div>

      <div className="grid-2">
        <fieldset className="card stack-sm" disabled={!canEdit}>
          <legend>{t('recognition.calib.net')}</legend>
          <div className="row wrap">
            <select
              value={presetValue}
              onChange={(e) => {
                const v = e.target.value as 'M' | 'F' | 'X';
                if (v !== 'X') update({ netHeight: NET_HEIGHTS[v] });
              }}
            >
              <option value="M">{t('recognition.calib.netM')}</option>
              <option value="F">{t('recognition.calib.netF')}</option>
              <option value="X">{t('recognition.calib.netOther')}</option>
            </select>
            <input
              type="number"
              className="num-input"
              min={1.5}
              max={2.6}
              step={0.01}
              value={cal.netHeight}
              onChange={(e) => update({ netHeight: Number(e.target.value) || NET_HEIGHTS.M })}
              aria-label={t('recognition.calib.net')}
            />
            <span className="small muted">m</span>
          </div>
        </fieldset>
        <fieldset className="card stack-sm" disabled={!canEdit}>
          <legend>{t('recognition.calib.sides')}</legend>
          <div className="row wrap">
            <span className="small">{t('recognition.calib.firstSet')}</span>
            <div className="segmented small-seg">
              {(['H', 'A'] as Side[]).map((s) => (
                <button key={s} type="button" className={cal.nearSide[1] === s ? 'on' : ''} onClick={() => update({ nearSide: defaultNearSides(s, maxSets) })}>
                  {teamName(s)}
                </button>
              ))}
            </div>
          </div>
          <table className="cal-sets-table">
            <thead>
              <tr>
                <th>{t('recognition.set')}</th>
                <th>{t('recognition.calib.nearTeam')}</th>
                <th>{t('recognition.calib.setStart')}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: maxSets }, (_, i) => i + 1).map((n) => (
                <tr key={n}>
                  <td className="center">{n}</td>
                  <td>
                    <select
                      value={cal.nearSide[n] ?? ''}
                      onChange={(e) => update({ nearSide: { ...cal.nearSide, [n]: e.target.value as Side } })}
                      aria-label={`${t('recognition.set')} ${n}`}
                    >
                      <option value="H">{teamName('H')}</option>
                      <option value="A">{teamName('A')}</option>
                    </select>
                  </td>
                  <td className="row nowrap">
                    <input
                      className="mono cal-time"
                      placeholder="mm:ss"
                      inputMode="numeric"
                      defaultValue={cal.setStarts?.[n] != null ? formatTime(cal.setStarts[n]) : ''}
                      key={`${n}-${cal.setStarts?.[n] ?? ''}`}
                      onBlur={(e) => {
                        const v = parseClock(e.target.value);
                        const setStarts = { ...(cal.setStarts ?? {}) };
                        if (v == null) delete setStarts[n];
                        else setStarts[n] = v;
                        update({ setStarts });
                      }}
                      aria-label={t('recognition.calib.setStart')}
                    />
                    {frame?.kind === 'video' && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        title={t('recognition.calib.useFrameTime')}
                        onClick={() => update({ setStarts: { ...(cal.setStarts ?? {}), [n]: Math.round(time) } })}
                      >
                        ⏱
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">{t('recognition.calib.sidesHelp')}</p>
          <p className="small muted">{t('recognition.calib.setStartHelp')}</p>
        </fieldset>
      </div>

      <div className="row wrap">
        {canEdit && (
          <button className="btn btn-primary" disabled={!complete || (!dirty && saved.length > 0)} onClick={() => void save()}>
            {frame?.kind === 'video' && (pointsDirty || !saved.some((c) => c.fromTime === cal.fromTime))
              ? t('recognition.calib.saveFrom', { time: formatTime(time) })
              : t('recognition.calib.saveFrom', { time: formatTime(cal.fromTime) })}
          </button>
        )}
        <button className="btn" onClick={() => void exportJson()} disabled={!complete && saved.length === 0}>
          {t('recognition.json.export')}
        </button>
        {dirty && <span className="muted small">{t('recognition.unsaved')}</span>}
        {msg && <span className={msg.ok ? 'ok' : 'warn-text'}>{msg.text}</span>}
      </div>

      {saved.length > 0 && (
        <div className="card stack-sm">
          <strong>{t('recognition.calib.savedList')}</strong>
          <ul className="cal-saved">
            {saved.map((c) => {
              const mm = solveCalibration(c);
              const qq = quality(mm.rmse, c.height);
              return (
                <li key={c.fromTime} className="row wrap">
                  <span className="mono">{t('recognition.calib.fromLabel', { time: formatTime(c.fromTime) })}</span>
                  <span className="small muted">
                    {c.width}×{c.height}
                    {qq ? ` · ${t(`recognition.calib.quality.${qq}`, { rmse: mm.rmse!.toFixed(1) })}` : ''}
                  </span>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      setCal(c);
                      setDirty(false);
                    }}
                  >
                    {t('common.edit')}
                  </button>
                  {canEdit && (
                    <button className="btn btn-sm btn-danger" onClick={() => void remove(c)}>
                      {t('common.delete')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="small muted">{t('recognition.calib.segmentsHelp')}</p>
        </div>
      )}
    </div>
  );
}
