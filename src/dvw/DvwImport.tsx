import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { useCurrentClub } from '../club/ClubProvider';
import type { Season, Team } from '../lib/types';
import type { Side } from '../engine/match';
import { ErrorBox } from '../components/ui';
import { decodeDvw, dvwToEvents, parseDvw, type ParsedDvw } from './dvw';
import { logAction } from '../lib/audit';
import { guessTeam, importDvwMatch, type TeamChoice } from './importDvw';

export function DvwImport({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const club = useCurrentClub();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dv, setDv] = useState<ParsedDvw | null>(null);
  const [fileName, setFileName] = useState('');
  const [teams, setTeams] = useState<Team[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [choices, setChoices] = useState<Record<Side, TeamChoice>>({ H: { teamId: null, isOwn: false }, A: { teamId: null, isOwn: false } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from('teams')
      .select('*')
      .eq('club_id', club.id)
      .order('is_own', { ascending: false })
      .order('name')
      .then(({ data }) => setTeams((data ?? []) as Team[]));
    void supabase
      .from('seasons')
      .select('*')
      .eq('club_id', club.id)
      .order('name', { ascending: false })
      .then(({ data }) => {
        const list = (data ?? []) as Season[];
        setSeasons(list);
        if (list[0]) setSeasonId(list[0].id);
      });
  }, [club.id]);

  const preview = useMemo(() => {
    if (!dv) return null;
    const r = dvwToEvents(dv);
    const dups = (dv.duplicates ?? []).map(
      (d) => `${d.side === 'H' ? dv.teams[0].name : dv.teams[1].name}: dorsal ${d.number} repetit (${d.firstName} ${d.lastName}) no importat`,
    );
    return { ...r, warnings: [...dups, ...r.warnings] };
  }, [dv]);

  async function onFile(f: File) {
    setError(null);
    setFileName(f.name);
    try {
      const parsed = parseDvw(decodeDvw(await f.arrayBuffer()));
      if (parsed.scout.length === 0) throw new Error(t('dvw.noScout'));
      setDv(parsed);
      const pick = (i: 0 | 1): TeamChoice => {
        const g = guessTeam(teams, parsed.teams[i].name, parsed.teams[i].code);
        return { teamId: g?.id ?? null, isOwn: g?.is_own ?? false };
      };
      setChoices({ H: pick(0), A: pick(1) });
    } catch (e) {
      setDv(null);
      setError((e as Error).message);
    }
  }

  async function onImport() {
    if (!dv) return;
    if (choices.H.teamId && choices.H.teamId === choices.A.teamId) {
      setError(t('matches.sameTeam'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await importDvwMatch(dv, { clubId: club.id, userId: user?.id ?? null, seasonId: seasonId || null, choices });
      logAction('import', 'match', { entityId: r.matchId, summary: fileName });
      navigate(`/matches/${r.matchId}?tab=stats`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const actions = preview?.events.filter((e) => e.type === 'action').length ?? 0;

  return (
    <div className="stack">
      <p className="small muted">{t('dvw.importHelp')}</p>
      <div className="row wrap">
        <label className="btn btn-primary">
          {t('dvw.chooseFile')}
          <input
            type="file"
            accept=".dvw,.vsm,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = '';
            }}
          />
        </label>
        {fileName && <span className="small muted">{fileName}</span>}
      </div>

      {error && <ErrorBox message={error} />}

      {dv && preview && (
        <>
          <div className="notice small">
            {[dv.date, dv.league, dv.phase].filter(Boolean).join(' · ')}
            <br />
            {t('dvw.summary', {
              sets: dv.sets.map((s) => `${s.h}-${s.a}`).join(', ') || '—',
              actions,
              players: dv.players.H.length + dv.players.A.length,
            })}
          </div>

          {(['H', 'A'] as Side[]).map((side) => {
            const info = dv.teams[side === 'H' ? 0 : 1];
            const c = choices[side];
            return (
              <fieldset key={side} className="card stack dvw-team">
                <legend>
                  {side === 'H' ? t('matches.home') : t('matches.away')}: <strong>{info.name}</strong>{' '}
                  {info.code && <span className="mono muted">({info.code})</span>}
                </legend>
                <label className="field">
                  <span>{t('dvw.teamInApp')}</span>
                  <select
                    value={c.teamId ?? ''}
                    onChange={(e) => setChoices({ ...choices, [side]: { ...c, teamId: e.target.value || null } })}
                  >
                    <option value="">+ {t('dvw.createTeam', { name: info.name })}</option>
                    {teams.map((tm) => (
                      <option key={tm.id} value={tm.id}>
                        {tm.name}
                        {tm.is_own ? ` · ${t('teams.own')}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {!c.teamId && (
                  <label className="check">
                    <input type="checkbox" checked={c.isOwn} onChange={(e) => setChoices({ ...choices, [side]: { ...c, isOwn: e.target.checked } })} />
                    {t('teams.isOwn')}
                  </label>
                )}
                <p className="small muted">{t('dvw.playersHelp', { count: dv.players[side].length })}</p>
              </fieldset>
            );
          })}

          {seasons.length > 0 && (
            <label className="field">
              <span>{t('teams.season')}</span>
              <select value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
                <option value="">{t('teams.noSeason')}</option>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {preview.warnings.length > 0 && (
            <details className="notice small">
              <summary>{t('dvw.warnings', { count: preview.warnings.length })}</summary>
              <ul>
                {preview.warnings.slice(0, 30).map((w, i) => (
                  <li key={i} className="mono">
                    {w}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <div className="row end">
        <button className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className="btn btn-primary" disabled={!dv || busy} onClick={() => void onImport()}>
          {busy ? t('common.saving') : t('dvw.import')}
        </button>
      </div>
    </div>
  );
}
