import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SideCode } from '../lib/types';
import type { UseMatch } from '../matches/useMatch';
import { playersBySlot, ROMAN, rotationInfo, SYSTEM_CODES, SYSTEMS, type SpotLabel, type SystemCode } from './gameSystems';
import {
  checkOverlap,
  formatReception,
  parseReception,
  receivingCourt,
  rotationReception,
  spotsByPosition,
  TEMPLATE_CODES,
  type ReceptionSystem,
  type RotationReception,
  type Spot,
  type TemplateCode,
} from './reception';
import type { UseRecognition } from './useRecognition';

interface Props {
  m: UseMatch;
  r: UseRecognition;
  canEdit: boolean;
}

const VIEW = { x: -1, y: -1.6, w: 11, h: 12.4 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 10) / 10;

export function ReceptionPanel({ m, r, canEdit }: Props) {
  const { t } = useTranslation();
  const match = m.match!;
  const [side, setSide] = useState<SideCode>(match.home.is_own || !match.away.is_own ? 'H' : 'A');

  // Sistema de joc de l'equip: el del primer set (desat o deduït)
  const firstSet = r.setSystemsList.find((x) => x.side === side && x.set === 1) ?? null;
  const [code, setCode] = useState<SystemCode>(firstSet?.current?.code ?? '51');
  useEffect(() => {
    setCode(firstSet?.current?.code ?? '51');
  }, [side, firstSet?.current?.code]);

  const hasLibero = m.players.some((p) => p.side === side && p.is_libero);
  const saved = r.receptionFor(side, code, hasLibero);
  const [rs, setRs] = useState<ReceptionSystem>(saved);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setRs(r.receptionFor(side, code, hasLibero));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, code, r.receptionFor]);

  const [rotation, setRotation] = useState(1);
  const [selected, setSelected] = useState<SpotLabel | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Dorsals de cada etiqueta (segons la formació del primer set)
  const numbers = useMemo(() => {
    const map: Partial<Record<SpotLabel, number>> = {};
    const set1 = m.state?.sets[0];
    if (firstSet?.current && firstSet.current.code === code && set1) {
      const bySlot = playersBySlot(firstSet.current, firstSet.lineup);
      SYSTEMS[code].labels.forEach((label, i) => (map[label] = bySlot[i]));
      const lib = set1.startLineups[side].defaultLibero ?? set1.startLineups[side].liberos[0];
      if (lib != null) map.L = lib;
    }
    return map;
  }, [firstSet, code, side, m.state]);

  const rec = rotationReception(rs, rotation);
  const court = receivingCourt(rs.system, rotation, rs.hasLibero);
  const byPos = spotsByPosition(rs, rotation, rec);
  const violations = checkOverlap(byPos);
  const badPositions = new Set(violations.flatMap((v) => [v.a, v.b]));
  const color = side === 'H' ? match.home.color ?? 'var(--brand)' : match.away.color ?? 'var(--brand)';

  function change(next: RotationReception) {
    setRs((prev) => ({ ...prev, rotations: { ...prev.rotations, [rotation]: next } }));
    setDirty(true);
    setMsg(null);
  }

  function moveSpot(label: SpotLabel, spot: Spot) {
    change({ ...rec, spots: { ...rec.spots, [label]: { l: round(clamp(spot.l, 0, 9)), d: round(clamp(spot.d, 0, 10)) } } });
  }

  function toggleReceiver(label: SpotLabel) {
    const receivers = rec.receivers.includes(label) ? rec.receivers.filter((x) => x !== label) : [...rec.receivers, label];
    change({ ...rec, receivers });
  }

  function resetRotation(all = false) {
    setRs((prev) => {
      const rotations = { ...prev.rotations };
      if (all) for (const k of Object.keys(rotations)) delete rotations[Number(k)];
      else delete rotations[rotation];
      return { ...prev, rotations };
    });
    setDirty(true);
  }

  // --- Arrossegar amb el punter / el dit -------------------------------
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ label: SpotLabel; x: number; y: number; moved: boolean } | null>(null);

  function toCourt(e: PointerEvent): Spot | null {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const v = pt.matrixTransform(ctm.inverse());
    return { l: v.x, d: v.y };
  }

  function onDown(e: PointerEvent<SVGGElement>, label: SpotLabel) {
    setSelected(label);
    if (!canEdit) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { label, x: e.clientX, y: e.clientY, moved: false };
  }

  function onMove(e: PointerEvent<SVGGElement>) {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
    d.moved = true;
    const p = toCourt(e);
    if (p) moveSpot(d.label, p);
  }

  function onUp() {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) toggleReceiver(d.label);
  }

  function onKey(e: KeyboardEvent<SVGGElement>, label: SpotLabel) {
    if (!canEdit) return;
    const s = rec.spots[label];
    if (!s) return;
    const step = e.shiftKey ? 1 : 0.25;
    const moves: Record<string, Spot> = {
      ArrowLeft: { l: s.l - step, d: s.d },
      ArrowRight: { l: s.l + step, d: s.d },
      ArrowUp: { l: s.l, d: s.d - step },
      ArrowDown: { l: s.l, d: s.d + step },
    };
    if (moves[e.key]) {
      e.preventDefault();
      moveSpot(label, moves[e.key]);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggleReceiver(label);
    }
  }

  // --- Notació de text --------------------------------------------------
  const generated = useMemo(() => formatReception(rs), [rs]);
  const [text, setText] = useState(generated);
  const [textEdited, setTextEdited] = useState(false);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  useEffect(() => {
    if (!textEdited) setText(generated);
  }, [generated, textEdited]);

  function applyText() {
    const res = parseReception(text, rs.system);
    setParseErrors(res.errors.map((e) => t(`recognition.reception.parse.${e.kind}`, { line: e.line, text: e.text })));
    if (res.errors.length) return;
    setRs((prev) => ({ ...prev, rotations: { ...prev.rotations, ...res.rotations } }));
    setDirty(true);
    setTextEdited(false);
  }

  async function save() {
    setBusy(true);
    const err = await r.saveReception(side, rs);
    setBusy(false);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: t('recognition.saved') });
    if (!err) setDirty(false);
  }

  const teamName = (s: SideCode) => (s === 'H' ? match.home.name : match.away.name);

  return (
    <div className="stack">
      <p className="muted small">{t('recognition.reception.help')}</p>
      <div className="row wrap rec-toolbar">
        <div className="segmented" role="tablist" aria-label={t('recognition.team')}>
          {(['H', 'A'] as SideCode[]).map((s) => (
            <button key={s} className={side === s ? 'on' : ''} onClick={() => setSide(s)} aria-selected={side === s} role="tab">
              {teamName(s)}
            </button>
          ))}
        </div>
        <label className="field rec-inline">
          <span>{t('recognition.systems.system')}</span>
          <select value={code} onChange={(e) => setCode(e.target.value as SystemCode)}>
            {SYSTEM_CODES.map((c) => (
              <option key={c} value={c}>
                {c} · {t(`recognition.systemNames.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field rec-inline">
          <span>{t('recognition.reception.template')}</span>
          <select
            value={rs.template}
            disabled={!canEdit}
            onChange={(e) => {
              setRs((prev) => ({ ...prev, template: e.target.value as TemplateCode }));
              setDirty(true);
            }}
          >
            {TEMPLATE_CODES.map((c) => (
              <option key={c} value={c}>
                {c} · {t(`recognition.templates.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="check rec-inline">
          <input
            type="checkbox"
            checked={rs.hasLibero}
            disabled={!canEdit}
            onChange={(e) => {
              setRs((prev) => ({ ...prev, hasLibero: e.target.checked }));
              setDirty(true);
            }}
          />
          {t('recognition.reception.withLibero')}
        </label>
        {!r.isReceptionSaved(side, code) && <span className="badge rec-proposed">{t('recognition.status.proposed')}</span>}
      </div>

      <div className="segmented rec-rotations" role="tablist" aria-label={t('recognition.reception.rotation')}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button key={n} role="tab" aria-selected={rotation === n} className={rotation === n ? 'on' : ''} onClick={() => setRotation(n)}>
            P{n}
            {rs.rotations[n] ? '*' : ''}
          </button>
        ))}
      </div>

      <div className="rec-editor">
        <svg
          ref={svgRef}
          className="rec-court"
          viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
          role="img"
          aria-label={t('recognition.reception.courtLabel', { rotation })}
        >
          <rect x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h} className="cm-out" />
          <rect x={0} y={0} width={9} height={9} className="cm-court" />
          <line x1={0} y1={3} x2={9} y2={3} className="cm-attack" />
          {[3, 6].map((x) => (
            <line key={`x${x}`} x1={x} y1={0} x2={x} y2={9} className="cm-grid" />
          ))}
          <line x1={0} y1={6} x2={9} y2={6} className="cm-grid" />
          {ZONES.map((z) => (
            <text key={z.n} x={z.x} y={z.y} className="cm-zone">
              {z.n}
            </text>
          ))}
          <line x1={-0.6} y1={0} x2={9.6} y2={0} className="cm-net" />
          <text x={4.5} y={-0.55} className="rec-net-label">
            {t('recognition.reception.net')}
          </text>
          {court.map((cp) => {
            const s = rec.spots[cp.label] ?? byPos[cp.position];
            const isRec = rec.receivers.includes(cp.label);
            const bad = badPositions.has(cp.position);
            const num = numbers[cp.label];
            return (
              <g
                key={cp.label}
                className={`rec-token ${isRec ? 'receiver' : ''} ${bad ? 'bad' : ''} ${selected === cp.label ? 'selected' : ''} ${canEdit ? 'editable' : ''}`}
                transform={`translate(${s.l} ${s.d})`}
                tabIndex={0}
                role="button"
                aria-pressed={isRec}
                aria-label={`${cp.label} ${num ?? ''} · ${ROMAN[cp.position]}${isRec ? ` · ${t('recognition.reception.receiver')}` : ''}`}
                onPointerDown={(e) => onDown(e, cp.label)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={() => (drag.current = null)}
                onKeyDown={(e) => onKey(e, cp.label)}
                onFocus={() => setSelected(cp.label)}
                style={{ ['--team' as string]: color }}
              >
                <circle r={0.62} />
                <text y={num != null ? -0.05 : 0.18} className="rec-token-label">
                  {cp.label}
                </text>
                {num != null && (
                  <text y={0.42} className="rec-token-num">
                    {num}
                  </text>
                )}
                <text x={0.62} y={-0.5} className="rec-token-pos">
                  {ROMAN[cp.position]}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="stack-sm rec-side">
          <div className="small muted">{t('recognition.reception.editHelp')}</div>
          {violations.length === 0 ? (
            <div className="ok small">✓ {t('recognition.reception.legal')}</div>
          ) : (
            <ul className="warn small rec-violations">
              {violations.map((v, i) => (
                <li key={i}>
                  {t(`recognition.reception.${v.kind === 'front_back' ? 'frontBack' : 'leftRight'}`, {
                    a: ROMAN[v.a],
                    b: ROMAN[v.b],
                  })}
                </li>
              ))}
            </ul>
          )}
          <div className="small">
            <strong>{t('recognition.reception.receivers')}:</strong>{' '}
            {rec.receivers.length ? rec.receivers.join(', ') : '—'}
          </div>
          <div className="small muted">
            {t('recognition.reception.setterHere', {
              pos: ROMAN[rotationInfo(rs.system, rotation).setterPosition],
            })}
          </div>
          {canEdit && (
            <div className="row wrap">
              <button className="btn btn-sm" onClick={() => resetRotation()} disabled={!rs.rotations[rotation]}>
                {t('recognition.reception.resetRotation')}
              </button>
              <button className="btn btn-sm" onClick={() => resetRotation(true)} disabled={Object.keys(rs.rotations).length === 0}>
                {t('recognition.reception.resetAll')}
              </button>
            </div>
          )}
        </div>
      </div>

      <details className="card rec-notation">
        <summary>{t('recognition.reception.notation')}</summary>
        <p className="small muted">{t('recognition.reception.notationHelp')}</p>
        <textarea
          className="mono"
          rows={7}
          value={text}
          readOnly={!canEdit}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setTextEdited(true);
          }}
        />
        {parseErrors.length > 0 && (
          <ul className="warn small">
            {parseErrors.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="row wrap">
            <button className="btn btn-sm" onClick={applyText} disabled={!textEdited}>
              {t('recognition.reception.applyText')}
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                setText(generated);
                setTextEdited(false);
                setParseErrors([]);
              }}
              disabled={!textEdited}
            >
              {t('recognition.reception.discardText')}
            </button>
            <button className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(text)}>
              {t('recognition.reception.copyText')}
            </button>
          </div>
        )}
      </details>

      {canEdit && (
        <div className="row wrap">
          <button className="btn btn-primary" disabled={busy || (!dirty && r.isReceptionSaved(side, code))} onClick={() => void save()}>
            {t('recognition.reception.save', { team: teamName(side) })}
          </button>
          {dirty && <span className="muted small">{t('recognition.unsaved')}</span>}
          {msg && <span className={msg.ok ? 'ok' : 'warn-text'}>{msg.text}</span>}
        </div>
      )}
    </div>
  );
}

// Números de zona des del punt de vista de l'equip (xarxa a dalt)
const ZONE_ROWS = [
  [4, 3, 2],
  [7, 8, 9],
  [5, 6, 1],
];
const ZONES = ZONE_ROWS.flatMap((row, ri) => row.map((n, ci) => ({ n, x: ci * 3 + 1.5, y: ri * 3 + 1.85 })));
