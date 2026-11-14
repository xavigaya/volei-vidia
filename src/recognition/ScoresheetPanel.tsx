import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Side } from '../engine/match';
import type { SideCode } from '../lib/types';
import { rulesOf, type UseMatch } from '../matches/useMatch';
import { ROMAN } from './gameSystems';
import {
  codedSets,
  compareScoresheet,
  durationMinutes,
  emptySet,
  parseNumberList,
  type Diff,
  type Scoresheet,
  type ScoresheetSet,
} from './scoresheet';
import type { UseRecognition } from './useRecognition';

interface Props {
  m: UseMatch;
  r: UseRecognition;
  canEdit: boolean;
}

function initialSheet(saved: Scoresheet | null, sets: number): Scoresheet {
  const out: ScoresheetSet[] = [];
  for (let i = 1; i <= sets; i++) out.push(saved?.sets.find((s) => s.number === i) ?? emptySet(i));
  return { sets: out, notes: saved?.notes ?? null };
}

export function ScoresheetPanel({ m, r, canEdit }: Props) {
  const { t } = useTranslation();
  const match = m.match!;
  const maxSets = match.sets_to_win * 2 - 1;
  const [sheet, setSheet] = useState<Scoresheet>(() => initialSheet(r.scoresheet, maxSets));
  // Text dels punts al canvi tal com s'escriu (es llegeix en sortir del camp)
  const [lossText, setLossText] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const s = initialSheet(r.scoresheet, maxSets);
    setSheet(s);
    const txt: Record<string, string> = {};
    for (const set of s.sets) {
      txt[`H${set.number}`] = set.home.serveLoss.join(' ');
      txt[`A${set.number}`] = set.away.serveLoss.join(' ');
    }
    setLossText(txt);
    setDirty(false);
  }, [r.scoresheet, maxSets]);

  const rosters = useMemo(() => {
    const H = m.players.filter((p) => p.side === 'H').map((p) => p.shirt_number);
    const A = m.players.filter((p) => p.side === 'A').map((p) => p.shirt_number);
    return H.length && A.length ? { H, A } : null;
  }, [m.players]);
  const coded = useMemo(() => codedSets(m.events, rulesOf(match), rosters), [m.events, match, rosters]);
  const diffs = useMemo(() => compareScoresheet(sheet, coded), [sheet, coded]);
  const filled = sheet.sets.some((s) => compareScoresheet({ sets: [s] }, []).length > 0);

  function updateSet(n: number, patch: (s: ScoresheetSet) => ScoresheetSet) {
    setSheet((prev) => ({ ...prev, sets: prev.sets.map((s) => (s.number === n ? patch(structuredClone(s)) : s)) }));
    setDirty(true);
    setMsg(null);
  }

  const num = (v: string): number | null => {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
  };

  async function save() {
    setBusy(true);
    const err = await r.saveScoresheet(sheet);
    setBusy(false);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: t('recognition.saved') });
    if (!err) setDirty(false);
  }

  const teamName = (s: SideCode) => (s === 'H' ? match.home.name : match.away.name);
  const diffText = (d: Diff) =>
    t(`recognition.sheet.diff.${d.kind}`, {
      set: d.set,
      team: d.side ? teamName(d.side) : '',
      pos: d.index ? ROMAN[d.index - 1] : '',
      n: d.index ?? '',
      expected: d.kind === 'first_serve' ? teamName(d.expected as Side) : d.expected,
      actual: d.kind === 'first_serve' ? teamName(d.actual as Side) : d.actual,
    });

  return (
    <div className="stack">
      <p className="muted small">{t('recognition.sheet.help')}</p>

      <div className={`card rec-result ${filled ? (diffs.length ? 'has-diffs' : 'all-ok') : ''}`} aria-live="polite">
        {!filled ? (
          <span className="muted">{t('recognition.sheet.empty')}</span>
        ) : diffs.length === 0 ? (
          <span className="ok">✓ {t('recognition.sheet.allOk')}</span>
        ) : (
          <>
            <strong className="warn-text">{t('recognition.sheet.diffs', { count: diffs.length })}</strong>
            <ul className="rec-diffs">
              {diffs.map((d, i) => (
                <li key={i}>{diffText(d)}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="rec-sheet-sets">
        {sheet.sets.map((s) => {
          const c = coded.find((x) => x.number === s.number);
          const mins = durationMinutes(s.start, s.end);
          return (
            <fieldset key={s.number} className="card rec-sheet-set" disabled={!canEdit}>
              <legend>
                {t('recognition.set')} {s.number}
                {c && (
                  <span className="muted small">
                    {' '}
                    · {t('recognition.sheet.coded')}: {c.final.h}-{c.final.a}
                  </span>
                )}
              </legend>
              <div className="row wrap rec-sheet-head">
                <label className="field">
                  <span>{t('recognition.sheet.firstServe')}</span>
                  <select
                    value={s.firstServe ?? ''}
                    onChange={(e) => updateSet(s.number, (x) => ({ ...x, firstServe: (e.target.value || null) as Side | null }))}
                  >
                    <option value="">—</option>
                    <option value="H">{teamName('H')}</option>
                    <option value="A">{teamName('A')}</option>
                  </select>
                </label>
                <label className="field">
                  <span>{t('recognition.sheet.start')}</span>
                  <input
                    type="time"
                    value={s.start ?? ''}
                    onChange={(e) => updateSet(s.number, (x) => ({ ...x, start: e.target.value || null }))}
                  />
                </label>
                <label className="field">
                  <span>{t('recognition.sheet.end')}</span>
                  <input type="time" value={s.end ?? ''} onChange={(e) => updateSet(s.number, (x) => ({ ...x, end: e.target.value || null }))} />
                </label>
                {mins != null && <span className="muted small rec-mins">{t('recognition.sheet.minutes', { count: mins })}</span>}
              </div>

              {(['H', 'A'] as SideCode[]).map((side) => {
                const team = side === 'H' ? s.home : s.away;
                const keyText = `${side}${s.number}`;
                return (
                  <div key={side} className="rec-sheet-team">
                    <div className="rec-sheet-team-name">{teamName(side)}</div>
                    <div className="rec-sheet-lineup" role="group" aria-label={t('recognition.sheet.lineup')}>
                      {team.lineup.map((n, i) => (
                        <label key={i} className="rec-sheet-pos">
                          <span>{ROMAN[i]}</span>
                          <input
                            className="num-input"
                            inputMode="numeric"
                            value={n ?? ''}
                            onChange={(e) =>
                              updateSet(s.number, (x) => {
                                const tt = side === 'H' ? x.home : x.away;
                                tt.lineup[i] = num(e.target.value);
                                return x;
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <label className="field">
                      <span>{t('recognition.sheet.serveLoss')}</span>
                      <input
                        className="mono"
                        inputMode="numeric"
                        placeholder="3 7 10 15 …"
                        value={lossText[keyText] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setLossText((prev) => ({ ...prev, [keyText]: v }));
                          updateSet(s.number, (x) => {
                            (side === 'H' ? x.home : x.away).serveLoss = parseNumberList(v);
                            return x;
                          });
                        }}
                      />
                    </label>
                    <label className="field rec-final">
                      <span>{t('recognition.sheet.final')}</span>
                      <input
                        className="num-input"
                        inputMode="numeric"
                        value={(side === 'H' ? s.final.h : s.final.a) ?? ''}
                        onChange={(e) =>
                          updateSet(s.number, (x) => ({
                            ...x,
                            final: side === 'H' ? { ...x.final, h: num(e.target.value) } : { ...x.final, a: num(e.target.value) },
                          }))
                        }
                      />
                    </label>
                  </div>
                );
              })}
            </fieldset>
          );
        })}
      </div>

      <label className="field">
        <span>{t('recognition.sheet.notes')}</span>
        <textarea
          rows={2}
          value={sheet.notes ?? ''}
          disabled={!canEdit}
          onChange={(e) => {
            setSheet((prev) => ({ ...prev, notes: e.target.value || null }));
            setDirty(true);
          }}
        />
      </label>

      {canEdit && (
        <div className="row wrap">
          <button className="btn btn-primary" disabled={busy || !dirty} onClick={() => void save()}>
            {t('recognition.sheet.save')}
          </button>
          {dirty && <span className="muted small">{t('recognition.unsaved')}</span>}
          {msg && <span className={msg.ok ? 'ok' : 'warn-text'}>{msg.text}</span>}
        </div>
      )}
    </div>
  );
}
