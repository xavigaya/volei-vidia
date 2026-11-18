// =====================================================================
// Paquet d'anàlisi per a l'eina local vidia-vision (etapa 1.2)
//
// Tot el que l'eina necessita saber del partit, sense el vídeo: calibració,
// formacions, convocatòria (dorsal i posició, sense noms), sistemes de joc i
// de recepció, acta amb la seqüència de punts i les accions codificades amb
// el seu instant de vídeo.
// =====================================================================

import type { MatchEvent, MatchState } from '../engine/match';
import type { MatchPlayer, MatchWithTeams } from '../lib/types';
import type { Calibration } from './calibration';
import type { TeamSystem } from './gameSystems';
import type { ReceptionSystem } from './reception';
import { rallySequence, type Scoresheet } from './scoresheet';

export interface PackageInput {
  match: MatchWithTeams;
  state: MatchState;
  players: MatchPlayer[];
  events: MatchEvent[];
  calibrations: Calibration[];
  systems: { set: number; side: 'H' | 'A'; system: TeamSystem | null }[];
  receptions: { side: 'H' | 'A'; reception: ReceptionSystem }[];
  scoresheet: Scoresheet | null;
}

export function buildAnalysisPackage(i: PackageInput) {
  const { match, state } = i;
  const tiebreakSet = match.sets_to_win * 2 - 1;
  const firstCal = [...i.calibrations].sort((a, b) => a.fromTime - b.fromTime)[0];
  const rallies: Record<string, unknown[]> = {};
  for (const ss of i.scoresheet?.sets ?? []) {
    const seq = rallySequence(ss, ss.number === tiebreakSet ? match.tiebreak_points : match.points_per_set);
    if (seq.rallies.length) rallies[String(ss.number)] = seq.rallies;
  }
  return {
    format: 'volei-vidia/analysis-package',
    version: 1,
    match: {
      id: match.id,
      home: { name: match.home.name, code: match.home.code ?? null },
      away: { name: match.away.name, code: match.away.code ?? null },
      date: match.played_at,
      video: { url: match.video_url, localName: match.video_local_name },
      rules: {
        setsToWin: match.sets_to_win,
        pointsPerSet: match.points_per_set,
        tiebreakPoints: match.tiebreak_points,
      },
    },
    // Sense noms: només dorsal i posició
    roster: i.players.map((p) => ({ side: p.side, number: p.shirt_number, position: p.position, libero: p.is_libero })),
    sets: state.sets.map((s) => ({
      number: s.number,
      firstServe: s.firstServe,
      lineup: { H: s.startLineups.H.positions, A: s.startLineups.A.positions },
      liberos: { H: s.startLineups.H.liberos, A: s.startLineups.A.liberos },
      result: { h: s.home, a: s.away, winner: s.winner },
      nearSide: firstCal?.nearSide[s.number] ?? null,
    })),
    systems: i.systems.filter((x) => x.system).map((x) => ({ set: x.set, side: x.side, system: x.system!.code, anchor: x.system!.anchor })),
    receptions: i.receptions.map((r) => ({ side: r.side, ...r.reception })),
    calibrations: i.calibrations,
    scoresheet: i.scoresheet,
    rallies,
    events: i.events.map((e) => ({ ...e })),
  };
}
