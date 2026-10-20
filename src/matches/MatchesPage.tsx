import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { pickConvocable } from '../lib/numbers';
import { cached } from '../offline/store';
import { useAuth } from '../auth/AuthProvider';
import { useClub, useCurrentClub } from '../club/ClubProvider';
import type { MatchWithTeams, Season, Team, TeamPlayer } from '../lib/types';
import { EmptyState, ErrorBox, Modal, PageHeader, Spinner } from '../components/ui';
import { MATCH_SELECT } from './useMatch';
import { DvwImport } from '../dvw/DvwImport';

export function MatchesPage() {
  const { t, i18n } = useTranslation();
  const club = useCurrentClub();
  const { canEdit } = useClub();
  const [matches, setMatches] = useState<MatchWithTeams[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await cached(`matches:${club.id}`, () =>
      supabase
        .from('matches')
        .select(MATCH_SELECT)
        .eq('club_id', club.id)
        .order('played_at', { ascending: false, nullsFirst: true })
        .order('created_at', { ascending: false }),
    );
    if (error) setError(error.message);
    else setMatches((data ?? []) as unknown as MatchWithTeams[]);
    setLoading(false);
  }, [club.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="page">
      <PageHeader
        title={t('matches.title')}
        actions={
          canEdit && (
            <div className="row wrap">
              <button className="btn" onClick={() => setImporting(true)}>
                ⤓ {t('dvw.importBtn')}
              </button>
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                + {t('matches.new')}
              </button>
            </div>
          )
        }
      />
      {error && <ErrorBox message={error} />}
      {loading ? (
        <Spinner />
      ) : matches.length === 0 ? (
        <div className="card">
          <EmptyState>{t('matches.empty')}</EmptyState>
        </div>
      ) : (
        <div className="match-list">
          {matches.map((m) => (
            <Link key={m.id} to={`/matches/${m.id}`} className="match-row card">
              <div className="match-row-date muted small">
                {m.played_at ? fmt.format(new Date(m.played_at)) : '—'}
                {m.competition && <> · {m.competition}</>}
                {m.phase && <> · {m.phase}</>}
              </div>
              <div className="match-row-teams">
                <span className={m.home_sets > m.away_sets ? 'winner' : ''}>{m.home.name}</span>
                <span className="match-row-score mono">
                  {m.status === 'scheduled' ? 'vs' : `${m.home_sets} – ${m.away_sets}`}
                </span>
                <span className={m.away_sets > m.home_sets ? 'winner' : ''}>{m.away.name}</span>
              </div>
              <div className="match-row-sets mono small muted">
                {m.set_scores.map((s, i) => (
                  <span key={i}>
                    {s.h}-{s.a}
                  </span>
                ))}
              </div>
              <span className={`status status-${m.status}`}>{t(`matches.status.${m.status}`)}</span>
            </Link>
          ))}
        </div>
      )}

      <Modal title={t('dvw.importTitle')} open={importing} onClose={() => setImporting(false)}>
        <DvwImport onCancel={() => setImporting(false)} />
      </Modal>

      <Modal title={t('matches.new')} open={creating} onClose={() => setCreating(false)}>
        <CreateMatchForm onCancel={() => setCreating(false)} />
      </Modal>
    </div>
  );
}

function localDateTimeNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function CreateMatchForm({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const club = useCurrentClub();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [teams, setTeams] = useState<Team[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [homeId, setHomeId] = useState('');
  const [awayId, setAwayId] = useState('');
  const [seasonId, setSeasonId] = useState('');
  const [playedAt, setPlayedAt] = useState(localDateTimeNow());
  const [competition, setCompetition] = useState('');
  const [phase, setPhase] = useState('');
  const [venue, setVenue] = useState('');
  const [setsToWin, setSetsToWin] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from('teams')
      .select('*')
      .eq('club_id', club.id)
      .eq('archived', false)
      .order('is_own', { ascending: false })
      .order('name')
      .then(({ data }) => {
        const list = (data ?? []) as Team[];
        setTeams(list);
        const own = list.find((x) => x.is_own);
        if (own) {
          setHomeId(own.id);
          if (own.season_id) setSeasonId(own.season_id);
        }
      });
    void supabase
      .from('seasons')
      .select('*')
      .eq('club_id', club.id)
      .order('name', { ascending: false })
      .then(({ data }) => setSeasons((data ?? []) as Season[]));
  }, [club.id]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (homeId === awayId) {
      setError(t('matches.sameTeam'));
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error } = await supabase
      .from('matches')
      .insert({
        club_id: club.id,
        season_id: seasonId || null,
        home_team_id: homeId,
        away_team_id: awayId,
        played_at: playedAt ? new Date(playedAt).toISOString() : null,
        competition: competition.trim() || null,
        phase: phase.trim() || null,
        venue: venue.trim() || null,
        sets_to_win: setsToWin,
        max_substitutions: club.max_substitutions,
        timeouts_per_set: club.timeouts_per_set,
        coder_id: user?.id,
        created_by: user?.id,
      })
      .select('id')
      .single();
    if (error || !data) {
      setBusy(false);
      setError(error?.message ?? 'error');
      return;
    }
    const matchId = (data as { id: string }).id;

    // Convocatòria inicial: plantilla activa dels dos equips
    const { data: roster } = await supabase
      .from('team_players')
      .select('*, players(*)')
      .in('team_id', [homeId, awayId])
      .eq('active', true);
    // Si a la plantilla hi ha dorsals repetits, només se'n convoca un (la resta,
    // des de la pestanya de convocatòria després de canviar-ne el dorsal)
    const all = (roster ?? []) as TeamPlayer[];
    const chosen = [homeId, awayId].flatMap((id) => pickConvocable(all.filter((tp) => tp.team_id === id)).ok);
    const rows = chosen.map((tp) => ({
      match_id: matchId,
      club_id: club.id,
      side: tp.team_id === homeId ? 'H' : 'A',
      player_id: tp.player_id,
      shirt_number: tp.shirt_number,
      position: tp.position,
      is_libero: tp.position === 'L',
      is_captain: tp.is_captain,
    }));
    if (rows.length) {
      const ins = await supabase.from('match_players').insert(rows);
      if (ins.error) setError(ins.error.message);
    }
    setBusy(false);
    navigate(`/matches/${matchId}?tab=roster`);
  }

  const own = teams.filter((x) => x.is_own);
  const rivals = teams.filter((x) => !x.is_own);
  const teamOptions = (
    <>
      <option value="">—</option>
      <optgroup label={t('teams.own')}>
        {own.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </optgroup>
      <optgroup label={t('teams.opponents')}>
        {rivals.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </optgroup>
    </>
  );

  return (
    <form onSubmit={onSubmit} className="stack">
      {teams.length < 2 && <p className="notice">{t('matches.needTeams')}</p>}
      <div className="grid-2">
        <label className="field">
          <span>{t('matches.home')}</span>
          <select value={homeId} onChange={(e) => setHomeId(e.target.value)} required>
            {teamOptions}
          </select>
        </label>
        <label className="field">
          <span>{t('matches.away')}</span>
          <select value={awayId} onChange={(e) => setAwayId(e.target.value)} required>
            {teamOptions}
          </select>
        </label>
        <label className="field">
          <span>{t('matches.date')}</span>
          <input type="datetime-local" value={playedAt} onChange={(e) => setPlayedAt(e.target.value)} />
        </label>
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
        <label className="field">
          <span>{t('matches.competition')}</span>
          <input value={competition} onChange={(e) => setCompetition(e.target.value)} maxLength={120} />
        </label>
        <label className="field">
          <span>{t('matches.phase')}</span>
          <input value={phase} onChange={(e) => setPhase(e.target.value)} maxLength={60} />
        </label>
        <label className="field">
          <span>{t('matches.venue')}</span>
          <input value={venue} onChange={(e) => setVenue(e.target.value)} maxLength={120} />
        </label>
        <label className="field">
          <span>{t('matches.format')}</span>
          <select value={setsToWin} onChange={(e) => setSetsToWin(Number(e.target.value))}>
            <option value={3}>{t('matches.bestOf', { n: 5 })}</option>
            <option value={2}>{t('matches.bestOf', { n: 3 })}</option>
          </select>
        </label>
      </div>
      {error && <ErrorBox message={error} />}
      <div className="row end">
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className="btn btn-primary" disabled={busy || teams.length < 2}>
          {t('common.create')}
        </button>
      </div>
    </form>
  );
}
