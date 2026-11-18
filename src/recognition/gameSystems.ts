// =====================================================================
// Sistemes de joc (reconeixement de jugades, fase 0.1)
//
// Un sistema de joc és un patró de rols en l'ordre de servei (posicions
// I→VI) quan el col·locador "de referència" és a la posició I:
//
//   51   5-1   S-OH-MB-OPP-OH-MB  (+ L)
//   51m  5-1   S-MB-OH-OPP-MB-OH  (+ L)
//   62   6-2   S-OH-MB-S-OH-MB    (+ L)  col·loca el col·locador de la zaga
//   42   4-2   S-OH-MB-S-OH-MB    (+ L)  col·loca el col·locador de la davantera
//
// Cada jugador de la formació ocupa una "casella" (slot 0..5) del patró.
// La casella es manté amb els canvis (el suplent hereta el rol del titular)
// i el líbero substitueix el central de la zaga.
//
// Rotacions P1..P6: posició (I..VI) del col·locador de referència (slot 0),
// com fa DataVolley.
// =====================================================================

import type { PlayerPosition } from '../lib/types';

export type SystemCode = '51' | '51m' | '62' | '42';
export const SYSTEM_CODES: SystemCode[] = ['51', '51m', '62', '42'];

export type Role = 'S' | 'OH' | 'MB' | 'OPP';

// Etiqueta única de cada casella dins el patró (per a la recepció i la notació)
export type SlotLabel = 'S' | 'S1' | 'S2' | 'OPP' | 'OH1' | 'OH2' | 'MB1' | 'MB2';
export type SpotLabel = SlotLabel | 'L';

export interface GameSystem {
  code: SystemCode;
  name: string; // 5-1, 6-2, 4-2
  roles: Role[]; // slot 0..5
  labels: SlotLabel[]; // slot 0..5
  // Qui col·loca quan hi ha dos col·locadors
  setter: 'single' | 'back' | 'front';
}

export const SYSTEMS: Record<SystemCode, GameSystem> = {
  '51': {
    code: '51',
    name: '5-1',
    roles: ['S', 'OH', 'MB', 'OPP', 'OH', 'MB'],
    labels: ['S', 'OH1', 'MB1', 'OPP', 'OH2', 'MB2'],
    setter: 'single',
  },
  '51m': {
    code: '51m',
    name: '5-1',
    roles: ['S', 'MB', 'OH', 'OPP', 'MB', 'OH'],
    labels: ['S', 'MB1', 'OH1', 'OPP', 'MB2', 'OH2'],
    setter: 'single',
  },
  '62': {
    code: '62',
    name: '6-2',
    roles: ['S', 'OH', 'MB', 'S', 'OH', 'MB'],
    labels: ['S1', 'OH1', 'MB1', 'S2', 'OH2', 'MB2'],
    setter: 'back',
  },
  '42': {
    code: '42',
    name: '4-2',
    roles: ['S', 'OH', 'MB', 'S', 'OH', 'MB'],
    labels: ['S1', 'OH1', 'MB1', 'S2', 'OH2', 'MB2'],
    setter: 'front',
  },
};

export function isSystemCode(v: unknown): v is SystemCode {
  return typeof v === 'string' && (SYSTEM_CODES as string[]).includes(v);
}

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const BACK = new Set([0, 4, 5]); // I, V, VI

export function isBackRow(posIndex: number): boolean {
  return BACK.has(posIndex);
}

// Configuració del sistema d'un equip en un set: el codi i la posició
// (índex 0..5 de la formació inicial) on és el col·locador de referència.
export interface TeamSystem {
  code: SystemCode;
  anchor: number; // índex 0..5 a la formació inicial del set
}

// Rotació (1..6) a partir de quantes vegades ha rotat l'equip des de la formació inicial
export function rotationOf(sys: TeamSystem, rotations: number): number {
  return (((sys.anchor - rotations) % 6) + 6) % 6 + 1;
}

// Casella (slot) que ocupa cada posició I..VI en una rotació P1..P6.
// A Pk, el slot 0 és a la posició k.
export function slotsAt(rotation: number): number[] {
  const p = rotation - 1;
  return [0, 1, 2, 3, 4, 5].map((pos) => (((pos - p) % 6) + 6) % 6);
}

// Posició (índex 0..5) d'un slot en una rotació
export function positionOfSlot(slot: number, rotation: number): number {
  return (slot + rotation - 1) % 6;
}

