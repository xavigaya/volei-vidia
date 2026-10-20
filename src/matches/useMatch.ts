import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { useClub } from '../club/ClubProvider';
import type { MatchEventRow, MatchPlayer, MatchWithTeams } from '../lib/types';
import {
  applyEvent,
  EngineError,
  replay,
  type MatchEvent,
  type MatchEventData,
  type MatchRules,
  type MatchState,
} from '../engine/match';
import { cached } from '../offline/store';
import { enqueue, flush, getOps, subscribe } from '../offline/outbox';
import { mergePending, type EventRowPayload } from '../offline/queue';

export const MATCH_SELECT =
  '*, home:teams!matches_home_team_id_fkey(id, name, short_name, code, color, is_own, coach, assistant), away:teams!matches_away_team_id_fkey(id, name, short_name, code, color, is_own, coach, assistant)';

export function rulesOf(
  m: Pick<MatchWithTeams, 'sets_to_win' | 'points_per_set' | 'tiebreak_points' | 'max_substitutions' | 'timeouts_per_set' | 'lenient_actions'>,
): MatchRules {
  return {
    lenientActions: !!m.lenient_actions,
    setsToWin: m.sets_to_win,
    pointsPerSet: m.points_per_set,
    tiebreakPoints: m.tiebreak_points,
    maxSubstitutions: m.max_substitutions,
    timeoutsPerSet: m.timeouts_per_set,
  };
}

export function rowToEvent(
  r: Pick<MatchEventRow, 'seq' | 'set_number' | 'type' | 'data' | 'video_time'> & { created_at?: string | null },
): MatchEvent {
  return { ...(r.data as object), type: r.type, seq: r.seq, set: r.set_number, videoTime: r.video_time, at: r.created_at ?? null } as MatchEvent;
}

function eventToData(ev: MatchEventData): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...ev };
  delete rest.type;
  return rest;
}

export type AppendResult = { ok: true; state: MatchState } | { ok: false; error: EngineError | Error };

