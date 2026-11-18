import { describe, expect, it } from 'vitest';
import { applyEvent, initialState, type MatchEventData, type MatchState } from '../engine/match';
import type { Action } from '../engine/actions';
import { newReceptionSystem } from './reception';
import { EVAL_ONLY, rotationsSinceStart, suggestionPrefix, suggestNext, type SuggestContext } from './suggest';

// Local: 5-1, S-OH-MB-OPP-OH-MB amb el col·locador (2) a la posició I, líbero 8
// I=2(S) II=7(OH1) III=12(MB1) IV=9(OPP) V=4(OH2) VI=13(MB2)
const H = { positions: [2, 7, 12, 9, 4, 13], liberos: [8], middles: [12, 13], autoLibero: true };
// Visitant: 5-1 amb el col·locador (3) a la posició IV
// I=11(MB2?) ... ordre S-OH-MB-OPP-OH-MB començant a IV: IV=3 V=5 VI=6 I=10 II=1 III=14
const A = { positions: [10, 1, 14, 3, 5, 6], liberos: [20], middles: [6, 14], autoLibero: true };

const ctx: SuggestContext = {
  H: { system: { code: '51', anchor: 0 }, reception: newReceptionSystem('51', 'R3', true) },
  A: { system: { code: '51', anchor: 3 }, reception: newReceptionSystem('51', 'R3', true) },
};

function start(serving: 'H' | 'A' = 'H'): MatchState {
  return applyEvent(initialState(), { type: 'lineup', home: H, away: A, serving });
}
const action = (a: Partial<Action> & Pick<Action, 'side' | 'player' | 'skill'>): MatchEventData => ({
  type: 'action',
  evaluation: '+',
  ...a,
});

describe('suggeriments per lògica de joc', () => {
  it('inici de jugada: servei de la posició I', () => {
    const s = suggestNext(start('H'), ctx)!;
    expect(s.primary).toEqual({ side: 'H', skill: 'S', candidates: [{ player: 2, label: 'S' }] });
  });

  it('després del servei: recepció de l\'altre equip, amb els receptors de la plantilla primer', () => {
    const st = applyEvent(start('H'), action({ side: 'H', player: 2, skill: 'S' }));
    const s = suggestNext(st, ctx)!;
    expect(s.primary.side).toBe('A');
    expect(s.primary.skill).toBe('R');
    // Visitant en P4 (col·locador a IV): reben el líbero i els dos OH
    expect(s.primary.candidates.slice(0, 3).map((c) => c.label).sort()).toEqual(['L', 'OH1', 'OH2']);
  });

  it('la zona on cau el servei tria el receptor més proper', () => {
    const st0 = start('H');
    const toZone5 = suggestNext(applyEvent(st0, action({ side: 'H', player: 2, skill: 'S', endZone: 5 })), ctx)!;
    const toZone1 = suggestNext(applyEvent(st0, action({ side: 'H', player: 2, skill: 'S', endZone: 1 })), ctx)!;
    expect(toZone5.primary.candidates[0].player).not.toBe(toZone1.primary.candidates[0].player);
  });

  it('després de la recepció: col·locació del col·locador; després, atac', () => {
    let st = applyEvent(start('H'), action({ side: 'H', player: 2, skill: 'S' }));
    st = applyEvent(st, action({ side: 'A', player: 20, skill: 'R' }));
    const s1 = suggestNext(st, ctx)!;
    expect(s1.primary).toMatchObject({ side: 'A', skill: 'E' });
    expect(s1.primary.candidates[0].player).toBe(3);
    st = applyEvent(st, action({ side: 'A', player: 3, skill: 'E', endZone: 4 }));
    const s2 = suggestNext(st, ctx)!;
    expect(s2.primary).toMatchObject({ side: 'A', skill: 'A' });
    // Col·locació a la zona 4: el jugador de la posició IV no pot ser el col·locador; l'OH de davant
    expect(s2.primary.candidates[0].label).toMatch(/OH|OPP/);
    expect(s2.primary.candidates.map((c) => c.player)).not.toContain(20); // el líbero no ataca
  });

  it('una col·locació ràpida proposa el central', () => {
    let st = applyEvent(start('H'), action({ side: 'H', player: 2, skill: 'S' }));
    st = applyEvent(st, action({ side: 'A', player: 20, skill: 'R' }));
    st = applyEvent(st, action({ side: 'A', player: 3, skill: 'E', skillType: 'Q' }));
    expect(suggestNext(st, ctx)!.primary.candidates[0].label).toMatch(/MB/);
  });

  it('després de l\'atac: defensa o bloqueig de l\'altre equip', () => {
    let st = applyEvent(start('H'), action({ side: 'H', player: 2, skill: 'S' }));
    st = applyEvent(st, action({ side: 'A', player: 20, skill: 'R' }));
    st = applyEvent(st, action({ side: 'A', player: 3, skill: 'E' }));
    st = applyEvent(st, action({ side: 'A', player: 5, skill: 'A', startZone: 4 }));
    const s = suggestNext(st, ctx)!;
    expect(s.primary).toMatchObject({ side: 'H', skill: 'D' });
    expect(s.alternatives[0]).toMatchObject({ side: 'H', skill: 'B' });
    // Atac per la zona 4: bloqueja primer la posició II del local (7)
    expect(s.alternatives[0].candidates[0].player).toBe(7);
  });

  it('funciona sense sistema de joc (tots els jugadors del camp)', () => {
    const st = applyEvent(start('H'), action({ side: 'H', player: 2, skill: 'S' }));
    const s = suggestNext(st, { H: { system: null, reception: null }, A: { system: null, reception: null } })!;
    expect(s.primary.skill).toBe('R');
    expect(s.primary.candidates).toHaveLength(6);
  });

  it('després d\'un punt torna a proposar el servei, amb la rotació nova', () => {
    let st = applyEvent(start('H'), action({ side: 'H', player: 2, skill: 'S', evaluation: '=' }));
    // El visitant recupera el servei i rota: serveix qui era a la posició II (1)
    const s = suggestNext(st, ctx)!;
    expect(s.primary).toMatchObject({ side: 'A', skill: 'S' });
    expect(s.primary.candidates[0].player).toBe(1);
    st = applyEvent(st, { type: 'point', side: 'H' });
    expect(suggestNext(st, ctx)!.primary).toMatchObject({ side: 'H', skill: 'S' });
  });

  it('rotacions des de l\'inici, també amb canvis', () => {
    expect(rotationsSinceStart([1, 2, 3, 4, 5, 6], [3, 4, 5, 6, 1, 2])).toBe(2);
    expect(rotationsSinceStart([1, 2, 3, 4, 5, 6], [3, 4, 15, 6, 1, 2])).toBe(2);
  });

  it('codi per a la línia d\'ordres', () => {
    expect(suggestionPrefix({ side: 'A', skill: 'R', candidates: [{ player: 7 }] })).toBe('a7R');
    expect(suggestionPrefix({ side: 'H', skill: 'E', candidates: [{ player: 2 }] })).toBe('*2E');
    expect(EVAL_ONLY.test('+')).toBe(true);
    expect(EVAL_ONLY.test('#16')).toBe(true);
    expect(EVAL_ONLY.test('7R+')).toBe(false);
  });
});
