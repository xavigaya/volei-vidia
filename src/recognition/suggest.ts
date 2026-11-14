// =====================================================================
// Suggeriments per lògica de joc (reconeixement de jugades, etapa 0.2)
//
// A partir de l'estat del partit (qui serveix, rotació, accions de la
// jugada en curs) i de les dades prèvies (sistema de joc i de recepció de
// cada equip) es proposa la següent acció més probable: equip, fonament i
// jugadors candidats ordenats. L'analista només ha de confirmar-la i
// afegir-hi la qualificació (i, si vol, les zones).
//
// No fa servir cap model entrenat: només regles del joc. Funciona també en
// directe i sense vídeo.
// =====================================================================

import type { Action, Skill } from '../engine/actions';
import { onCourt, rotate, type MatchState, type Side } from '../engine/match';
import { other } from '../engine/side';
import { isBackRow, rotationInfo, rotationOf, type Role, type SpotLabel, type TeamSystem } from './gameSystems';
import { receivingCourt, rotationReception, spotOfZone, type ReceptionSystem } from './reception';

export interface Candidate {
  player: number;
  label?: SpotLabel; // rol dins el sistema (OH1, L…)
}

export interface SuggestedAction {
  side: Side;
  skill: Skill;
  candidates: Candidate[]; // el primer és el més probable
}

export interface Suggestion {
  primary: SuggestedAction;
  alternatives: SuggestedAction[];
}

export interface TeamContext {
  system: TeamSystem | null; // sistema del set en curs
  reception: ReceptionSystem | null;
}

export type SuggestContext = Record<Side, TeamContext>;