export function useMatch(matchId: string) {
  const { user } = useAuth();
  const { isAdmin, canEdit } = useClub();
  const [match, setMatch] = useState<MatchWithTeams | null>(null);
  const [players, setPlayers] = useState<MatchPlayer[]>([]);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Dades llegides de la còpia local perquè no hi ha connexió
  const [fromCache, setFromCache] = useState(false);
  const busy = useRef(false);

  // Totes les lectures tenen còpia local per poder treballar sense connexió
  const loadMatch = useCallback(async () => {
    const r = await cached(`match:${matchId}`, () => supabase.from('matches').select(MATCH_SELECT).eq('id', matchId).single());
    if (r.error) setError(r.error.message);
    else setMatch(r.data as unknown as MatchWithTeams);
    setFromCache(r.fromCache);
  }, [matchId]);

  const loadPlayers = useCallback(async () => {
    const r = await cached(`mplayers:${matchId}`, () =>
      supabase.from('match_players').select('*, players(id, first_name, last_name, nickname)').eq('match_id', matchId).order('shirt_number'),
    );
    if (r.error) setError(r.error.message);
    else setPlayers((r.data ?? []) as MatchPlayer[]);
  }, [matchId]);

  const loadEvents = useCallback(async () => {
    const r = await cached(`events:${matchId}`, () =>
      supabase.from('match_events').select('seq, set_number, type, data, video_time, created_at').eq('match_id', matchId).order('seq'),
    );
    if (r.error) {
      setError(r.error.message);
      return;
    }
    // Es completen amb els canvis locals que encara no s'han enviat
    const server = ((r.data ?? []) as MatchEventRow[]).map((row) => rowToEvent(row));
    setEvents(mergePending(server, await getOps(), matchId, (row) => rowToEvent(row as unknown as MatchEventRow)));
  }, [matchId]);

  // Canvis pendents d'aquest partit (per a l'indicador)
  const [pending, setPending] = useState({ count: 0, failed: 0 });
  useEffect(() => {
    const update = () =>
      void getOps().then((ops) => {
        const mine = ops.filter((o) => o.matchId === matchId);
        setPending({ count: mine.filter((o) => !o.error).length, failed: mine.filter((o) => o.error).length });
      });
    update();
    return subscribe(update);
  }, [matchId]);

  useEffect(() => {
    setLoading(true);
    void Promise.all([loadMatch(), loadPlayers(), loadEvents()]).then(() => setLoading(false));
  }, [loadMatch, loadPlayers, loadEvents]);

  // Seguiment en directe: qualsevol canvi als esdeveniments d'aquest partit
  useEffect(() => {
    const channel = supabase
      .channel(`match-${matchId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_events', filter: `match_id=eq.${matchId}` }, () => {
        if (!busy.current) void loadEvents();
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'match_events' }, (payload) => {
        const old = payload.old as Partial<MatchEventRow>;
        if (old.match_id === matchId && !busy.current) void loadEvents();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [matchId, loadEvents]);

  const rules = useMemo(() => (match ? rulesOf(match) : null), [match]);
  // Dorsals convocats: el motor no deixa alinear ni fer entrar ningú més
  const rosters = useMemo(
    () =>
      players.length === 0
        ? null
        : {
            H: players.filter((p) => p.side === 'H').map((p) => p.shirt_number),
            A: players.filter((p) => p.side === 'A').map((p) => p.shirt_number),
          },
    [players],
  );
  const replayed = useMemo(() => (rules ? replay(events, rules, rosters) : null), [events, rules, rosters]);
  const state = replayed?.state ?? null;
  // Estat més recent, per poder encadenar diversos esdeveniments seguits
  const stateRef = useRef<MatchState | null>(state);
  stateRef.current = state;

  const isCoder = !!match && !!user && match.coder_id === user.id;
  const canCode = !!match && canEdit && (isCoder || isAdmin);

  const syncSummary = useCallback(
    async (s: MatchState) => {
      if (!match) return;
      const summary = {
        home_sets: s.setsWon.H,
        away_sets: s.setsWon.A,
        set_scores: s.sets.map((x) => ({ h: x.home, a: x.away })),
        status: s.phase === 'match_over' ? 'finished' : s.currentSet > 0 ? 'live' : 'scheduled',
      };
      setMatch((m) => (m ? ({ ...m, ...summary } as MatchWithTeams) : m));
      await enqueue({ kind: 'match_update', matchId: match.id, patch: summary });
    },
    [match],
  );

  // Valida l'esdeveniment amb el motor i, si és correcte, el desa
  const append = useCallback(
    async (
      input: MatchEventData | ((s: MatchState) => MatchEventData),
      videoTime: number | null = null,
    ): Promise<AppendResult> => {
      const state = stateRef.current;
      if (!state || !match) return { ok: false, error: new Error('not_loaded') };
      const ev = typeof input === 'function' ? input(state) : input;
      let next: MatchState;
      try {
        next = applyEvent(state, ev);
      } catch (e) {
        return { ok: false, error: e as Error };
      }
      const seq = state.lastSeq + 1;
      const set = ev.type === 'lineup' ? state.currentSet + 1 : state.currentSet;
      const at = new Date().toISOString();
      const newEvent = { ...ev, seq, set, videoTime, at } as MatchEvent;
      next.lastSeq = seq;
      stateRef.current = next;
      setEvents((list) => [...list, newEvent]);
      // Es desa a la cua local i s'envia quan hi ha connexió (immediatament si n'hi ha)
      const row: EventRowPayload = {
        match_id: match.id,
        club_id: match.club_id,
        seq,
        set_number: set,
        type: ev.type,
        data: eventToData(ev),
        video_time: videoTime,
        created_by: user?.id ?? null,
        created_at: at,
      };
      busy.current = true;
      await enqueue({ kind: 'insert_event', matchId: match.id, seq, row });
      busy.current = false;
      if (ev.type === 'point' || ev.type === 'lineup' || next.score.H + next.score.A !== state.score.H + state.score.A) {
        void syncSummary(next);
      }
      return { ok: true, state: next };
    },
    [match, user, syncSummary],
  );

  const undo = useCallback(async () => {
    if (!match || events.length === 0) return;
    const last = events[events.length - 1];
    const remaining = events.slice(0, -1);
    setEvents(remaining);
    busy.current = true;
    await enqueue({ kind: 'delete_event', matchId: match.id, seq: last.seq });
    busy.current = false;
    if (rules) void syncSummary(replay(remaining, rules).state);
  }, [match, events, rules, syncSummary]);

  // Canvia l'instant de vídeo d'un esdeveniment
  const setEventTime = useCallback(
    async (seq: number, time: number | null) => {
      if (!match) return;
      setEvents((list) => list.map((e) => (e.seq === seq ? { ...e, videoTime: time } : e)));
      await enqueue({ kind: 'event_time', matchId: match.id, seq, time });
    },
    [match],
  );

  // Corregeix un esdeveniment ja desat (p. ex. l'alineació inicial d'un set).
  // Es reprodueix tot el partit amb la correcció: si alguna acció posterior
  // deixa de ser vàlida, no es desa i es retorna el primer problema.
  const editEvent = useCallback(
    async (seq: number, data: MatchEventData): Promise<{ ok: true } | { ok: false; seq: number; error: EngineError }> => {
      if (!match || !rules) return { ok: false, seq, error: new EngineError('needs_lineup') };
      const before = new Set(replay(events, rules, rosters).errors.map((e) => e.seq));
      const next = events.map((e) => (e.seq === seq ? ({ ...data, seq: e.seq, set: e.set, videoTime: e.videoTime, at: e.at } as MatchEvent) : e));
      const fresh = replay(next, rules, rosters).errors.filter((e) => !before.has(e.seq));
      if (fresh.length) return { ok: false, seq: fresh[0].seq, error: fresh[0].error };
      setEvents(next);
      await enqueue({ kind: 'event_data', matchId: match.id, seq, data: eventToData(data) });
      return { ok: true };
    },
    [match, rules, rosters, events],
  );

  // Sincronitza tot el partit a partir d'una acció i el seu instant de vídeo
  const syncVideo = useCallback(
    async (seq: number, time: number, onlyMissing: boolean) => {
      if (!match) return 0;
      // Primer s'envien els canvis pendents (la sincronització es fa al servidor)
      await flush();
      const { data, error } = await supabase.rpc('sync_match_video', {
        p_match: match.id,
        p_seq: seq,
        p_time: time,
        p_only_missing: onlyMissing,
      });
      if (error) {
        setError(error.message);
        return 0;
      }
      await loadEvents();
      return (data as number) ?? 0;
    },
    [match, loadEvents],
  );

  // Canvia dades del partit (vídeo, data, competició, àrbitres…). Retorna l'error, si n'hi ha.
  const updateMatch = useCallback(
    async (patch: Partial<Pick<MatchWithTeams, 'video_url' | 'video_local_name' | 'played_at' | 'competition' | 'phase' | 'venue' | 'city' | 'spectators' | 'referees'>>) => {
      if (!match) return 'not_loaded';
      const { error } = await supabase.from('matches').update(patch).eq('id', match.id);
      if (error) {
        setError(error.message);
        return error.message;
      }
      setMatch((m) => (m ? { ...m, ...patch } : m));
      return null;
    },
    [match],
  );
  const saveVideo = useCallback(
    async (patch: { video_url?: string | null; video_local_name?: string | null }) => {
      await updateMatch(patch);
    },
    [updateMatch],
  );

  const claim = useCallback(async () => {
    if (!match) return;
    const { error } = await supabase.rpc('claim_match', { p_match: match.id });
    if (error) setError(error.message);
    await loadMatch();
  }, [match, loadMatch]);

  return {
    match,
    players,
    events,
    state,
    replayErrors: replayed?.errors ?? [],
    loading,
    error,
    setError,
    fromCache,
    pending,
    canCode,
    isCoder,
    append,
    undo,
    claim,
    setEventTime,
    editEvent,
    syncVideo,
    saveVideo,
    updateMatch,
    reloadMatch: loadMatch,
    reloadPlayers: loadPlayers,
  };
}

export type UseMatch = ReturnType<typeof useMatch>;
