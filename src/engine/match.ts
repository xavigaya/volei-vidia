// =====================================================================
// Motor de partit de voleibol
//
// El partit es desa com una llista ordenada d'esdeveniments (alineació,
// punt, canvi, líbero, temps mort). L'estat (marcador, rotacions, canvis
// usats…) es calcula sempre reproduint aquesta llista. Així:
//  * desfer és tan simple com treure l'últim esdeveniment;
//  * el mateix codi serveix per codificar en directe, revisar i importar;
//  * més endavant es pot treballar sense connexió i sincronitzar.
//
// Posicions: índex 0..5 = posicions I..VI (I = zona de servei).
// Rotació (quan un equip recupera el servei): II→I, I→VI, VI→V, V→IV,
// IV→III, III→II.
// =====================================================================

import { other, type Side } from './side';
import { isComplement, pointWinner, type Action, type Evaluation, type Skill } from './actions';

export { other, type Side };

export interface MatchRules {
  setsToWin: number; // 3 = al millor de 5
  pointsPerSet: number; // 25
  tiebreakPoints: number; // 15
  maxSubstitutions: number; // per set i equip (RFEVB: 8)
  timeoutsPerSet: number; // per set i equip
  // Partits importats (DataVolley…): no es comprova qui és al camp ni qui serveix,
  // perquè els líberos i alguns canvis hi consten de manera implícita
  lenientActions?: boolean;
}

export const DEFAULT_RULES: MatchRules = {
  setsToWin: 3,
  pointsPerSet: 25,
  tiebreakPoints: 15,
  maxSubstitutions: 8,
  timeoutsPerSet: 2,
};

export interface TeamLineup {
  positions: number[]; // 6 dorsals, posicions I..VI
  liberos: number[]; // 0, 1 o 2 dorsals
  // Líbero automàtic: entra pel central (middles) quan aquest és a la zaga
  // i el seu equip perd el servei.
  autoLibero?: boolean;
  middles?: number[];
  // Líbero que entra per defecte en el canvi automàtic
  defaultLibero?: number | null;
}

export type MatchEventData =
  | { type: 'lineup'; home: TeamLineup; away: TeamLineup; serving: Side }
  // error: el punt és per un error de l'altre equip (codi *e / ae)
  | { type: 'point'; side: Side; error?: boolean }
  | { type: 'sub'; side: Side; out: number; in: number }
  | { type: 'libero'; side: Side; libero: number; player: number }
  | { type: 'timeout'; side: Side }
  | ({ type: 'action' } & Action);

export type MatchEvent = MatchEventData & {
  seq: number;
  set: number;
  videoTime?: number | null;
  at?: string | null; // moment en què es va desar (ISO)
};

export interface LiberoOnCourt {
  libero: number;
  replaces: number; // dorsal del jugador que és a la banqueta pel líbero
}

export type Rosters = { H: number[]; A: number[] };

export interface TeamState {
  lineup: number[]; // jugadors "reglamentaris" a les posicions I..VI
  liberos: number[];
  libero: LiberoOnCourt | null;
  lastLibero: number | null;
  autoLibero: boolean;
  middles: number[];
  starters: number[];
  subsUsed: number;
  timeoutsUsed: number;
  // Parelles de canvis del set: titular → suplent
  pairs: { starter: number; sub: number; returned: boolean }[];
}

export interface SetResult {
  number: number;
  home: number;
  away: number;
  winner: Side | null;
  firstServe: Side;
  startLineups: { H: TeamLineup; A: TeamLineup };
}

export type Phase = 'awaiting_lineup' | 'in_play' | 'match_over';

export interface MatchState {
  rules: MatchRules;
  phase: Phase;
  currentSet: number; // 0 abans del primer set
  score: { H: number; A: number };
  setsWon: { H: number; A: number };
  serving: Side;
  teams: { H: TeamState; A: TeamState };
  sets: SetResult[];
  winner: Side | null;
  // Accions de la jugada en curs (es buida a cada punt)
  rally: Action[];
  // Dorsals convocats de cada equip (si es coneixen, es valida que només juguin ells)
  rosters: Rosters | null;
  // Darrer esdeveniment aplicat
  lastSeq: number;
  // Missatges informatius (p. ex. "el líbero surt automàticament")
  notices: string[];
  // Acció que acaba de tancar la jugada (per acceptar-ne la complementària:
  // S# + R=, A# + B=, A/ + B#… sense sumar el punt dues vegades)
  closing: { winner: Side; side: Side; skill: Skill; evaluation: Evaluation } | null;
}