// ---------------------------------------------------------------------
// Rotació actual d'un equip: quantes vegades ha rotat des de la formació
// inicial del set (amb canvis, es compara per posicions coincidents)
// ---------------------------------------------------------------------
export function rotationsSinceStart(start: number[], current: number[]): number {
  let best = 0;
  let bestScore = -1;
  let r = [...start];
  for (let k = 0; k < 6; k++) {
    const score = r.reduce((acc, n, i) => acc + (n === current[i] ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
    r = rotate(r);
  }
  return best;
}

interface CourtView {
  rotation: number; // P1..P6
  // Per posició I..VI: dorsal real al camp (amb el líbero), rol i etiqueta
  players: number[];
  roles: Role[];
  labels: SpotLabel[];
  setterPosition: number;
}

function courtView(state: MatchState, side: Side, ctx: TeamContext): CourtView | null {
  const set = state.sets[state.sets.length - 1];
  if (!set || !ctx.system) return null;
  const team = state.teams[side];
  const k = rotationsSinceStart(set.startLineups[side].positions, team.lineup);
  const rotation = rotationOf(ctx.system, k);
  const info = rotationInfo(ctx.system.code, rotation);
  const players = onCourt(team);
  const labels: SpotLabel[] = info.labels.map((l, pos) => (team.liberos.includes(players[pos]) ? 'L' : l));
  return { rotation, players, roles: info.roles, labels, setterPosition: info.setterPosition };
}

const cand = (v: CourtView, positions: number[]): Candidate[] =>
  positions.map((pos) => ({ player: v.players[pos], label: v.labels[pos] }));

const uniq = (list: Candidate[]): Candidate[] => {
  const seen = new Set<number>();
  return list.filter((c) => (seen.has(c.player) ? false : (seen.add(c.player), true)));
};

const ALL = [0, 1, 2, 3, 4, 5];
const FRONT = [3, 2, 1]; // IV, III, II
const BACK = [4, 5, 0]; // V, VI, I

// Jugadors sense context (sense sistema): tots els del camp
function plain(state: MatchState, side: Side): Candidate[] {
  return onCourt(state.teams[side]).map((player) => ({ player }));
}

// Receptors ordenats segons el sistema de recepció i, si es coneix, la zona on cau el servei
function receivers(state: MatchState, side: Side, ctx: TeamContext, v: CourtView | null, serve: Action | undefined): Candidate[] {
  if (!v || !ctx.system) return plain(state, side);
  const rs = ctx.reception ?? null;
  if (!rs || rs.system !== ctx.system.code) {
    // Sense recepció definida: el líbero i els receptors primer
    const order = ALL.filter((p) => v.labels[p] === 'L')
      .concat(ALL.filter((p) => v.roles[p] === 'OH'))
      .concat(ALL);
    return uniq(cand(v, order));
  }
  const rec = rotationReception(rs, v.rotation);
  const court = receivingCourt(rs.system, v.rotation, rs.hasLibero);
  const target = serve?.endZone ? spotOfZone(serve.endZone) : null;
  const scored = court.map((cp) => {
    const spot = rec.spots[cp.label];
    const isRec = rec.receivers.includes(cp.label);
    const dist = target && spot ? Math.hypot(spot.l - target.l, spot.d - target.d) : 0;
    return { pos: cp.position, score: (isRec ? 0 : 100) + dist };
  });
  scored.sort((a, b) => a.score - b.score);
  return uniq(cand(v, scored.map((s) => s.pos)));
}

function setters(state: MatchState, side: Side, v: CourtView | null, exclude?: number): Candidate[] {
  if (!v) return plain(state, side).filter((c) => c.player !== exclude);
  // Si el col·locador ha fet el primer toc, col·loca el líbero o l'oposat
  const order = [v.setterPosition]
    .concat(ALL.filter((p) => v.labels[p] === 'L'))
    .concat(ALL.filter((p) => v.roles[p] === 'OPP' || v.roles[p] === 'S'))
    .concat(ALL);
  return uniq(cand(v, order)).filter((c) => c.player !== exclude);
}

// Atacants: davantera (segons la zona o el tipus de col·locació) i després zaga
function attackers(state: MatchState, side: Side, v: CourtView | null, set: Action | undefined): Candidate[] {
  if (!v) return plain(state, side);
  const team = state.teams[side];
  const canAttack = (pos: number) => !team.liberos.includes(v.players[pos]) && pos !== v.setterPosition;
  // Zona de destinació de la col·locació → posició que hi ataca
  const zoneToPos: Record<number, number> = { 4: 3, 3: 2, 2: 1, 7: 4, 8: 5, 9: 0, 5: 4, 6: 5, 1: 0 };
  const order: number[] = [];
  if (set?.endZone && zoneToPos[set.endZone] !== undefined) order.push(zoneToPos[set.endZone]);
  if (set?.skillType === 'Q' || set?.skillType === 'M') order.push(...FRONT.filter((p) => v.roles[p] === 'MB'));
  // Per defecte: OH de davant (zona 4), OPP (zona 2), central i després zaga
  const pref = (r: Role) => FRONT.filter((p) => v.roles[p] === r);
  order.push(...pref('OH'), ...pref('OPP'), ...pref('S'), ...pref('MB'));
  order.push(...BACK.filter((p) => v.roles[p] === 'OPP' || v.roles[p] === 'OH' || v.roles[p] === 'S'));
  const list = uniq(cand(v, order.filter(canAttack)));
  // El col·locador de davant (bolcada) com a última opció
  if (!isBackRow(v.setterPosition)) list.push(...cand(v, [v.setterPosition]));
  return uniq(list);
}

// Bloquejadors: davantera de l'altre equip, començant pel que és davant de la zona d'atac
function blockers(state: MatchState, side: Side, v: CourtView | null, attack: Action | undefined): Candidate[] {
  if (!v) return plain(state, side);
  // Un atac per la zona 4 el bloqueja la posició II de l'altre equip, etc.
  const facing: Record<number, number> = { 4: 1, 3: 2, 2: 3 };
  const first = attack?.startZone ? facing[attack.startZone] : undefined;
  const order = (first !== undefined ? [first] : []).concat([2, 1, 3]);
  return uniq(cand(v, order));
}

// Defensors: zaga i líbero primer
function defenders(state: MatchState, side: Side, v: CourtView | null): Candidate[] {
  if (!v) return plain(state, side);
  const order = ALL.filter((p) => v.labels[p] === 'L').concat(BACK, FRONT);
  return uniq(cand(v, order));
}

function act(side: Side, skill: Skill, candidates: Candidate[]): SuggestedAction {
  return { side, skill, candidates };
}

export function suggestNext(state: MatchState, ctx: SuggestContext): Suggestion | null {
  if (state.phase !== 'in_play') return null;
  const views: Record<Side, CourtView | null> = { H: courtView(state, 'H', ctx.H), A: courtView(state, 'A', ctx.A) };
  const rally = state.rally;
  const last = rally[rally.length - 1];
  const serving = state.serving;
  const receiving = other(serving);

  // Inici de jugada: servei de la posició I
  if (!last) {
    const server = onCourt(state.teams[serving])[0];
    const v = views[serving];
    return { primary: act(serving, 'S', [{ player: server, label: v?.labels[0] }]), alternatives: [] };
  }

  const prevTouch = rally.length >= 2 ? rally[rally.length - 2] : undefined;
  const same = last.side;
  const opp = other(same);

  switch (last.skill) {
    case 'S':
      return {
        primary: act(receiving, 'R', receivers(state, receiving, ctx[receiving], views[receiving], last)),
        alternatives: [],
      };
    case 'R':
      if (last.evaluation === '/') {
        // La recepció passa directa a l'altre camp
        return {
          primary: act(opp, 'A', attackers(state, opp, views[opp], undefined)),
          alternatives: [act(opp, 'D', defenders(state, opp, views[opp])), act(opp, 'F', defenders(state, opp, views[opp]))],
        };
      }
      return {
        primary: act(same, 'E', setters(state, same, views[same], last.player)),
        alternatives: [act(same, 'A', attackers(state, same, views[same], undefined))],
      };
    case 'D':
    case 'F':
      return {
        primary: act(same, 'E', setters(state, same, views[same], last.player)),
        alternatives: [act(same, 'A', attackers(state, same, views[same], undefined))],
      };
    case 'E':
      return {
        primary: act(same, 'A', attackers(state, same, views[same], last)),
        alternatives: [act(opp, 'F', defenders(state, opp, views[opp]))],
      };
    case 'A':
      return {
        primary: act(opp, 'D', defenders(state, opp, views[opp])),
        alternatives: [act(opp, 'B', blockers(state, opp, views[opp], last)), act(same, 'D', defenders(state, same, views[same]))],
      };
    case 'B': {
      // Després del bloqueig: defensa de l'equip que bloqueja o de l'atacant (cobertura)
      const attackSide = prevTouch?.skill === 'A' ? prevTouch.side : opp;
      const cover = last.evaluation === '-' || last.evaluation === '/';
      const first = cover ? attackSide : same;
      return {
        primary: act(first, 'D', defenders(state, first, views[first])),
        alternatives: [act(other(first), 'D', defenders(state, other(first), views[other(first)]))],
      };
    }
  }
}

// Codi per a la línia d'ordres: "*7R" o "a12E"
export function suggestionPrefix(a: SuggestedAction, player = a.candidates[0]?.player): string {
  if (player == null) return '';
  return `${a.side === 'H' ? '*' : 'a'}${player}${a.skill}`;
}

// Línia d'ordres amb només la qualificació (i zones): "+", "#16", "-~8"
export const EVAL_ONLY = /^(\+\+|--|[#+!\-/=])([1-9~]){0,2}$/;
