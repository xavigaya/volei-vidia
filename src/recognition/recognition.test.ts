import { describe, expect, it } from 'vitest';
import type { PlayerPosition } from '../lib/types';
import { inferSystem, playersBySlot, rotationInfo, rotationOf, slotsAt, SYSTEM_CODES } from './gameSystems';
import {
  checkOverlap,
  formatReception,
  newReceptionSystem,
  parseReception,
  rotationReception,
  spotOfZone,
  spotsByPosition,
  templateRotation,
  TEMPLATE_CODES,
  zoneOfSpot,
} from './reception';

const positions = (map: Record<number, PlayerPosition>) => (n: number) => map[n];

describe('sistemes de joc', () => {
  it('dedueix un 5-1 amb OH darrere del col·locador', () => {
    // I=S(3) II=OH(7) III=MB(12) IV=OPP(9) V=OH(4) VI=MB(13)
    const lineup = [3, 7, 12, 9, 4, 13];
    const r = inferSystem(lineup, positions({ 3: 'S', 7: 'OH', 12: 'MB', 9: 'OPP', 4: 'OH', 13: 'MB' }));
    expect(r.system).toEqual({ code: '51', anchor: 0 });
    expect(r.mismatches).toEqual([]);
  });

  it('dedueix un 5-1 amb MB darrere del col·locador, amb el col·locador a qualsevol posició', () => {
    // Col·locador a la posició IV
    const lineup = [9, 12, 7, 3, 13, 4];
    const r = inferSystem(lineup, positions({ 3: 'S', 13: 'MB', 4: 'OH', 9: 'OPP', 12: 'MB', 7: 'OH' }));
    expect(r.system).toEqual({ code: '51m', anchor: 3 });
    expect(r.mismatches).toEqual([]);
    expect(playersBySlot(r.system!, lineup)).toEqual([3, 13, 4, 9, 12, 7]);
  });

  it('6-2 / 4-2 són ambigus i s\'han de confirmar', () => {
    const lineup = [1, 2, 3, 4, 5, 6];
    const r = inferSystem(lineup, positions({ 1: 'S', 2: 'OH', 3: 'MB', 4: 'S', 5: 'OH', 6: 'MB' }));
    expect(r.system?.code).toBe('62');
    expect(r.alternatives).toEqual(['42']);
    expect(r.reason).toBe('ambiguous');
  });

  it('avisa si no hi ha col·locador o si un rol no coincideix', () => {
    expect(inferSystem([1, 2, 3, 4, 5, 6], () => 'OH').reason).toBe('no_setter');
    const r = inferSystem([1, 2, 3, 4, 5, 6], positions({ 1: 'S', 2: 'OH', 3: 'MB', 4: 'OH', 5: 'OH', 6: 'MB' }));
    expect(r.mismatches).toEqual([{ position: 3, player: 4, expected: 'OPP', actual: 'OH' }]);
  });

  it('numera les rotacions per la posició del col·locador', () => {
    const sys = { code: '51' as const, anchor: 0 };
    expect(rotationOf(sys, 0)).toBe(1);
    expect(rotationOf(sys, 1)).toBe(6); // el col·locador passa de I a VI
    expect(rotationOf(sys, 2)).toBe(5);
    expect(rotationOf({ code: '51', anchor: 3 }, 0)).toBe(4);
    expect(slotsAt(1)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(slotsAt(6)[5]).toBe(0);
  });

  it('el líbero substitueix el central de la zaga; en 6-2 col·loca el de la zaga i en 4-2 el de davant', () => {
    const p1 = rotationInfo('51', 1); // I=S II=OH1 III=MB1 IV=OPP V=OH2 VI=MB2
    expect(p1.liberoSlot).toBe(5);
    expect(rotationInfo('62', 1).setterPosition).toBe(0);
    expect(rotationInfo('42', 1).setterPosition).toBe(3);
    expect(rotationInfo('62', 4).setterPosition).toBe(0); // S2 a la zaga
  });
});

describe('plantilles de recepció', () => {
  it('totes les plantilles són reglamentàries a totes les rotacions i sistemes', () => {
    for (const code of SYSTEM_CODES) {
      for (const template of TEMPLATE_CODES) {
        for (const hasLibero of [true, false]) {
          for (let r = 1; r <= 6; r++) {
            const rec = templateRotation(code, r, template, hasLibero);
            const byPos = spotsByPosition({ system: code, hasLibero }, r, rec);
            expect(checkOverlap(byPos), `${code} ${template} P${r} L=${hasLibero}`).toEqual([]);
          }
        }
      }
    }
  });

  it('R3 en 5-1: reben el líbero i els dos OH; el col·locador no', () => {
    const rec = templateRotation('51', 1, 'R3', true);
    expect([...rec.receivers].sort()).toEqual(['L', 'OH1', 'OH2']);
    expect(rec.spots.MB2).toBeUndefined(); // el central de la zaga és a la banqueta
    const r5 = templateRotation('51', 1, 'R5', true);
    expect(r5.receivers).not.toContain('S');
    expect(r5.receivers).toHaveLength(5);
  });

  it('detecta faltes de posició', () => {
    const rs = newReceptionSystem('51');
    const rec = rotationReception(rs, 1);
    const byPos = spotsByPosition(rs, 1, rec);
    byPos[0] = { l: 7.5, d: 0.2 }; // posició I davant de la II
    expect(checkOverlap(byPos).some((v) => v.kind === 'front_back' && v.a === 1 && v.b === 0)).toBe(true);
  });
});

describe('notació de text', () => {
  it('zones i modificadors', () => {
    expect(spotOfZone(4, 'x')).toEqual({ l: 1.5, d: 0.5 });
    expect(spotOfZone(1, 'f')).toEqual({ l: 7.5, d: 8.5 });
    expect(zoneOfSpot({ l: 7.5, d: 8.5 })).toEqual({ zone: 1, mod: 'f' });
    expect(zoneOfSpot({ l: 4.5, d: 4.5 })).toEqual({ zone: 8, mod: '' });
  });

  it('llegeix una rotació amb receptors i OH/MB sense número', () => {
    const r = parseReception('P1: S@1x MB@4x OPP@2x OH@7* L@8* OH@9*', '51');
    expect(r.errors).toEqual([]);
    const rec = r.rotations[1]!;
    expect(rec.receivers).toEqual(['OH1', 'L', 'OH2']);
    expect(rec.spots.MB1).toEqual({ l: 1.5, d: 0.5 });
  });

  it('informa dels errors', () => {
    const r = parseReception('P1: S@1x XX@4 OH1@0\nP9: S@1\nhola', '51');
    expect(r.errors.map((e) => e.kind)).toEqual(['label', 'syntax', 'rotation', 'syntax']);
  });

  it('6-2 fa servir S1 i S2', () => {
    const r = parseReception('P1: S@1 S@4', '62');
    expect(Object.keys(r.rotations[1]!.spots)).toEqual(['S1', 'S2']);
  });

  it('el text generat es pot tornar a llegir', () => {
    const rs = newReceptionSystem('51', 'R3');
    const text = formatReception(rs);
    expect(text.split('\n')).toHaveLength(6);
    const back = parseReception(text, '51');
    expect(back.errors).toEqual([]);
    for (let r = 1; r <= 6; r++) {
      expect([...back.rotations[r]!.receivers].sort()).toEqual([...rotationReception(rs, r).receivers].sort());
    }
  });
});

// ---------------------------------------------------------------------
// Verificació amb l'acta
// ---------------------------------------------------------------------
import { DEFAULT_RULES, type MatchEvent, type MatchEventData } from '../engine/match';
import { codedSets, compareScoresheet, durationMinutes, emptySet, parseNumberList } from './scoresheet';

function events(list: MatchEventData[]): MatchEvent[] {
  return list.map((e, i) => ({ ...e, seq: i + 1, set: 1 }) as MatchEvent);
}
const HL = { positions: [1, 2, 3, 4, 5, 6], liberos: [] };
const AL = { positions: [11, 12, 13, 14, 15, 16], liberos: [] };
const p = (side: 'H' | 'A'): MatchEventData => ({ type: 'point', side });

describe('acta', () => {
  // H serveix: H 1-0, 2-0, perd (2-1), A 2-2, A perd (3-2), H 4-2, perd (4-3)
  const evs = events([{ type: 'lineup', home: HL, away: AL, serving: 'H' }, p('H'), p('H'), p('A'), p('A'), p('H'), p('H'), p('A')]);

  it('calcula els punts al canvi de servei', () => {
    const [s] = codedSets(evs, DEFAULT_RULES);
    expect(s.serveLoss.H).toEqual([2, 4]);
    expect(s.serveLoss.A).toEqual([2]);
    expect(s.final).toEqual({ h: 4, a: 3 });
    expect(s.finished).toBe(false);
  });

  it('no hi ha diferències si l\'acta coincideix', () => {
    const sheet = emptySet(1);
    sheet.firstServe = 'H';
    sheet.home.lineup = [1, 2, 3, 4, 5, 6];
    sheet.home.serveLoss = [2, 4];
    sheet.away.serveLoss = [2];
    expect(compareScoresheet({ sets: [sheet] }, codedSets(evs, DEFAULT_RULES))).toEqual([]);
  });

  it('detecta el primer canvi de servei diferent, la formació i el servei inicial', () => {
    const sheet = emptySet(1);
    sheet.firstServe = 'A';
    sheet.home.lineup = [1, 2, 3, 4, 7, null];
    sheet.home.serveLoss = [2, 5];
    const diffs = compareScoresheet({ sets: [sheet, { ...emptySet(2), final: { h: 25, a: 20 } }] }, codedSets(evs, DEFAULT_RULES));
    expect(diffs.map((d) => [d.set, d.kind, d.side ?? '', d.index ?? 0, d.expected, d.actual])).toEqual([
      [1, 'first_serve', '', 0, 'A', 'H'],
      [1, 'lineup', 'H', 5, '7', '5'],
      [1, 'serve_loss', 'H', 2, '5', '4'],
      [2, 'missing_set', '', 0, '25-20', '–'],
    ]);
  });

  it('el resultat final escrit a l\'última casella no compta com a canvi', () => {
    const sheet = emptySet(1);
    sheet.home.serveLoss = [2, 4];
    sheet.away.serveLoss = [2, 3];
    sheet.final = { h: 4, a: 3 };
    expect(compareScoresheet({ sets: [sheet] }, codedSets(evs, DEFAULT_RULES))).toEqual([]);
  });

  it('utilitats', () => {
    expect(parseNumberList('1 5, 9;12')).toEqual([1, 5, 9, 12]);
    expect(durationMinutes('10:00', '10:23')).toBe(23);
    expect(durationMinutes('23:50', '0:10')).toBe(20);
  });
});