export type EngineErrorCode =
  | 'needs_lineup'
  | 'match_over'
  | 'set_in_play'
  | 'bad_lineup'
  | 'duplicate_player'
  | 'libero_in_lineup'
  | 'player_not_on_court'
  | 'player_on_court'
  | 'max_subs'
  | 'illegal_sub'
  | 'max_timeouts'
  | 'not_libero'
  | 'libero_front_row'
  | 'libero_cannot_serve'
  | 'libero_must_return_for_replaced'
  | 'libero_on_court'
  | 'sub_libero_replaced'
  | 'not_serving_team'
  | 'not_server'
  | 'not_receiving_team'
  | 'not_in_roster';

export class EngineError extends Error {
  constructor(
    public code: EngineErrorCode,
    public params: Record<string, string | number> = {},
  ) {
    super(code);
  }
}

// ---------------------------------------------------------------------
// Utilitats de posicions
// ---------------------------------------------------------------------
export const BACK_ROW = [0, 4, 5]; // I, V, VI
export const FRONT_ROW = [1, 2, 3]; // II, III, IV

export function rotate(lineup: number[]): number[] {
  // nova posició i = antiga posició i+1
  return lineup.map((_, i) => lineup[(i + 1) % 6]);
}

// Jugadors realment al camp (amb el líbero substituint qui toqui)
export function onCourt(team: TeamState): number[] {
  if (!team.libero) return [...team.lineup];
  return team.lineup.map((n) => (n === team.libero!.replaces ? team.libero!.libero : n));
}

export function server(state: MatchState): number | null {
  if (state.phase !== 'in_play') return null;
  return onCourt(state.teams[state.serving])[0];
}

function emptyTeam(): TeamState {
  return {
    lineup: [],
    liberos: [],
    libero: null,
    lastLibero: null,
    autoLibero: false,
    middles: [],
    starters: [],
    subsUsed: 0,
    timeoutsUsed: 0,
    pairs: [],
  };
}

export function initialState(rules: MatchRules = DEFAULT_RULES, rosters: Rosters | null = null): MatchState {
  return {
    rules,
    rosters,
    phase: 'awaiting_lineup',
    currentSet: 0,
    score: { H: 0, A: 0 },
    setsWon: { H: 0, A: 0 },
    serving: 'H',
    teams: { H: emptyTeam(), A: emptyTeam() },
    sets: [],
    winner: null,
    rally: [],
    lastSeq: 0,
    closing: null,
    notices: [],
  };
}

function clone(s: MatchState): MatchState {
  return structuredClone(s);
}

export function targetPoints(state: MatchState, set = state.currentSet): number {
  const isTiebreak = set === state.rules.setsToWin * 2 - 1;
  return isTiebreak ? state.rules.tiebreakPoints : state.rules.pointsPerSet;
}

// ---------------------------------------------------------------------
// Validació d'una alineació
// ---------------------------------------------------------------------
function checkRoster(roster: number[] | null | undefined, n: number) {
  if (roster && !roster.includes(n)) throw new EngineError('not_in_roster', { player: n });
}

function checkLineup(l: TeamLineup, roster: number[] | null) {
  if (l.positions.length !== 6 || l.positions.some((n) => !Number.isInteger(n) || n < 0 || n > 99)) {
    throw new EngineError('bad_lineup');
  }
  const all = [...l.positions, ...l.liberos];
  if (new Set(all).size !== all.length) throw new EngineError('duplicate_player');
  if (l.liberos.length > 2) throw new EngineError('bad_lineup');
  for (const n of all) checkRoster(roster, n);
}

