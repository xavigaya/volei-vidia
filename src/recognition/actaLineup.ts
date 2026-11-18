// =====================================================================
// Formacions de l'acta al Marcador (anàlisi assistida)
//
// Quan s'ha entrat o importat l'acta, el formulari d'alineació de cada
// set s'omple amb la formació inicial i el primer servei de l'acta. Els
// líberos i el líbero automàtic es prenen del set anterior o de la
// convocatòria, perquè l'acta no indica qui hi entra.
// =====================================================================

import type { Side, TeamLineup } from '../engine/match';
import type { MatchPlayer, SideCode } from '../lib/types';
import type { Scoresheet } from './scoresheet';

export interface LineupValue {
  home: TeamLineup;
  away: TeamLineup;
  serving: Side;
}

export interface ActaLineup {
  value: LineupValue;
  applied: { H: boolean; A: boolean; serving: boolean };
  // Dorsals de l'acta que no són a la convocatòria (o hi són com a líbero)
  unknown: { side: SideCode; number: number }[];
}

function baseTeam(players: MatchPlayer[], side: SideCode): TeamLineup {
  const liberos = players.filter((p) => p.side === side && p.is_libero).map((p) => p.shirt_number);
  const middles = players.filter((p) => p.side === side && p.position === 'MB').map((p) => p.shirt_number);
  return { positions: [-1, -1, -1, -1, -1, -1], liberos, middles, autoLibero: liberos.length > 0 && middles.length > 0 };
}

export function lineupFromActa(
  sheet: Scoresheet | null,
  setNumber: number,
  base: LineupValue | null,
  players: MatchPlayer[],
): ActaLineup | null {
  const ss = sheet?.sets.find((s) => s.number === setNumber);
  if (!ss) return null;
  const value: LineupValue = base
    ? structuredClone(base)
    : { home: baseTeam(players, 'H'), away: baseTeam(players, 'A'), serving: 'H' };
  const applied = { H: false, A: false, serving: false };
  const unknown: ActaLineup['unknown'] = [];

  for (const side of ['H', 'A'] as SideCode[]) {
    const lu = (side === 'H' ? ss.home : ss.away).lineup;
    if (!lu.some((n) => n != null)) continue;
    const team = side === 'H' ? value.home : value.away;
    const roster = new Set(players.filter((p) => p.side === side).map((p) => p.shirt_number));
    const positions = lu.map((n) => {
      if (n == null) return -1;
      if (players.length && (!roster.has(n) || team.liberos.includes(n))) {
        unknown.push({ side, number: n });
        return -1;
      }
      return n;
    });
    team.positions = positions;
    applied[side] = true;
  }
  if (ss.firstServe) {
    value.serving = ss.firstServe;
    applied.serving = true;
  }
  if (!applied.H && !applied.A && !applied.serving) return null;
  return { value, applied, unknown };
}

// La formació de l'acta és diferent de la codificada?
export function differsFromActa(acta: ActaLineup | null, current: LineupValue): boolean {
  if (!acta) return false;
  const same = (a: number[], b: number[]) => a.every((n, i) => n === -1 || n === b[i]);
  return (
    (acta.applied.H && !same(acta.value.home.positions, current.home.positions)) ||
    (acta.applied.A && !same(acta.value.away.positions, current.away.positions)) ||
    (acta.applied.serving && acta.value.serving !== current.serving)
  );
}
