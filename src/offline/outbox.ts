// Cua persistent de canvis pendents i sincronització amb el servidor
import { supabase } from '../lib/supabase';
import { kvGet, kvSet, isNetworkError } from './store';
import { enqueueOp, type NewOp, type Op } from './queue';

const KEY = 'outbox';
let ops: Op[] = [];
let loaded: Promise<void> | null = null;
let flushing: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load(): Promise<void> {
  if (!loaded) {
    loaded = kvGet<Op[]>(KEY).then((v) => {
      ops = Array.isArray(v) ? v : [];
      emit();
    });
  }
  return loaded;
}

function emit() {
  for (const l of listeners) l();
}

async function save() {
  await kvSet(KEY, ops);
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function getOps(): Promise<Op[]> {
  await load();
  return ops;
}

export function currentOps(): Op[] {
  return ops;
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export async function enqueue(op: NewOp): Promise<void> {
  await load();
  ops = enqueueOp(ops, { ...op, id: newId() } as Op);
  await save();
  void flush();
}

async function send(op: Op): Promise<{ message: string; code?: string } | null> {
  switch (op.kind) {
    case 'insert_event': {
      const { error } = await supabase.from('match_events').insert(op.row);
      // Ja hi era (p. ex. s'havia enviat però no va arribar la resposta)
      if (error?.code === '23505') return null;
      return error;
    }
    case 'delete_event': {
      const { error } = await supabase.from('match_events').delete().eq('match_id', op.matchId).eq('seq', op.seq);
      return error;
    }
    case 'event_time': {
      const { error } = await supabase.from('match_events').update({ video_time: op.time }).eq('match_id', op.matchId).eq('seq', op.seq);
      return error;
    }
    case 'event_data': {
      const { error } = await supabase.from('match_events').update({ data: op.data }).eq('match_id', op.matchId).eq('seq', op.seq);
      return error;
    }
    case 'match_update': {
      const { error } = await supabase.from('matches').update(op.patch).eq('id', op.matchId);
      return error;
    }
  }
}

// Envia els canvis en ordre. S'atura al primer error de xarxa; els altres
// errors es marquen a l'operació perquè l'usuari decideixi.
export function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    await load();
    for (const op of [...ops]) {
      if (op.error) continue;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
      let err: { message: string; code?: string } | null;
      try {
        err = await send(op);
      } catch (e) {
        err = { message: (e as Error).message };
      }
      if (err && isNetworkError(err)) break;
      ops = err ? ops.map((o) => (o.id === op.id ? { ...o, error: err!.message } : o)) : ops.filter((o) => o.id !== op.id);
      await save();
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

export async function retryFailed() {
  ops = ops.map((o) => ({ ...o, error: undefined }));
  await save();
  await flush();
}

export async function discardFailed() {
  ops = ops.filter((o) => !o.error);
  await save();
}

// Sincronització automàtica: en recuperar la connexió i periòdicament
let started = false;
export function startAutoSync() {
  if (started || typeof window === 'undefined') return;
  started = true;
  void load().then(() => flush());
  window.addEventListener('online', () => void flush());
  window.setInterval(() => {
    if (ops.some((o) => !o.error)) void flush();
  }, 20000);
}