// ---------------------------------------------------------------------
// Aplicació d'un esdeveniment. Llança EngineError si no és vàlid.
// ---------------------------------------------------------------------
export function applyEvent(prev: MatchState, ev: MatchEventData): MatchState {
  const s = clone(prev);
  s.notices = [];
  const closing = s.closing ?? null;
  s.closing = null;

  // Acció complementària de la que ha tancat la jugada: es registra sense nou punt
  if (ev.type === 'action' && closing && ev.side !== closing.side && isComplement(closing, ev)) {
    checkRoster(s.rosters?.[ev.side], ev.player);
    s.notices.push('complement');
    return s;
  }

  if (s.phase === 'match_over') throw new EngineError('match_over');

  switch (ev.type) {
    case 'lineup': {
      if (s.phase === 'in_play') throw new EngineError('set_in_play');
      checkLineup(ev.home, s.rosters?.H ?? null);
      checkLineup(ev.away, s.rosters?.A ?? null);
      s.currentSet += 1;
      s.score = { H: 0, A: 0 };
      s.serving = ev.serving;
      for (const side of ['H', 'A'] as Side[]) {
        const l = side === 'H' ? ev.home : ev.away;
        s.teams[side] = {
          ...emptyTeam(),
          lineup: [...l.positions],
          liberos: [...l.liberos],
          starters: [...l.positions],
          autoLibero: !!l.autoLibero && l.liberos.length > 0,
          middles: (l.middles ?? []).filter((n) => !l.liberos.includes(n)),
          lastLibero: l.defaultLibero != null && l.liberos.includes(l.defaultLibero) ? l.defaultLibero : null,
        };
      }
      s.rally = [];
      s.sets.push({
        number: s.currentSet,
        home: 0,
        away: 0,
        winner: null,
        firstServe: ev.serving,
        startLineups: { H: structuredClone(ev.home), A: structuredClone(ev.away) },
      });
      s.phase = 'in_play';
      // Líbero automàtic a l'inici del set: entra pel central de la zaga
      // (si l'equip serveix, el central de la posició I ha de servir)
      for (const side of ['H', 'A'] as Side[]) {
        const t = s.teams[side];
        if (!t.autoLibero) continue;
        const backRow = s.serving === side ? [4, 5] : BACK_ROW;
        const idx = backRow.find((i) => t.middles.includes(t.lineup[i]));
        if (idx !== undefined) autoLiberoIn(s, side, t.lineup[idx]);
      }
      return s;
    }

    case 'point': {
      requireInPlay(s);
      awardPoint(s, ev.side);
      return s;
    }

    case 'action': {
      requireInPlay(s);
      const t = s.teams[ev.side];
      if (s.rules.lenientActions) {
        checkRoster(s.rosters?.[ev.side], ev.player);
      } else {
        if (!onCourt(t).includes(ev.player)) throw new EngineError('player_not_on_court', { player: ev.player });
        if (ev.skill === 'S') {
          if (s.serving !== ev.side) throw new EngineError('not_serving_team');
          if (onCourt(t)[0] !== ev.player) throw new EngineError('not_server', { player: onCourt(t)[0] });
        }
        if (ev.skill === 'R' && s.serving === ev.side) throw new EngineError('not_receiving_team');
      }
      const action: Action = { ...ev };
      delete (action as { type?: string }).type;
      s.rally.push(action);
      const winner = ev.noPoint ? null : pointWinner(ev);
      if (winner) {
        awardPoint(s, winner);
        s.closing = { winner, side: ev.side, skill: ev.skill, evaluation: ev.evaluation };
      }
      return s;
    }

    case 'timeout': {
      requireInPlay(s);
      const t = s.teams[ev.side];
      if (t.timeoutsUsed >= s.rules.timeoutsPerSet) throw new EngineError('max_timeouts', { max: s.rules.timeoutsPerSet });
      t.timeoutsUsed += 1;
      return s;
    }

    case 'sub': {
      requireInPlay(s);
      const t = s.teams[ev.side];
      checkRoster(s.rosters?.[ev.side], ev.in);
      validateSub(s, t, ev.out, ev.in);
      const pair = t.pairs.find((p) => p.sub === ev.out && !p.returned);
      if (pair) pair.returned = true;
      else t.pairs.push({ starter: ev.out, sub: ev.in, returned: false });
      t.lineup[t.lineup.indexOf(ev.out)] = ev.in;
      t.subsUsed += 1;
      return s;
    }

    case 'libero': {
      requireInPlay(s);
      const t = s.teams[ev.side];
      applyLibero(s, ev.side, t, ev.libero, ev.player);
      return s;
    }
  }
}

function requireInPlay(s: MatchState) {
  if (s.phase !== 'in_play') throw new EngineError('needs_lineup');
}

export function validateSub(s: MatchState, t: TeamState, out: number, inn: number) {
  if (t.liberos.includes(inn) || t.liberos.includes(out)) throw new EngineError('illegal_sub', { player: inn });
  if (t.libero && t.libero.replaces === out) throw new EngineError('sub_libero_replaced', { player: out });
  if (!t.lineup.includes(out)) throw new EngineError('player_not_on_court', { player: out });
  if (t.lineup.includes(inn)) throw new EngineError('player_on_court', { player: inn });
  if (t.subsUsed >= s.rules.maxSubstitutions) throw new EngineError('max_subs', { max: s.rules.maxSubstitutions });

  // Torna el titular per al seu suplent?
  const asSub = t.pairs.find((p) => p.sub === out);
  if (asSub) {
    if (asSub.returned || asSub.starter !== inn) throw new EngineError('illegal_sub', { player: inn });
    return;
  }
  // Surt un titular
  if (!t.starters.includes(out)) throw new EngineError('illegal_sub', { player: out });
  if (t.pairs.some((p) => p.starter === out)) throw new EngineError('illegal_sub', { player: out });
  // Entra un suplent que encara no ha jugat aquest set
  if (t.starters.includes(inn)) throw new EngineError('illegal_sub', { player: inn });
  if (t.pairs.some((p) => p.sub === inn)) throw new EngineError('illegal_sub', { player: inn });
}

