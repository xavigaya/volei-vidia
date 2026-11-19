// =====================================================================
// Revisió de les jugades detectades per vidia-vision (etapa 1.4)
//
// Les deteccions s'importen a l'app (només les jugades i els seus contactes,
// no les posicions de la pilota ni dels jugadors) i l'analista les revisa
// sobre el vídeo: confirma, descarta, ajusta l'inici i el final o n'afegeix
// les que l'eina no ha trobat. El resultat és alhora una referència per
// mesurar l'encert de l'eina i la base de la codificació assistida.
// =====================================================================

import type { Side } from '../engine/match';
import type { Skill } from '../engine/actions';
import type { Rally as ActaRally } from './scoresheet';

export interface DetContact {
  t: number;
  side: Side | 'near' | 'far' | null;
  audio: boolean;
  visual: boolean;
  score: number;
  u: number | null;
  v: number | null;
}

export interface DetRally {
  id: number; // posició al fitxer importat
  set: number | null;
  start: number;
  end: number;
  whistle: boolean;
  aboveNet: number | null;
  contacts: DetContact[];
}

export interface Detections {
  format: 'volei-vidia/vision-detections';
  tool: { name: string; version: string } | null;
  video: { name: string; duration: number; fps: number; width: number; height: number } | null;
  importedAt: string;
  rallies: DetRally[];
}

export type RallyStatus = 'pending' | 'ok' | 'rejected';

export interface RallyReview {
  status: RallyStatus;
  start?: number; // ajustat per l'analista
  end?: number;
}

export interface AddedRally {
  id: string;
  set: number | null;
  start: number;
  end: number;
}

export interface ReviewState {
  rallies: Record<number, RallyReview>;
  added: AddedRally[];
}

export const emptyReview = (): ReviewState => ({ rallies: {}, added: [] });

// ---------------------------------------------------------------------
// Importació
// ---------------------------------------------------------------------
export type ImportError = 'json' | 'format' | 'no_rallies';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function importDetections(text: string): { ok: true; detections: Detections } | { ok: false; error: ImportError } {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'json' };
  }
  if (!raw || raw.format !== 'volei-vidia/vision-detections') return { ok: false, error: 'format' };
  const contacts = Array.isArray(raw.contacts) ? (raw.contacts as Record<string, unknown>[]) : [];
  const rallies: DetRally[] = [];
  (Array.isArray(raw.rallies) ? (raw.rallies as Record<string, unknown>[]) : []).forEach((r, id) => {
    const start = num(r.start);
    const end = num(r.end);
    if (start == null || end == null) return;
    const idx = Array.isArray(r.contacts) ? (r.contacts as unknown[]).filter((i): i is number => typeof i === 'number') : [];
    rallies.push({
      id,
      set: num(r.set),
      start: r3(start),
      end: r3(end),
      whistle: !!r.whistle,
      aboveNet: num(r.aboveNet),
      contacts: idx
        .map((i) => contacts[i])
        .filter(Boolean)
        .map((c) => ({
          t: r3(num(c.t) ?? 0),
          side: c.side === 'H' || c.side === 'A' || c.side === 'near' || c.side === 'far' ? (c.side as DetContact['side']) : null,
          audio: !!c.audio,
          visual: !!c.visual,
          score: Math.round((num(c.score) ?? 0) * 100) / 100,
          u: num(c.u) == null ? null : Math.round(num(c.u)! * 10) / 10,
          v: num(c.v) == null ? null : Math.round(num(c.v)! * 10) / 10,
        })),
    });
  });
  if (!rallies.length) return { ok: false, error: 'no_rallies' };
  const v = raw.video as Record<string, unknown> | undefined;
  const tool = raw.tool as Record<string, unknown> | undefined;
  return {
    ok: true,
    detections: {
      format: 'volei-vidia/vision-detections',
      tool: tool ? { name: String(tool.name ?? ''), version: String(tool.version ?? '') } : null,
      video: v
        ? { name: String(v.name ?? ''), duration: num(v.duration) ?? 0, fps: num(v.fps) ?? 0, width: num(v.width) ?? 0, height: num(v.height) ?? 0 }
        : null,
      importedAt: new Date().toISOString(),
      rallies: rallies.sort((a, b) => a.start - b.start),
    },
  };
}

// ---------------------------------------------------------------------
// Llista de treball: jugades detectades (amb l'estat de revisió) i afegides
// ---------------------------------------------------------------------
export interface WorkRally {
  key: string; // "d12" (detectada) o "a<id>" (afegida)
  detected: DetRally | null;
  set: number | null;
  start: number;
  end: number;
  status: RallyStatus;
  adjusted: boolean;
  // Posició dins el set entre les jugades no descartades, i punt de l'acta corresponent
  index: number | null;
  acta: ActaRally | null;
}

