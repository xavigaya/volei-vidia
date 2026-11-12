// Desa a la base de dades un partit llegit d'un fitxer .dvw
import { supabase } from '../lib/supabase';
import type { Side } from '../engine/match';
import type { Team, TeamPlayer } from '../lib/types';
import { dvwToEvents, type ParsedDvw } from './dvw';

export interface TeamChoice {
  teamId: string | null; // null = crear-ne un de nou
  isOwn: boolean;
}

export interface DvwImportOptions {
  clubId: string;
  userId: string | null;
  seasonId: string | null;
  choices: Record<Side, TeamChoice>;
}

// Proposa l'equip existent que coincideix pel nom o pel codi
export function guessTeam(teams: Team[], name: string, code: string): Team | undefined {
  const n = name.trim().toLowerCase();
  const c = code.trim().toLowerCase();
  return (
    teams.find((t) => t.name.trim().toLowerCase() === n) ??
    (c ? teams.find((t) => (t.code ?? '').trim().toLowerCase() === c) : undefined)
  );
}

export async function importDvwMatch(dv: ParsedDvw, opts: DvwImportOptions): Promise<{ matchId: string; warnings: string[] }> {
  const imp = dvwToEvents(dv);
  const teamIds: Record<Side, string> = { H: '', A: '' };

  // 1. Equips
  for (const side of ['H', 'A'] as Side[]) {
    const info = dv.teams[side === 'H' ? 0 : 1];
    const choice = opts.choices[side];
    if (choice.teamId) {
      teamIds[side] = choice.teamId;
      continue;
    }
    const { data, error } = await supabase
      .from('teams')
      .insert({
        club_id: opts.clubId,
        season_id: opts.seasonId,
        name: info.name,
        code: info.code ? info.code.toUpperCase().slice(0, 10) : null,
        coach: info.coach || null,
        assistant: info.assistant || null,
        is_own: choice.isOwn,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'team');
    teamIds[side] = (data as { id: string }).id;
  }
  if (teamIds.H === teamIds.A) throw new Error('same_team');

  // 2. Jugadors: es reaprofiten els de la plantilla amb el mateix dorsal
  const playerIds: Record<Side, Map<number, string>> = { H: new Map(), A: new Map() };
  for (const side of ['H', 'A'] as Side[]) {
    const { data } = await supabase.from('team_players').select('*, players(*)').eq('team_id', teamIds[side]);
    const roster = (data ?? []) as TeamPlayer[];
    for (const p of dv.players[side]) {
      const existing = roster.find((tp) => tp.shirt_number === p.number && tp.active) ?? roster.find((tp) => tp.shirt_number === p.number);
      if (existing) {
        playerIds[side].set(p.number, existing.player_id);
        continue;
      }
      const { data: np, error } = await supabase
        .from('players')
        .insert({
          club_id: opts.clubId,
          first_name: p.firstName || p.nickname || `#${p.number}`,
          last_name: p.lastName,
          nickname: p.nickname || null,
        })
        .select('id')
        .single();
      if (error || !np) throw new Error(error?.message ?? 'player');
      const id = (np as { id: string }).id;
      const tp = await supabase.from('team_players').insert({
        team_id: teamIds[side],
        player_id: id,
        club_id: opts.clubId,
        shirt_number: p.number,
        position: p.position,
      });
      if (tp.error) throw new Error(tp.error.message);
      playerIds[side].set(p.number, id);
    }
  }

  // 3. Partit
  const st = imp.state;
  const setsH = st.setsWon.H;
  const setsA = st.setsWon.A;
  const setsToWin = Math.max(setsH, setsA) === 2 && st.sets.length <= 3 ? 2 : 3;
  const playedAt = dv.date ? new Date(`${dv.date}T${dv.time ?? '12:00'}:00`).toISOString() : null;
  const { data: m, error: me } = await supabase
    .from('matches')
    .insert({
      club_id: opts.clubId,
      season_id: opts.seasonId,
      home_team_id: teamIds.H,
      away_team_id: teamIds.A,
      played_at: playedAt,
      competition: dv.league || null,
      phase: dv.phase || null,
      sets_to_win: setsToWin,
      status: st.phase === 'match_over' ? 'finished' : st.currentSet > 0 ? 'live' : 'scheduled',
      home_sets: setsH,
      away_sets: setsA,
      set_scores: st.sets.map((x) => ({ h: x.home, a: x.away })),
      lenient_actions: true,
      imported_from: 'dvw',
      video_local_name: dv.video,
      coder_id: opts.userId,
      created_by: opts.userId,
    })
    .select('id')
    .single();
  if (me || !m) throw new Error(me?.message ?? 'match');
  const matchId = (m as { id: string }).id;

  // 4. Convocatòria
  const mpRows = (['H', 'A'] as Side[]).flatMap((side) =>
    dv.players[side].map((p) => ({
      match_id: matchId,
      club_id: opts.clubId,
      side,
      player_id: playerIds[side].get(p.number)!,
      shirt_number: p.number,
      position: p.position,
      is_libero: p.libero,
    })),
  );
  if (mpRows.length) {
    const r = await supabase.from('match_players').insert(mpRows);
    if (r.error) throw new Error(r.error.message);
  }

  // 5. Esdeveniments (per blocs). L'hora de cada línia del fitxer es desa com a
  // hora de l'esdeveniment: així es pot sincronitzar després amb el vídeo.
  let set = 0;
  const base = dv.date ? new Date(`${dv.date}T00:00:00`).getTime() : Date.now() - 86400000;
  let dayOffset = 0;
  let prevClock: number | null = null;
  const fallback = new Date().toISOString();
  const rows = imp.events.map((ev, i) => {
    if (ev.type === 'lineup') set += 1;
    let at = fallback;
    if (ev.clock != null) {
      // Partit que passa de mitjanit
      if (prevClock != null && ev.clock < prevClock - 12 * 3600) dayOffset += 86400;
      prevClock = ev.clock;
      at = new Date(base + (ev.clock + dayOffset) * 1000).toISOString();
    }
    const data: Record<string, unknown> = { ...ev };
    delete data.type;
    delete data.videoTime;
    delete data.clock;
    return {
      match_id: matchId,
      club_id: opts.clubId,
      seq: i + 1,
      set_number: Math.max(1, set),
      type: ev.type,
      data,
      video_time: ev.videoTime,
      created_by: opts.userId,
      created_at: at,
    };
  });
  for (let i = 0; i < rows.length; i += 500) {
    const r = await supabase.from('match_events').insert(rows.slice(i, i + 500));
    if (r.error) throw new Error(r.error.message);
  }
  return { matchId, warnings: imp.warnings };
}
