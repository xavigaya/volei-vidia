import { describe, expect, it } from 'vitest';
import {
  anchorFor,
  parseReceptionJson,
  parseSystemsJson,
  receptionToJson,
  scoresheetToJson,
  slug,
  systemsToJson,
} from './exchange';
import { formatReception, newReceptionSystem } from './reception';
import { emptySet, parseScoresheetJson } from './scoresheet';

describe('intercanvi en JSON', () => {
  it('acta: només s\'exporten els sets amb dades i es pot tornar a importar', () => {
    const s1 = emptySet(1);
    s1.firstServe = 'A';
    s1.home.serveLoss = [3, 4, 25];
    s1.final = { h: 25, a: 22 };
    const json = scoresheetToJson({ sets: [s1, emptySet(2)], notes: 'prova' }, { home: 'Balàfia', away: 'Farners' });
    expect(json.sets).toHaveLength(1);
    const back = parseScoresheetJson(JSON.stringify(json));
    expect(back.ok && back.sheet.sets[0]).toEqual(s1);
  });

  it('recepció: exportar i importar conserva les rotacions personalitzades', () => {
    const rs = newReceptionSystem('51', 'R3', true);
    rs.rotations[2] = { spots: { S: { l: 7.5, d: 0.8 }, L: { l: 8, d: 7 } }, receivers: ['L', 'OH1', 'XX' as never] };
    const json = receptionToJson(rs, formatReception(rs), 'Balàfia');
    const r = parseReceptionJson(JSON.stringify(json));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.team).toBe('Balàfia');
    expect(r.reception.rotations[2]!.spots.S).toEqual({ l: 7.5, d: 0.8 });
    expect(r.reception.rotations[2]!.receivers).toEqual(['L', 'OH1']);
  });

  it('recepció: també es pot importar només amb la notació de text', () => {
    const r = parseReceptionJson(JSON.stringify({ system: '51', notation: 'P1: S@1x MB1@4x OPP@2x OH1@7* L@8* OH2@9*' }));
    expect(r.ok && r.reception.rotations[1]!.receivers).toEqual(['OH1', 'L', 'OH2']);
  });

  it('recepció: errors', () => {
    expect(parseReceptionJson('x')).toEqual({ ok: false, error: 'json' });
    expect(parseReceptionJson('{"format":"altre","system":"51"}')).toEqual({ ok: false, error: 'format' });
    expect(parseReceptionJson('{"system":"33"}')).toEqual({ ok: false, error: 'system' });
    expect(parseReceptionJson('{"system":"51","rotations":{"9":{"spots":{}}}}').ok).toBe(false);
    expect(parseReceptionJson('{"system":"51","notation":"P1: ZZ@1"}')).toMatchObject({ ok: false, error: 'notation' });
  });

  it('sistema de joc: el col·locador es busca pel dorsal', () => {
    const json = systemsToJson([{ set: 1, side: 'H', system: '51', setter: 2, anchor: 0 }]);
    const r = parseSystemsJson(JSON.stringify(json));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(anchorFor(r.systems[0], [19, 2, 30, 13, 6, 8])).toBe(1);
    expect(anchorFor(r.systems[0], [19, 3, 30, 13, 6, 8])).toBe(0);
    expect(parseSystemsJson('{"systems":[{"set":1,"side":"X","system":"51"}]}')).toMatchObject({ ok: false, error: 'entries' });
  });

  it('noms de fitxer', () => {
    expect(slug('acta', 'CTI Balàfia Vòlei', 'Volei Farners', '2026-11-07')).toBe('acta_cti-balafia-volei_volei-farners_2026-11-07');
  });
});
