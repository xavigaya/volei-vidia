import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { playerDisplayName, type MatchPlayer, type SideCode, type TeamPlayer } from '../lib/types';
import { ErrorBox } from '../components/ui';
import type { UseMatch } from './useMatch';
import { duplicatedNumbers, pickConvocable } from '../lib/numbers';

// Convocatòria: quins jugadors de cada plantilla participen en el partit,
// amb quin dorsal i qui fa de líbero.
export function RosterEditor({ m }: { m: UseMatch }) {
  const { t } = useTranslation();
  const match = m.match!;
  const [rosters, setRosters] = useState<Record<SideCode, TeamPlayer[]>>({ H: [], A: [] });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const started = m.events.length > 0;
  const editable = m.canCode;

  useEffect(() => {
    void supabase
      .from('team_players')
      .select('*, players(*)')
      .in('team_id', [match.home_team_id, match.away_team_id])
      .order('shirt_number')
      .then(({ data }) => {
        const list = (data ?? []) as TeamPlayer[];
        setRosters({
          H: list.filter((x) => x.team_id === match.home_team_id),
          A: list.filter((x) => x.team_id === match.away_team_id),
        });
      });
  }, [match.home_team_id, match.away_team_id]);

  // Jugador convocat d'aquest equip que ja porta aquest dorsal
  function holderOf(side: SideCode, n: number, except?: string) {
    return m.players.find((p) => p.side === side && p.shirt_number === n && p.player_id !== except);
  }

  async function toggle(side: SideCode, tp: TeamPlayer, mp: MatchPlayer | undefined) {
    setError(null);
    setWarning(null);
    if (!mp) {
      const holder = holderOf(side, tp.shirt_number, tp.player_id);
      if (holder) {
        setError(t('matches.numberInUse', { n: tp.shirt_number, name: playerDisplayName(holder.players) }));
        return;
      }
    }
    if (mp) {
      const { error } = await supabase.from('match_players').delete().eq('match_id', match.id).eq('player_id', tp.player_id);
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.from('match_players').insert({
        match_id: match.id,
        club_id: match.club_id,
        side,
        player_id: tp.player_id,
        shirt_number: tp.shirt_number,
        position: tp.position,
        is_libero: tp.position === 'L',
        is_captain: tp.is_captain,
      });
      if (error) setError(error.code === '23505' ? t('players.numberTaken') : error.message);
    }
    await m.reloadPlayers();
  }

  // Convoca (o desconvoca) tota la plantilla activa d'un equip
  async function setAll(side: SideCode, on: boolean) {
    setError(null);
    setWarning(null);
    const inMatch = m.players.filter((p) => p.side === side);
    if (on) {
      const candidates = rosters[side].filter((tp) => tp.active && !inMatch.some((p) => p.player_id === tp.player_id));
      // No es convoquen dos jugadors amb el mateix dorsal
      const { ok: missing, skipped } = pickConvocable(candidates, inMatch.map((p) => p.shirt_number));
      if (skipped.length) {
        setWarning(
          t('matches.numbersSkipped', {
            list: skipped.map((tp) => `#${tp.shirt_number} ${playerDisplayName(tp.players)}`).join(', '),
          }),
        );
      }
      if (missing.length) {
        const { error } = await supabase.from('match_players').insert(
          missing.map((tp) => ({
            match_id: match.id,
            club_id: match.club_id,
            side,
            player_id: tp.player_id,
            shirt_number: tp.shirt_number,
            position: tp.position,
            is_libero: tp.position === 'L',
            is_captain: tp.is_captain,
          })),
        );
        if (error) setError(error.code === '23505' ? t('players.numberTaken') : error.message);
      }
    } else if (inMatch.length) {
      const { error } = await supabase
        .from('match_players')
        .delete()
        .eq('match_id', match.id)
        .eq('side', side);
      if (error) setError(error.message);
    }
    await m.reloadPlayers();
  }

  async function update(mp: MatchPlayer, patch: Partial<Pick<MatchPlayer, 'shirt_number' | 'is_libero'>>) {
    setError(null);
    if (patch.shirt_number != null) {
      const holder = holderOf(mp.side, patch.shirt_number, mp.player_id);
      if (holder) {
        setError(t('matches.numberInUse', { n: patch.shirt_number, name: playerDisplayName(holder.players) }));
        await m.reloadPlayers();
        return;
      }
    }
    const { error } = await supabase.from('match_players').update(patch).eq('match_id', match.id).eq('player_id', mp.player_id);
    if (error) setError(error.code === '23505' ? t('players.numberTaken') : error.message);
    await m.reloadPlayers();
  }

  function column(side: SideCode) {
    const team = side === 'H' ? match.home : match.away;
    const inMatch = m.players.filter((p) => p.side === side);
    const liberos = inMatch.filter((p) => p.is_libero).length;
    const dups = duplicatedNumbers(rosters[side]);
    return (
      <section className="card stack">
        <div className="row between">
          <h2>{team.name}</h2>
          <span className="muted small">
            {t('matches.called', { count: inMatch.length })} · {t('matches.liberosCount', { count: liberos })}
          </span>
        </div>
        {editable && rosters[side].length > 0 && (
          <div className="row wrap">
            <button className="btn btn-sm" onClick={() => void setAll(side, true)}>
              ✓ {t('matches.selectAll')}
            </button>
            {!started && (
              <button className="btn btn-sm" onClick={() => void setAll(side, false)} disabled={inMatch.length === 0}>
                {t('matches.selectNone')}
              </button>
            )}
          </div>
        )}
        {rosters[side].length === 0 ? (
          <p className="muted">{t('matches.noRoster')}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="center">{t('matches.calledShort')}</th>
                <th className="num">{t('players.number')}</th>
                <th>{t('players.firstName')}</th>
                <th className="center">{t('positions.L')}</th>
              </tr>
            </thead>
            <tbody>
              {rosters[side].map((tp) => {
                const mp = inMatch.find((p) => p.player_id === tp.player_id);
                return (
                  <tr key={tp.player_id} className={mp ? '' : 'inactive'}>
                    <td className="center">
                      <input
                        type="checkbox"
                        checked={!!mp}
                        disabled={!editable || (started && !!mp)}
                        onChange={() => void toggle(side, tp, mp)}
                        aria-label={t('matches.calledShort')}
                      />
                    </td>
                    <td className="num">
                      {mp && editable && !started ? (
                        <input
                          key={`${mp.player_id}-${mp.shirt_number}`}
                          type="number"
                          min={0}
                          max={99}
                          defaultValue={mp.shirt_number}
                          className="num-input mono"
                          aria-label={t('players.number')}
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            if (n !== mp.shirt_number && n >= 0 && n <= 99) void update(mp, { shirt_number: n });
                          }}
                        />
                      ) : (
                        <span className="mono">{mp?.shirt_number ?? tp.shirt_number}</span>
                      )}
                    </td>
                    <td>
                      {playerDisplayName(tp.players)}
                      {tp.is_captain && <span className="badge">C</span>}
                      {!mp && tp.active && dups.has(tp.shirt_number) && (
                        <span className="badge badge-warn" title={t('matches.dupNumberHelp')}>
                          {t('matches.dupNumber')}
                        </span>
                      )}
                    </td>
                    <td className="center">
                      <input
                        type="checkbox"
                        checked={!!mp?.is_libero}
                        disabled={!mp || !editable || started}
                        onChange={(e) => mp && void update(mp, { is_libero: e.target.checked })}
                        aria-label={t('positions.L')}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    );
  }

  return (
    <div className="stack">
      {started && <p className="notice small">{t('matches.rosterLocked')}</p>}
      {error && <ErrorBox message={error} />}
      {warning && <div className="notice small">{warning}</div>}
      <div className="grid-2 roster-columns">
        {column('H')}
        {column('A')}
      </div>
    </div>
  );
}
