// =====================================================================
// Intercanvi en JSON (anàlisi assistida): acta, sistema de recepció i
// sistema de joc. Cada fitxer porta "format" i "version" per poder-lo
// reconèixer i fer evolucionar el format sense trencar fitxers antics.
// =====================================================================

import { isSystemCode, type SpotLabel, type SystemCode } from './gameSystems';
import { isTemplateCode, labelsFor, parseReception, type ReceptionSystem, type RotationReception } from './reception';
import type { Scoresheet } from './scoresheet';

export const FORMATS = {
  scoresheet: 'volei-vidia/scoresheet',
  reception: 'volei-vidia/reception',
  systems: 'volei-vidia/game-systems',
} as const;

export function slug(...parts: (string | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .map((p) =>
      p!
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase(),
    )
    .join('_');
}

export function jsonBlob(data: unknown): Blob {
  return new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------
// Acta
// ---------------------------------------------------------------------
export function scoresheetToJson(sheet: Scoresheet, match?: { home: string; away: string; date?: string | null }) {
  // Només els sets amb alguna dada
  const sets = sheet.sets.filter(
    (s) =>
      s.firstServe != null ||
      s.final.h != null ||
      s.final.a != null ||
      s.start ||
      s.end ||
      [s.home, s.away].some((t) => t.serveLoss.length > 0 || t.lineup.some((n) => n != null)),
  );
  return { format: FORMATS.scoresheet, version: 1, match, sets, notes: sheet.notes ?? null };
}

// ---------------------------------------------------------------------
// Sistema de recepció
// ---------------------------------------------------------------------
export function receptionToJson(rs: ReceptionSystem, notation: string, team?: string) {
  return {
    format: FORMATS.reception,
    version: 1,
    team: team ?? null,
    system: rs.system,
    template: rs.template,
    hasLibero: rs.hasLibero,
    // Només les rotacions personalitzades; la resta surt de la plantilla
    rotations: rs.rotations,
    // Totes les rotacions en notació de text (per llegir-la o editar-la a mà)
    notation,
  };
}

export type ReceptionImport =
  | { ok: true; reception: ReceptionSystem; team: string | null }
  | { ok: false; error: 'json' | 'format' | 'system' | 'rotations' | 'notation'; detail?: string };

const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 10) / 10)) : null;

export function parseReceptionJson(text: string): ReceptionImport {
  const raw = parse(text) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'json' };
  if (raw.format != null && raw.format !== FORMATS.reception) return { ok: false, error: 'format' };
  if (!isSystemCode(raw.system)) return { ok: false, error: 'system' };
  const system: SystemCode = raw.system;
  const allowed = labelsFor(system);
  const rotations: ReceptionSystem['rotations'] = {};

  if (raw.rotations != null) {
    if (typeof raw.rotations !== 'object') return { ok: false, error: 'rotations' };
    for (const [key, value] of Object.entries(raw.rotations as Record<string, unknown>)) {
      const r = Number(key);
      const v = value as { spots?: Record<string, unknown>; receivers?: unknown };
      if (!Number.isInteger(r) || r < 1 || r > 6 || !v || typeof v.spots !== 'object') {
        return { ok: false, error: 'rotations', detail: key };
      }
      const rec: RotationReception = { spots: {}, receivers: [] };
      for (const [label, spot] of Object.entries(v.spots ?? {})) {
        const s = spot as { l?: unknown; d?: unknown };
        const l = num(s?.l, 0, 9);
        const d = num(s?.d, 0, 10);
        if (!allowed.includes(label as SpotLabel) || l == null || d == null) return { ok: false, error: 'rotations', detail: `P${r} ${label}` };
        rec.spots[label as SpotLabel] = { l, d };
      }
      if (Array.isArray(v.receivers)) {
        rec.receivers = v.receivers.filter((x): x is SpotLabel => allowed.includes(x as SpotLabel));
      }
      rotations[r] = rec;
    }
  } else if (typeof raw.notation === 'string') {
    // Sense coordenades: es llegeix la notació de text
    const res = parseReception(raw.notation, system);
    if (res.errors.length) return { ok: false, error: 'notation', detail: res.errors[0].text };
    Object.assign(rotations, res.rotations);
  }

  return {
    ok: true,
    team: typeof raw.team === 'string' ? raw.team : null,
    reception: {
      system,
      template: isTemplateCode(raw.template) ? raw.template : 'R3',
      hasLibero: raw.hasLibero !== false,
      rotations,
    },
  };
}

// ---------------------------------------------------------------------
// Sistema de joc (per partit, equip i set)
// ---------------------------------------------------------------------
export interface SystemEntry {
  set: number;
  side: 'H' | 'A';
  system: SystemCode;
  setter: number | null; // dorsal del col·locador de referència
  anchor: number; // posició (0..5 = I..VI) a la formació inicial
}

export function systemsToJson(entries: SystemEntry[], match?: { home: string; away: string; date?: string | null }) {
  return { format: FORMATS.systems, version: 1, match, systems: entries };
}

export type SystemsImport = { ok: true; systems: SystemEntry[] } | { ok: false; error: 'json' | 'format' | 'entries'; detail?: string };

export function parseSystemsJson(text: string): SystemsImport {
  const raw = parse(text) as { format?: unknown; systems?: unknown } | undefined;
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'json' };
  if (raw.format != null && raw.format !== FORMATS.systems) return { ok: false, error: 'format' };
  if (!Array.isArray(raw.systems)) return { ok: false, error: 'entries' };
  const out: SystemEntry[] = [];
  for (const [i, e] of (raw.systems as Record<string, unknown>[]).entries()) {
    const set = e?.set;
    const side = e?.side;
    const anchor = typeof e?.anchor === 'number' && Number.isInteger(e.anchor) && e.anchor >= 0 && e.anchor <= 5 ? e.anchor : 0;
    const setter = typeof e?.setter === 'number' && Number.isInteger(e.setter) ? e.setter : null;
    if (typeof set !== 'number' || !Number.isInteger(set) || set < 1 || set > 5 || (side !== 'H' && side !== 'A') || !isSystemCode(e.system)) {
      return { ok: false, error: 'entries', detail: String(i + 1) };
    }
    out.push({ set, side, system: e.system, setter, anchor });
  }
  return { ok: true, systems: out };
}

// Posició del col·locador a la formació: pel dorsal si hi és, si no la desada
export function anchorFor(entry: SystemEntry, lineup: number[]): number {
  if (entry.setter != null) {
    const i = lineup.indexOf(entry.setter);
    if (i >= 0) return i;
  }
  return entry.anchor;
}