export interface RotationInfo {
  rotation: number;
  // Per a cada posició I..VI, el slot i el rol
  slots: number[];
  roles: Role[];
  labels: SlotLabel[];
  setterSlot: number; // qui col·loca en aquesta rotació
  setterPosition: number;
  // Central de la zaga, que substitueix el líbero (null si no n'hi ha cap)
  liberoSlot: number | null;
}

export function rotationInfo(code: SystemCode, rotation: number): RotationInfo {
  const sys = SYSTEMS[code];
  const slots = slotsAt(rotation);
  const roles = slots.map((s) => sys.roles[s]);
  const labels = slots.map((s) => sys.labels[s]);
  let setterSlot = 0;
  if (sys.setter !== 'single') {
    const back = isBackRow(positionOfSlot(0, rotation));
    setterSlot = (sys.setter === 'back') === back ? 0 : 3;
  }
  const mbBack = [0, 1, 2, 3, 4, 5].find((pos) => isBackRow(pos) && roles[pos] === 'MB');
  return {
    rotation,
    slots,
    roles,
    labels,
    setterSlot,
    setterPosition: positionOfSlot(setterSlot, rotation),
    liberoSlot: mbBack === undefined ? null : slots[mbBack],
  };
}

// ---------------------------------------------------------------------
// Deducció del sistema a partir de la formació i les posicions de la plantilla
// ---------------------------------------------------------------------
export interface InferResult {
  // Sistema proposat (null si no es pot deduir)
  system: TeamSystem | null;
  // Altres sistemes compatibles (p. ex. 62 i 42 només es distingeixen preguntant)
  alternatives: SystemCode[];
  // Jugadors la posició dels quals no coincideix amb el rol del patró
  mismatches: { position: number; player: number; expected: Role; actual: PlayerPosition }[];
  reason: 'ok' | 'ambiguous' | 'no_setter' | 'too_many_setters' | 'unknown_order';
}

const FLEX: PlayerPosition[] = ['UNI', 'U'];

function compatible(actual: PlayerPosition | undefined, expected: Role): boolean {
  if (!actual || FLEX.includes(actual)) return true;
  return actual === expected;
}

export function mismatchesFor(
  sys: TeamSystem,
  lineup: number[],
  positionOf: (player: number) => PlayerPosition | undefined,
): InferResult['mismatches'] {
  const roles = SYSTEMS[sys.code].roles;
  const out: InferResult['mismatches'] = [];
  for (let k = 0; k < 6; k++) {
    const pos = (sys.anchor + k) % 6;
    const player = lineup[pos];
    const actual = positionOf(player);
    if (!compatible(actual, roles[k])) out.push({ position: pos, player, expected: roles[k], actual: actual! });
  }
  return out;
}

export function inferSystem(
  lineup: number[],
  positionOf: (player: number) => PlayerPosition | undefined,
): InferResult {
  const setters = [0, 1, 2, 3, 4, 5].filter((i) => positionOf(lineup[i]) === 'S');
  const result = (code: SystemCode, anchor: number, reason: InferResult['reason'], alternatives: SystemCode[] = []): InferResult => {
    const system = { code, anchor };
    return { system, alternatives, mismatches: mismatchesFor(system, lineup, positionOf), reason };
  };

  if (setters.length === 1) {
    const s = setters[0];
    const next = positionOf(lineup[(s + 1) % 6]);
    if (next === 'MB') return result('51m', s, 'ok');
    if (next === 'OH') return result('51', s, 'ok');
    // Ordre no reconegut: es mira la casella de darrere del col·locador
    const prev = positionOf(lineup[(s + 5) % 6]);
    if (prev === 'OH') return result('51m', s, 'ok');
    if (prev === 'MB') return result('51', s, 'ok');
    return result('51', s, 'unknown_order', ['51m']);
  }
  if (setters.length === 2) {
    const [a, b] = setters;
    if ((b - a) % 6 === 3) return result('62', a, 'ambiguous', ['42']);
    return { system: null, alternatives: [], mismatches: [], reason: 'unknown_order' };
  }
  return {
    system: null,
    alternatives: [],
    mismatches: [],
    reason: setters.length === 0 ? 'no_setter' : 'too_many_setters',
  };
}

// Jugador (dorsal) de cada slot segons la formació inicial del set
export function playersBySlot(sys: TeamSystem, lineup: number[]): number[] {
  return [0, 1, 2, 3, 4, 5].map((k) => lineup[(sys.anchor + k) % 6]);
}
