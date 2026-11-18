import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { applyEvent, initialState, type MatchEvent } from '../engine/match';
import type { MatchWithTeams } from '../lib/types';
import { buildAnalysisPackage } from './analysisPackage';
import { parseScoresheetJson } from './scoresheet';

describe('paquet d\'anàlisi', () => {
  it('inclou la calibració, els sets, la seqüència de punts de l\'acta i les accions amb temps', () => {
    const acta = parseScoresheetJson(readFileSync(new URL('../../docs/exemples/acta-balafia-farners-J2.json', import.meta.url), 'utf8'));
    if (!acta.ok) throw new Error('acta');
    const lineup = { type: 'lineup' as const, home: { positions: [19, 2, 30, 13, 6, 8], liberos: [18] }, away: { positions: [13, 17, 6, 1, 14, 4], liberos: [12] }, serving: 'A' as const };
    const events = [{ ...lineup, seq: 1, set: 1, videoTime: 12.5 }] as MatchEvent[];
    const state = applyEvent(initialState(), lineup);
    const match = { id: 'm1', home: { name: 'CTI Balàfia Vòlei', code: 'BAL' }, away: { name: 'Volei Farners', code: 'FAR' }, sets_to_win: 3, points_per_set: 25, tiebreak_points: 15, played_at: '2026-11-07T10:00:00Z', video_url: null, video_local_name: 'partit.mp4' } as unknown as MatchWithTeams;
    const cal = { fromTime: 0, width: 1920, height: 1080, netHeight: 2.43, nearSide: { 1: 'A' as const, 2: 'H' as const }, points: { nl: { x: 0.07, y: 0.99 }, nr: { x: 0.9, y: 0.99 }, fr: { x: 0.63, y: 0.38 }, fl: { x: 0.37, y: 0.38 } } };
    const pkg = buildAnalysisPackage({
      match, state, events, players: [], calibrations: [cal], systems: [{ set: 1, side: 'H', system: { code: '51m', anchor: 1 } }], receptions: [], scoresheet: acta.sheet,
    });
    expect(pkg.sets[0]).toMatchObject({ number: 1, firstServe: 'A', nearSide: 'A' });
    expect(Object.keys(pkg.rallies)).toEqual(['1', '2', '3', '4']);
    expect(pkg.rallies['1']).toHaveLength(47);
    expect(pkg.events[0]).toMatchObject({ set: 1, videoTime: 12.5, type: 'lineup' });
    expect(pkg.roster).toEqual([]);
    // Per a la prova de compatibilitat amb l'eina en Python
    if (process.env.PACKAGE_OUT) writeFileSync(process.env.PACKAGE_OUT, JSON.stringify(pkg));
  });
});