function applyLibero(s: MatchState, side: Side, t: TeamState, libero: number, player: number) {
  if (!t.liberos.includes(libero)) throw new EngineError('not_libero', { player: libero });

  if (t.libero) {
    // Ja hi ha un líbero al camp
    if (t.libero.libero === libero) {
      // Surt el líbero: només pot tornar el jugador que havia substituït
      if (player !== t.libero.replaces) {
        throw new EngineError('libero_must_return_for_replaced', { player: t.libero.replaces });
      }
      t.libero = null;
      return;
    }
    // Canvi de líbero per líbero
    if (player === t.libero.libero) {
      t.libero = { libero, replaces: t.libero.replaces };
      t.lastLibero = libero;
      return;
    }
    throw new EngineError('libero_on_court', { player: t.libero.libero });
  }

  // Entra el líbero
  const idx = t.lineup.indexOf(player);
  if (idx < 0) throw new EngineError('player_not_on_court', { player });
  if (!BACK_ROW.includes(idx)) throw new EngineError('libero_front_row', { player });
  if (idx === 0 && s.serving === side) throw new EngineError('libero_cannot_serve');
  t.libero = { libero, replaces: player };
  t.lastLibero = libero;
}

function autoLiberoIn(s: MatchState, side: Side, player: number) {
  const t = s.teams[side];
  if (t.libero || t.liberos.length === 0) return;
  const libero = t.lastLibero ?? t.liberos[0];
  t.libero = { libero, replaces: player };
  t.lastLibero = libero;
  s.notices.push(`libero_auto_in:${side}:${libero}:${player}`);
}

// Punt per a 'winner': rotació, líberos automàtics i final de set/partit
function awardPoint(s: MatchState, winner: Side) {
  s.score[winner] += 1;
  s.rally = [];
  if (winner !== s.serving) {
    const loser = s.serving;
    // Canvi de servei: l'equip que el recupera rota
    const t = s.teams[winner];
    t.lineup = rotate(t.lineup);
    s.serving = winner;
    // Si el jugador substituït pel líbero passa a la davantera, el líbero surt
    if (t.libero) {
      const idx = t.lineup.indexOf(t.libero.replaces);
      if (FRONT_ROW.includes(idx)) {
        s.notices.push(`libero_auto_out:${winner}:${t.libero.libero}:${t.libero.replaces}`);
        t.libero = null;
      }
    }
    // L'equip que perd el servei: si qui acaba de servir és un central, entra el líbero
    const l = s.teams[loser];
    if (l.autoLibero && l.middles.includes(l.lineup[0])) autoLiberoIn(s, loser, l.lineup[0]);
  }
  const cur = s.sets[s.sets.length - 1];
  cur.home = s.score.H;
  cur.away = s.score.A;
  const target = targetPoints(s);
  const lead = s.score[winner] - s.score[other(winner)];
  if (s.score[winner] >= target && lead >= 2) {
    cur.winner = winner;
    s.setsWon[winner] += 1;
    if (s.setsWon[winner] >= s.rules.setsToWin) {
      s.phase = 'match_over';
      s.winner = winner;
    } else {
      s.phase = 'awaiting_lineup';
    }
  }
}

// ---------------------------------------------------------------------
// Reproducció completa
// ---------------------------------------------------------------------
export interface ReplayResult {
  state: MatchState;
  // Esdeveniments que no s'han pogut aplicar (no hauria de passar si
  // s'han validat abans de desar-los)
  errors: { seq: number; error: EngineError }[];
}

export function replay(events: MatchEvent[], rules: MatchRules = DEFAULT_RULES, rosters: Rosters | null = null): ReplayResult {
  let state = initialState(rules, rosters);
  const errors: ReplayResult['errors'] = [];
  for (const ev of [...events].sort((a, b) => a.seq - b.seq)) {
    try {
      state = applyEvent(state, ev);
      state.lastSeq = ev.seq;
    } catch (e) {
      if (e instanceof EngineError) errors.push({ seq: ev.seq, error: e });
      else throw e;
    }
  }
  return { state, errors };
}

// Proposta d'alineació per al set següent: la inicial del set anterior,
// i el primer servei alternat (al tie-break s'ha de sortejar).
export function suggestNextLineup(state: MatchState): { home: TeamLineup; away: TeamLineup; serving: Side } | null {
  const last = state.sets[state.sets.length - 1];
  if (!last) return null;
  return {
    home: structuredClone(last.startLineups.H),
    away: structuredClone(last.startLineups.A),
    serving: other(last.firstServe),
  };
}
