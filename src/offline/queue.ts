// Lògica pura de la cua de canvis pendents (sense accés a xarxa ni disc)
import type { MatchEvent } from '../engine/match';

export interface EventRowPayload {
  match_id: string;
  club_id: string;
  seq: number;
  set_number: number;
  type: string;
  data: Record<string, unknown>;
  video_time: number | null;
  created_by: string | null;
  created_at?: string;
}

export type Op =
  | { id: string; kind: 'insert_event'; matchId: string; seq: number; row: EventRowPayload; error?: string }
  | { id: string; kind: 'delete_event'; matchId: string; seq: number; error?: string }
  | { id: string; kind: 'event_time'; matchId: string; seq: number; time: number | null; error?: string }
  | { id: string; kind: 'event_data'; matchId: string; seq: number; data: Record<string, unknown>; error?: string }
  | { id: string; kind: 'match_update'; matchId: string; patch: Record<string, unknown>; error?: string };

// Operació nova (sense identificador), conservant la distinció per tipus
export type NewOp = { [K in Op['kind']]: Omit<Extract<Op, { kind: K }>, 'id'> }[Op['kind']];

// Afegeix una operació simplificant la cua:
//  - esborrar un esdeveniment encara no enviat → desapareixen tots dos
//  - canviar l'instant d'un esdeveniment no enviat → es modifica la inserció
//  - només es manté l'última actualització del partit
export function enqueueOp(ops: Op[], op: Op): Op[] {
  if (op.kind === 'delete_event') {
    // Última inserció pendent amb aquest número: s'eliminen ella i el que hi ha després
    let idx = -1;
    ops.forEach((o, i) => {
      if (o.kind === 'insert_event' && o.matchId === op.matchId && o.seq === op.seq && !o.error) idx = i;
    });
    if (idx >= 0) {
      return ops.filter((o, i) => i < idx || !(o.matchId === op.matchId && 'seq' in o && o.seq === op.seq));
    }
    return [...ops.filter((o) => !((o.kind === 'event_time' || o.kind === 'event_data') && o.matchId === op.matchId && o.seq === op.seq)), op];
  }
  if (op.kind === 'event_time') {
    const pending = ops.find((o) => o.kind === 'insert_event' && o.matchId === op.matchId && o.seq === op.seq && !o.error);
    if (pending && pending.kind === 'insert_event') {
      return ops.map((o) => (o === pending ? { ...pending, row: { ...pending.row, video_time: op.time } } : o));
    }
    return [...ops.filter((o) => !(o.kind === 'event_time' && o.matchId === op.matchId && o.seq === op.seq)), op];
  }
  if (op.kind === 'event_data') {
    // Correcció d'un esdeveniment (p. ex. l'alineació d'un set)
    const pending = ops.find((o) => o.kind === 'insert_event' && o.matchId === op.matchId && o.seq === op.seq && !o.error);
    if (pending && pending.kind === 'insert_event') {
      return ops.map((o) => (o === pending ? { ...pending, row: { ...pending.row, data: op.data } } : o));
    }
    return [...ops.filter((o) => !(o.kind === 'event_data' && o.matchId === op.matchId && o.seq === op.seq && !o.error)), op];
  }
  if (op.kind === 'match_update') {
    const prev = ops.find((o) => o.kind === 'match_update' && o.matchId === op.matchId && !o.error);
    if (prev && prev.kind === 'match_update') {
      return [...ops.filter((o) => o !== prev), { ...op, patch: { ...prev.patch, ...op.patch } }];
    }
  }
  return [...ops, op];
}

// Combina els esdeveniments del servidor amb els canvis locals pendents
export function mergePending(server: MatchEvent[], ops: Op[], matchId: string, toEvent: (row: EventRowPayload) => MatchEvent): MatchEvent[] {
  const mine = ops.filter((o) => o.matchId === matchId);
  const deleted = new Set(mine.filter((o) => o.kind === 'delete_event').map((o) => (o as { seq: number }).seq));
  const times = new Map(mine.filter((o) => o.kind === 'event_time').map((o) => [(o as { seq: number }).seq, (o as { time: number | null }).time]));
  const bySeq = new Map<number, MatchEvent>();
  for (const e of server) if (!deleted.has(e.seq)) bySeq.set(e.seq, e);
  for (const o of mine) if (o.kind === 'insert_event') bySeq.set(o.seq, toEvent(o.row));
  // Correccions pendents: el contingut nou substitueix el del servidor
  for (const o of mine) {
    if (o.kind !== 'event_data') continue;
    const e = bySeq.get(o.seq);
    if (e) bySeq.set(o.seq, { ...(o.data as object), type: e.type, seq: e.seq, set: e.set, videoTime: e.videoTime, at: e.at } as MatchEvent);
  }
  return [...bySeq.values()]
    .map((e) => (times.has(e.seq) ? { ...e, videoTime: times.get(e.seq) ?? null } : e))
    .sort((a, b) => a.seq - b.seq);
}