export function workList(det: Detections | null, review: ReviewState, acta: Record<number, ActaRally[]> = {}): WorkRally[] {
  const list: WorkRally[] = [];
  for (const r of det?.rallies ?? []) {
    const rv = review.rallies[r.id];
    list.push({
      key: `d${r.id}`,
      detected: r,
      set: r.set,
      start: rv?.start ?? r.start,
      end: rv?.end ?? r.end,
      status: rv?.status ?? 'pending',
      adjusted: rv?.start != null || rv?.end != null,
      index: null,
      acta: null,
    });
  }
  for (const a of review.added) {
    list.push({ key: `a${a.id}`, detected: null, set: a.set, start: a.start, end: a.end, status: 'ok', adjusted: false, index: null, acta: null });
  }
  list.sort((a, b) => a.start - b.start);
  const counter = new Map<number, number>();
  for (const w of list) {
    if (w.status === 'rejected' || w.set == null) continue;
    const i = counter.get(w.set) ?? 0;
    counter.set(w.set, i + 1);
    w.index = i;
    w.acta = acta[w.set]?.[i] ?? null;
  }
  return list;
}

// Set d'una jugada afegida: el de la jugada anterior (o la següent) en el temps
export function setAt(list: WorkRally[], t: number): number | null {
  let prev: WorkRally | null = null;
  let next: WorkRally | null = null;
  for (const w of list) {
    if (w.set == null) continue;
    if (w.start <= t) prev = w;
    else if (!next) next = w;
  }
  return prev?.set ?? next?.set ?? null;
}

// ---------------------------------------------------------------------
// Proposta de fonament per a cada contacte (només orientativa)
// ---------------------------------------------------------------------
export function guessSkills(contacts: DetContact[], serving: Side | null): (Skill | null)[] {
  const out: (Skill | null)[] = [];
  let lastSide: string | null = null;
  let touch = 0;
  let prevSkill: Skill | null = null;
  contacts.forEach((c, i) => {
    const side = c.side;
    if (i === 0) {
      out.push('S');
      lastSide = side ?? serving;
      prevSkill = 'S';
      touch = 0;
      return;
    }
    const changed = side != null && lastSide != null && side !== lastSide;
    if (changed) {
      // Bloqueig: contacte de l'altre equip just després d'un atac
      if (prevSkill === 'A' && c.t - contacts[i - 1].t < 0.35) {
        out.push('B');
        prevSkill = 'B';
        lastSide = side;
        touch = 0; // el bloqueig no compta com a toc
        return;
      }
      touch = 1;
      lastSide = side;
    } else {
      touch += 1;
    }
    let s: Skill | null;
    if (touch === 1) s = prevSkill === 'S' ? 'R' : 'D';
    else if (touch === 2) s = 'E';
    else if (touch === 3) s = 'A';
    else s = null;
    out.push(s);
    prevSkill = s;
  });
  return out;
}

// ---------------------------------------------------------------------
// Resum i exportació (referència per mesurar l'eina)
// ---------------------------------------------------------------------
export interface ReviewSummary {
  detected: number;
  ok: number;
  rejected: number;
  pending: number;
  added: number;
  adjusted: number;
  // Percentatges sobre les revisades: encert (confirmades/revisades) i jugades reals trobades
  precision: number | null;
  recall: number | null;
}

export function summarize(list: WorkRally[]): ReviewSummary {
  const det = list.filter((w) => w.detected);
  const ok = det.filter((w) => w.status === 'ok').length;
  const rejected = det.filter((w) => w.status === 'rejected').length;
  const added = list.filter((w) => !w.detected).length;
  const reviewed = ok + rejected;
  return {
    detected: det.length,
    ok,
    rejected,
    pending: det.length - reviewed,
    added,
    adjusted: det.filter((w) => w.adjusted).length,
    precision: reviewed ? ok / reviewed : null,
    recall: ok + added ? ok / (ok + added) : null,
  };
}

export function reviewToJson(det: Detections | null, list: WorkRally[], match: { home: string; away: string; date?: string | null }) {
  return {
    format: 'volei-vidia/rally-review',
    version: 1,
    match,
    tool: det?.tool ?? null,
    video: det?.video ?? null,
    summary: summarize(list),
    rallies: list.map((w) => ({
      source: w.detected ? 'detected' : 'added',
      detectedId: w.detected?.id ?? null,
      set: w.set,
      index: w.index,
      status: w.status,
      start: w.start,
      end: w.end,
      detectedStart: w.detected?.start ?? null,
      detectedEnd: w.detected?.end ?? null,
      contacts: w.detected?.contacts.length ?? 0,
    })),
  };
}
