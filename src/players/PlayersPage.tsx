import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useClub, useCurrentClub } from '../club/ClubProvider';
import { POSITIONS, playerDisplayName, type Player, type PlayerPosition, type Team } from '../lib/types';
import { EmptyState, ErrorBox, Modal, PageHeader, Spinner } from '../components/ui';
import { emptyPlayer, PlayerFields, PlayerForm } from './PlayerForm';

type PlayerRow = Player & {
  team_players: { shirt_number: number; position: PlayerPosition; active: boolean; teams: { id: string; name: string; archived: boolean } }[];
};

export function PlayersPage() {
  const { t } = useTranslation();
  const club = useCurrentClub();
  const { canEdit } = useClub();
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [editing, setEditing] = useState<Player | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('players')
      .select('*, team_players(shirt_number, position, active, teams(id, name, archived))')
      .eq('club_id', club.id)
      .order('last_name')
      .order('first_name');
    if (error) setError(error.message);
    else setPlayers((data ?? []) as PlayerRow[]);
    setLoading(false);
  }, [club.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const teams = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of players) for (const tp of p.team_players) if (!tp.teams.archived) map.set(tp.teams.id, tp.teams.name);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [players]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    return players.filter(
      (p) =>
        (!teamFilter ||
          (teamFilter === 'none' ? p.team_players.length === 0 : p.team_players.some((tp) => tp.teams.id === teamFilter))) &&
        (!q || normalize([p.first_name, p.last_name, p.nickname, p.external_code].filter(Boolean).join(' ')).includes(q)),
    );
  }, [players, query, teamFilter]);

  async function onDelete(p: Player) {
    if (!window.confirm(t('common.confirmDelete'))) return;
    const { error } = await supabase.from('players').delete().eq('id', p.id);
    // 23503: el jugador consta en partits jugats i no es pot esborrar
    if (error) setError(error.code === '23503' ? t('players.inMatches') : error.message);
    await load();
  }

  return (
    <div className="page">
      <PageHeader
        title={t('players.title')}
        actions={
          <div className="row wrap">
            <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} aria-label={t('teams.title')}>
              <option value="">{t('players.allTeams')}</option>
              {teams.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
              <option value="none">{t('players.noTeam')}</option>
            </select>
            <input
              type="search"
              placeholder={t('common.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t('common.search')}
            />
            {canEdit && (
              <button className="btn btn-primary" onClick={() => setEditing('new')}>
                + {t('players.new')}
              </button>
            )}
          </div>
        }
      />
      <p className="privacy small">{t('players.privacyNote')}</p>
      {error && <ErrorBox message={error} />}

      <section className="card">
        {loading ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('players.firstName')}</th>
                <th>{t('teams.title')}</th>
                <th className="center">{t('players.isMinor')}</th>
                <th className="center">{t('players.imageConsent')}</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{playerDisplayName(p)}</strong>
                    {p.nickname && (
                      <div className="muted small">
                        {p.first_name} {p.last_name}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="chips">
                      {p.team_players
                        .filter((tp) => tp.active && !tp.teams.archived)
                        .map((tp) => (
                          <Link key={tp.teams.id} to={`/teams/${tp.teams.id}`} className="chip">
                            <span className="mono">#{tp.shirt_number}</span> {tp.teams.name}
                          </Link>
                        ))}
                    </div>
                  </td>
                  <td className="center">{p.is_minor ? '●' : ''}</td>
                  <td className="center">{p.image_consent ? '✓' : p.is_minor ? <span className="warn">✗</span> : '–'}</td>
                  {canEdit && (
                    <td className="right nowrap">
                      <button className="btn btn-sm" onClick={() => setEditing(p)}>
                        {t('common.edit')}
                      </button>{' '}
                      <button className="btn btn-sm" onClick={() => void onDelete(p)}>
                        {t('common.delete')}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Modal
        title={editing === 'new' ? t('players.new') : t('common.edit')}
        open={editing !== null}
        onClose={() => setEditing(null)}
      >
        {editing === 'new' ? (
          <NewPlayerForm
            clubId={club.id}
            defaultTeam={teamFilter && teamFilter !== 'none' ? teamFilter : ''}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void load();
            }}
          />
        ) : (
          <PlayerForm
            clubId={club.id}
            player={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void load();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Un jugador nou sempre es crea dins d'un equip, amb dorsal i posició
function NewPlayerForm({
  clubId,
  defaultTeam,
  onSaved,
  onCancel,
}: {
  clubId: string;
  defaultTeam: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState(defaultTeam);
  const [draft, setDraft] = useState(emptyPlayer(clubId));
  const [number, setNumber] = useState(1);
  const [position, setPosition] = useState<PlayerPosition>('U');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from('teams')
      .select('*')
      .eq('club_id', clubId)
      .eq('archived', false)
      .order('is_own', { ascending: false })
      .order('name')
      .then(({ data }) => setTeams((data ?? []) as Team[]));
  }, [clubId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Comprova el dorsal abans de crear el jugador
    const dup = await supabase
      .from('team_players')
      .select('player_id')
      .eq('team_id', teamId)
      .eq('shirt_number', number)
      .eq('active', true);
    // Es permet repetir dorsal dins l'equip, però s'avisa
    if ((dup.data ?? []).length > 0 && !window.confirm(t('players.numberDupConfirm', { n: number }))) {
      setBusy(false);
      return;
    }
    const { data, error } = await supabase
      .from('players')
      .insert({
        ...draft,
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
        nickname: draft.nickname?.trim() || null,
        external_code: draft.external_code?.trim() || null,
      })
      .select('id')
      .single();
    if (error || !data) {
      setBusy(false);
      setError(error?.message ?? 'error');
      return;
    }
    const tp = await supabase.from('team_players').insert({
      team_id: teamId,
      player_id: (data as { id: string }).id,
      club_id: clubId,
      shirt_number: number,
      position,
    });
    setBusy(false);
    if (tp.error) {
      setError(tp.error.message);
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={onSubmit} className="stack">
      <div className="grid-3">
        <label className="field">
          <span>{t('teams.title')}</span>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
            <option value="">—</option>
            {teams.map((tm) => (
              <option key={tm.id} value={tm.id}>
                {tm.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('players.number')}</span>
          <input type="number" min={0} max={99} value={number} onChange={(e) => setNumber(Number(e.target.value))} required />
        </label>
        <label className="field">
          <span>{t('players.position')}</span>
          <select value={position} onChange={(e) => setPosition(e.target.value as PlayerPosition)}>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {t(`positions.${p}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <PlayerFields draft={draft} onChange={setDraft} />
      <p className="privacy small">{t('players.privacyNote')}</p>
      {error && <ErrorBox message={error} />}
      <div className="row end">
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className="btn btn-primary" disabled={busy || !teamId}>
          {busy ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  );
}
