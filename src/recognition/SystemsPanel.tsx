import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SideCode } from '../lib/types';
import type { UseMatch } from '../matches/useMatch';
import { mismatchesFor, ROMAN, SYSTEM_CODES, SYSTEMS, type SystemCode, type TeamSystem } from './gameSystems';
import type { UseRecognition } from './useRecognition';

interface Props {
  m: UseMatch;
  r: UseRecognition;
  canEdit: boolean;
}

const k = (side: SideCode, set: number) => `${side}${set}`;

export function SystemsPanel({ m, r, canEdit }: Props) {
  const { t } = useTranslation();
  const match = m.match!;
  const [draft, setDraft] = useState<Map<string, TeamSystem>>(new Map());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Proposta inicial: el desat o el deduït
  useEffect(() => {
    const map = new Map<string, TeamSystem>();
    for (const row of r.setSystemsList) if (row.current) map.set(k(row.side, row.set), row.current);
    setDraft(map);
  }, [r.setSystemsList]);

  const teamName = (side: SideCode) => (side === 'H' ? match.home.name : match.away.name);
  const dirty = useMemo(
    () =>
      r.setSystemsList.some((row) => {
        const d = draft.get(k(row.side, row.set));
        return !!d && (!row.saved || row.saved.code !== d.code || row.saved.anchor !== d.anchor);
      }),
    [draft, r.setSystemsList],
  );

  if (r.setSystemsList.length === 0) {
    return <div className="card muted">{t('recognition.systems.noSets')}</div>;
  }

  function update(side: SideCode, set: number, patch: Partial<TeamSystem>) {
    setDraft((prev) => {
      const next = new Map(prev);
      const cur = next.get(k(side, set)) ?? { code: '51' as SystemCode, anchor: 0 };
      next.set(k(side, set), { ...cur, ...patch });
      return next;
    });
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    const rows = r.setSystemsList
      .map((row) => ({ side: row.side, set: row.set, system: draft.get(k(row.side, row.set)) }))
      .filter((x): x is { side: SideCode; set: number; system: TeamSystem } => !!x.system);
    const err = await r.saveSystems(rows);
    setBusy(false);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: t('recognition.saved') });
  }

  return (
    <div className="stack">
      <p className="muted small">{t('recognition.systems.help')}</p>
      <div className="table-scroll">
        <table className="table rec-systems">
          <thead>
            <tr>
              <th>{t('recognition.set')}</th>
              <th>{t('recognition.team')}</th>
              <th>{t('recognition.systems.lineup')}</th>
              <th>{t('recognition.systems.system')}</th>
              <th>{t('recognition.systems.setter')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {r.setSystemsList.map((row) => {
              const d = draft.get(k(row.side, row.set)) ?? null;
              const pos = r.positionOf(row.side);
              const mism = d ? mismatchesFor(d, row.lineup, pos) : [];
              const status = row.saved
                ? d && (d.code !== row.saved.code || d.anchor !== row.saved.anchor)
                  ? 'changed'
                  : 'saved'
                : 'proposed';
              return (
                <tr key={k(row.side, row.set)}>
                  <td className="center">{row.set}</td>
                  <td className="nowrap">{teamName(row.side)}</td>
                  <td className="mono small nowrap">
                    {row.lineup.map((n, i) => (
                      <span
                        key={i}
                        className={`rec-lu ${d && i === d.anchor ? 'rec-lu-setter' : ''}`}
                        title={pos(n) ? t(`positions.${pos(n)}`) : ''}
                      >
                        {ROMAN[i]}:{n}
                        {pos(n) ? <sub>{pos(n)}</sub> : null}
                      </span>
                    ))}
                  </td>
                  <td>
                    <select
                      value={d?.code ?? ''}
                      disabled={!canEdit}
                      onChange={(e) => update(row.side, row.set, { code: e.target.value as SystemCode })}
                      aria-label={t('recognition.systems.system')}
                    >
                      {!d && <option value="">—</option>}
                      {SYSTEM_CODES.map((c) => (
                        <option key={c} value={c}>
                          {c} · {t(`recognition.systemNames.${c}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={d?.anchor ?? ''}
                      disabled={!canEdit}
                      onChange={(e) => update(row.side, row.set, { anchor: Number(e.target.value) })}
                      aria-label={t('recognition.systems.setter')}
                    >
                      {!d && <option value="">—</option>}
                      {row.lineup.map((n, i) => (
                        <option key={i} value={i}>
                          {ROMAN[i]} · {n}
                          {pos(n) ? ` (${pos(n)})` : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="small">
                    <span className={`badge rec-${status}`}>{t(`recognition.status.${status}`)}</span>
                    {!row.saved && row.inferred.reason === 'ambiguous' && (
                      <div className="warn">{t('recognition.systems.ambiguous')}</div>
                    )}
                    {!row.saved && row.inferred.reason === 'no_setter' && (
                      <div className="warn">{t('recognition.systems.noSetter')}</div>
                    )}
                    {!row.saved && row.inferred.reason === 'unknown_order' && (
                      <div className="warn">{t('recognition.systems.unknownOrder')}</div>
                    )}
                    {mism.length > 0 && (
                      <div className="warn">
                        {t('recognition.systems.mismatch', {
                          list: mism.map((x) => `${ROMAN[x.position]}:${x.player} (${x.actual} → ${x.expected})`).join(', '),
                        })}
                      </div>
                    )}
                    {d && <div className="muted mono">{SYSTEMS[d.code].roles.join('-')}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="row wrap">
          <button className="btn btn-primary" disabled={busy || !dirty} onClick={() => void save()}>
            {t('recognition.systems.save')}
          </button>
          {msg && <span className={msg.ok ? 'ok' : 'warn-text'}>{msg.text}</span>}
        </div>
      )}
    </div>
  );
}
