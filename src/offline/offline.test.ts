import { describe, expect, test } from 'vitest';
import { enqueueOp, mergePending, type EventRowPayload, type Op } from './queue';
import type { MatchEvent } from '../engine/match';

const row = (seq: number, extra: Partial<EventRowPayload> = {}): EventRowPayload => ({
  match_id: 'm', club_id: 'c', seq, set_number: 1, type: 'point', data: { side: 'H' }, video_time: null, created_by: null, ...extra,
});
const ins = (seq: number, id = `i${seq}`): Op => ({ id, kind: 'insert_event', matchId: 'm', seq, row: row(seq) });
const del = (seq: number, id = `d${seq}`): Op => ({ id, kind: 'delete_event', matchId: 'm', seq });
const toEvent = (r: EventRowPayload) => ({ ...(r.data as object), type: r.type, seq: r.seq, set: r.set_number, videoTime: r.video_time }) as MatchEvent;

describe('cua de canvis', () => {
  test('esborrar una inserció pendent les anul·la totes dues', () => {
    expect(enqueueOp([ins(1), ins(2)], del(2))).toEqual([ins(1)]);
  });

  test('esborrar un esdeveniment ja enviat afegeix l’operació', () => {
    expect(enqueueOp([ins(1)], del(5)).map((o) => o.id)).toEqual(['i1', 'd5']);
  });

  test('desfer dues vegades el mateix número no perd l’esborrat del servidor', () => {
    // seq 5 ja era al servidor: s'esborra, es torna a codificar i es torna a desfer
    let q: Op[] = [];
    q = enqueueOp(q, del(5, 'a'));
    q = enqueueOp(q, ins(5, 'b'));
    q = enqueueOp(q, del(5, 'c'));
    expect(q.map((o) => o.id)).toEqual(['a']);
  });

  test('l’instant de vídeo d’una inserció pendent es modifica a la mateixa inserció', () => {
    const q = enqueueOp([ins(3)], { id: 't', kind: 'event_time', matchId: 'm', seq: 3, time: 42 });
    expect(q).toHaveLength(1);
    expect(q[0].kind === 'insert_event' && q[0].row.video_time).toBe(42);
  });

  test('la correcció d’una inserció pendent es fa a la mateixa inserció', () => {
    const q = enqueueOp([ins(3)], { id: 'e', kind: 'event_data', matchId: 'm', seq: 3, data: { side: 'A' } });
    expect(q).toHaveLength(1);
    expect(q[0].kind === 'insert_event' && q[0].row.data).toEqual({ side: 'A' });
  });

  test('només es manté l’última correcció d’un esdeveniment enviat', () => {
    let q: Op[] = [];
    q = enqueueOp(q, { id: 'a', kind: 'event_data', matchId: 'm', seq: 1, data: { x: 1 } });
    q = enqueueOp(q, { id: 'b', kind: 'event_data', matchId: 'm', seq: 1, data: { x: 2 } });
    expect(q.map((o) => o.id)).toEqual(['b']);
  });

  test('només es manté una actualització del partit', () => {
    let q: Op[] = [];
    q = enqueueOp(q, { id: 'a', kind: 'match_update', matchId: 'm', patch: { home_sets: 1 } });
    q = enqueueOp(q, { id: 'b', kind: 'match_update', matchId: 'm', patch: { away_sets: 2 } });
    expect(q).toHaveLength(1);
    expect(q[0].kind === 'match_update' && q[0].patch).toEqual({ home_sets: 1, away_sets: 2 });
  });
});

describe('fusió amb el servidor', () => {
  test('afegeix les insercions pendents i treu els esborrats', () => {
    const server = [1, 2, 3].map((s) => toEvent(row(s)));
    const merged = mergePending(server, [del(3), ins(3, 'x'), ins(4), { id: 't', kind: 'event_time', matchId: 'm', seq: 1, time: 9 }], 'm', toEvent);
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(merged[0].videoTime).toBe(9);
  });

  test('aplica les correccions pendents', () => {
    const merged = mergePending([toEvent(row(1))], [{ id: 'e', kind: 'event_data', matchId: 'm', seq: 1, data: { side: 'A' } }], 'm', toEvent);
    expect(merged[0]).toMatchObject({ seq: 1, type: 'point', side: 'A' });
  });

  test('ignora operacions d’altres partits', () => {
    const merged = mergePending([], [{ ...ins(1), matchId: 'altre' } as Op], 'm', toEvent);
    expect(merged).toEqual([]);
  });
});
