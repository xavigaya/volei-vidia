// =====================================================================
// Sistemes de recepció (reconeixement de jugades, fase 0.1)
//
// Coordenades d'un jugador dins el seu mig camp, des del punt de vista
// de l'equip (mirant la xarxa):
//   l: 0..9 m d'esquerra a dreta
//   d: 0..9 m de la xarxa (0) a la línia de fons (9); fins a 10 per fora
//
// Plantilles:
//   R2  2 receptors (OH1 + OH2)
//   R3  3 receptors (L + OH1 + OH2)
//   R4  4 receptors (R3 + OPP, o el col·locador que no col·loca en 6-2/4-2)
//   R5  5 receptors (tots menys el col·locador), en W
//
// Notació de text (una rotació per línia, o separades per ';'):
//   P1: S@1x MB1@4x OPP@2x OH1@7* L@8* OH2@9*
// rol@zona (zones 1..9 de l'app), "x" = enganxat a la xarxa (vora davantera
// de la zona), "f" = al fons (vora posterior), "*" = receptor.
// =====================================================================

import {
  ROMAN,
  SYSTEMS,
  isBackRow,
  rotationInfo,
  type RotationInfo,
  type SpotLabel,
  type SystemCode,
} from './gameSystems';

export type TemplateCode = 'R2' | 'R3' | 'R4' | 'R5';
export const TEMPLATE_CODES: TemplateCode[] = ['R2', 'R3', 'R4', 'R5'];

export interface Spot {
  l: number;
  d: number;
}

// Recepció d'una rotació: on és cada jugador (per etiqueta) i qui rep
export interface RotationReception {
  spots: Partial<Record<SpotLabel, Spot>>;
  receivers: SpotLabel[];
}

// Sistema de recepció d'un equip per a un sistema de joc
export interface ReceptionSystem {
  system: SystemCode;
  template: TemplateCode;
  hasLibero: boolean;
  // Només les rotacions modificades; la resta surt de la plantilla
  rotations: Partial<Record<number, RotationReception>>;
}

export const NET_D = 0;
export const COURT = 9;

export function isTemplateCode(v: unknown): v is TemplateCode {
  return typeof v === 'string' && (TEMPLATE_CODES as string[]).includes(v);
}

// ---------------------------------------------------------------------
// Qui és al camp en recepció (per posició I..VI)
// ---------------------------------------------------------------------
export interface CourtPlayer {
  position: number; // 0..5 = I..VI
  label: SpotLabel; // etiqueta del rol (L si el líbero hi substitueix el central)
  slot: number;
}

export function receivingCourt(code: SystemCode, rotation: number, hasLibero: boolean): CourtPlayer[] {
  const info = rotationInfo(code, rotation);
  return info.slots.map((slot, position) => ({
    position,
    slot,
    label: hasLibero && slot === info.liberoSlot ? 'L' : info.labels[position],
  }));
}

function receiversFor(template: TemplateCode, info: RotationInfo, court: CourtPlayer[]): SpotLabel[] {
  const setterLabel = info.labels[info.setterPosition];
  const byRole = (pred: (cp: CourtPlayer, role: string) => boolean) =>
    court.filter((cp) => pred(cp, info.roles[cp.position])).map((cp) => cp.label);
  const ohs = byRole((_, r) => r === 'OH');
  const backMbOrL = court.filter((cp) => cp.label === 'L' || (isBackRow(cp.position) && info.roles[cp.position] === 'MB')).map((cp) => cp.label);
  switch (template) {
    case 'R2':
      return ohs;
    case 'R3':
      return [...ohs, ...backMbOrL.slice(0, 1)];
    case 'R4': {
      // + OPP (5-1) o el col·locador que no col·loca (6-2 / 4-2)
      const extra = court.find(
        (cp) => (info.roles[cp.position] === 'OPP' || info.roles[cp.position] === 'S') && cp.label !== setterLabel,
      );
      return [...ohs, ...backMbOrL.slice(0, 1), ...(extra ? [extra.label] : [])];
    }
    case 'R5':
      return court.map((cp) => cp.label).filter((l) => l !== setterLabel);
  }
}

// Posició "natural" de cada posició I..VI (centre de la seva zona)
const NATURAL: Spot[] = [
  { l: 7.5, d: 7.5 }, // I
  { l: 7.5, d: 1.5 }, // II
  { l: 4.5, d: 1.5 }, // III
  { l: 1.5, d: 1.5 }, // IV
  { l: 1.5, d: 7.5 }, // V
  { l: 4.5, d: 7.5 }, // VI
];

// Parelles de posicions que no es poden avançar (falta de posició en el servei)
// Davant/darrere: II-I, III-VI, IV-V. Esquerra/dreta: IV-III, III-II, V-VI, VI-I.
const FRONT_BACK: [number, number][] = [
  [1, 0],
  [2, 5],
  [3, 4],
];
const LEFT_RIGHT: [number, number][] = [
  [3, 2],
  [2, 1],
  [4, 5],
  [5, 0],
];

// Files per a l'ordre lateral (d'esquerra a dreta)
const LATERAL_ROWS: number[][] = [
  [3, 2, 1], // IV, III, II
  [4, 5, 0], // V, VI, I
];
const GAP = 0.6; // separació mínima lateral entre veïns de fila

// Ajust ordenat ponderat (regressió isotònica): valors el més a prop possible
// dels ideals però estrictament creixents (separats GAP) i dins el camp.
export function orderedFit(ideal: number[], weight: number[]): number[] {
  const shifted = ideal.map((v, i) => v - i * GAP);
  const blocks: { sum: number; w: number; n: number }[] = [];
  shifted.forEach((v, i) => {
    blocks.push({ sum: v * weight[i], w: weight[i], n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.w <= b.sum / b.w) break;
      blocks.splice(-2, 2, { sum: a.sum + b.sum, w: a.w + b.w, n: a.n + b.n });
    }
  });
  const out: number[] = [];
  for (const b of blocks) for (let j = 0; j < b.n; j++) out.push(b.sum / b.w);
  const fitted = out.map((v, i) => v + i * GAP);
  // Dins el camp (amb marge) mantenint l'ordre
  const lo = 0.3;
  const hi = COURT - 0.3;
  const shift = Math.max(0, lo - fitted[0]) - Math.max(0, fitted[fitted.length - 1] - hi);
  return fitted.map((v) => v + shift);
}

export interface OverlapViolation {
  kind: 'front_back' | 'left_right';
  a: number; // posició (0..5) que ha d'estar més a prop de la xarxa / més a l'esquerra
  b: number;
}

// Comprova la col·locació reglamentària en el moment del servei
export function checkOverlap(byPosition: Spot[]): OverlapViolation[] {
  const out: OverlapViolation[] = [];
  for (const [front, back] of FRONT_BACK) {
    if (!(byPosition[back].d > byPosition[front].d)) out.push({ kind: 'front_back', a: front, b: back });
  }
  for (const [left, right] of LEFT_RIGHT) {
    if (!(byPosition[left].l < byPosition[right].l)) out.push({ kind: 'left_right', a: left, b: right });
  }
  return out;
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  const out: T[][] = [];
  xs.forEach((x, i) => {
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) out.push([x, ...rest]);
  });
  return out;
}

const round = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------
// Plantilla: posicions calculades per a una rotació
// ---------------------------------------------------------------------
export function templateRotation(code: SystemCode, rotation: number, template: TemplateCode, hasLibero: boolean): RotationReception {
  const info = rotationInfo(code, rotation);
  const court = receivingCourt(code, rotation, hasLibero);
  const receivers = receiversFor(template, info, court);
  const isRec = court.map((cp) => receivers.includes(cp.label));
  const recPositions = court.filter((_, i) => isRec[i]).map((cp) => cp.position);
  const k = recPositions.length;
  const lanes = k <= 1 ? [4.5] : Array.from({ length: k }, (_, i) => 1.2 + (6.6 * i) / (k - 1));

  // Profunditat ideal de cada posició
  const depth = (pos: number): number => {
    const front = !isBackRow(pos);
    if (recPositions.includes(pos)) return template === 'R5' && front ? 4.5 : 6.5;
    if (front) return pos === info.setterPosition ? 0.8 : 1;
    return NATURAL[pos].d;
  };

  const build = (laneOf: Map<number, number>): { spots: Spot[]; cost: number } => {
    // Posició lateral ideal i pes (com més pes, menys es mou)
    const ideal = NATURAL.map((n, pos) => (laneOf.has(pos) ? laneOf.get(pos)! : n.l));
    const weight = NATURAL.map((_, pos) => (laneOf.has(pos) ? 3 : isBackRow(pos) ? 0.5 : 2));
    const lateral = [...ideal];
    for (const row of LATERAL_ROWS) {
      const fitted = orderedFit(
        row.map((p) => ideal[p]),
        row.map((p) => weight[p]),
      );
      row.forEach((p, i) => (lateral[p] = fitted[i]));
    }
    const spots: Spot[] = NATURAL.map((_, pos) => ({ l: lateral[pos], d: depth(pos) }));
    // Zaga: sempre més lluny de la xarxa que el company de davant
    for (const [front, back] of FRONT_BACK) {
      if (recPositions.includes(back)) spots[back].d = Math.max(spots[back].d, spots[front].d + 1.3);
      else spots[back].d = Math.min(COURT + 0.6, spots[front].d + 1.3); // amagat darrere del company
    }
    const cost = NATURAL.reduce((acc, _, pos) => acc + weight[pos] * Math.abs(lateral[pos] - ideal[pos]), 0)
      + recPositions.reduce((acc, pos) => acc + 0.2 * Math.abs(laneOf.get(pos)! - NATURAL[pos].l), 0);
    return { spots, cost };
  };

  let best: Spot[] | null = null;
  let bestCost = Infinity;
  for (const perm of permutations(lanes)) {
    const { spots, cost } = build(new Map(recPositions.map((pos, i) => [pos, perm[i]])));
    if (checkOverlap(spots).length) continue;
    if (cost < bestCost) {
      bestCost = cost;
      best = spots;
    }
  }
  // Sense cap distribució reglamentària: posicions naturals (sempre vàlides)
  if (!best) best = NATURAL.map((n) => ({ ...n }));

  const spots: Partial<Record<SpotLabel, Spot>> = {};
  court.forEach((cp) => {
    spots[cp.label] = { l: round(best![cp.position].l), d: round(best![cp.position].d) };
  });
  return { spots, receivers };
}

export function newReceptionSystem(code: SystemCode, template: TemplateCode = 'R3', hasLibero = true): ReceptionSystem {
  return { system: code, template, hasLibero, rotations: {} };
}

// Recepció efectiva d'una rotació (personalitzada o de la plantilla)
export function rotationReception(rs: ReceptionSystem, rotation: number): RotationReception {
  const custom = rs.rotations[rotation];
  const base = templateRotation(rs.system, rotation, rs.template, rs.hasLibero);
  if (!custom) return base;
  // Es completen les etiquetes que falten amb la plantilla
  return { spots: { ...base.spots, ...custom.spots }, receivers: [...custom.receivers] };
}

// Posicions per posició I..VI (per comprovar la col·locació)
export function spotsByPosition(rs: Pick<ReceptionSystem, 'system' | 'hasLibero'>, rotation: number, rec: RotationReception): Spot[] {
  const court = receivingCourt(rs.system, rotation, rs.hasLibero);
  return court.map((cp) => rec.spots[cp.label] ?? NATURAL[cp.position]);
}

// ---------------------------------------------------------------------
// Zones (1..9) ⇄ coordenades
// ---------------------------------------------------------------------
//          xarxa
//     ┌───┬───┬───┐
//     │ 4 │ 3 │ 2 │
//     ├───┼───┼───┤
//     │ 7 │ 8 │ 9 │
//     ├───┼───┼───┤
//     │ 5 │ 6 │ 1 │
//     └───┴───┴───┘
const ZONE_GRID = [
  [4, 3, 2],
  [7, 8, 9],
  [5, 6, 1],
];

export type ZoneMod = '' | 'x' | 'f';

export function spotOfZone(zone: number, mod: ZoneMod = ''): Spot | null {
  for (let row = 0; row < 3; row++) {
    const col = ZONE_GRID[row].indexOf(zone);
    if (col >= 0) {
      const d = mod === 'x' ? row * 3 + 0.5 : mod === 'f' ? row * 3 + 2.5 : row * 3 + 1.5;
      return { l: col * 3 + 1.5, d };
    }
  }
  return null;
}

export function zoneOfSpot(s: Spot): { zone: number; mod: ZoneMod } {
  const row = Math.min(2, Math.max(0, Math.floor(s.d / 3)));
  const col = Math.min(2, Math.max(0, Math.floor(s.l / 3)));
  const within = s.d - row * 3;
  const mod: ZoneMod = within < 1 ? 'x' : within > 2 ? 'f' : '';
  return { zone: ZONE_GRID[row][col], mod };
}

// ---------------------------------------------------------------------
// Notació de text
// ---------------------------------------------------------------------
const LABELS_51: SpotLabel[] = ['S', 'OPP', 'OH1', 'OH2', 'MB1', 'MB2', 'L'];
const LABELS_62: SpotLabel[] = ['S1', 'S2', 'OH1', 'OH2', 'MB1', 'MB2', 'L'];

export function labelsFor(code: SystemCode): SpotLabel[] {
  return SYSTEMS[code].labels.includes('S1') ? LABELS_62 : LABELS_51;
}

export function formatRotation(rotation: number, rec: RotationReception, order: SpotLabel[]): string {
  const parts = order
    .filter((label) => rec.spots[label])
    .map((label) => {
      const { zone, mod } = zoneOfSpot(rec.spots[label]!);
      return `${label}@${zone}${mod}${rec.receivers.includes(label) ? '*' : ''}`;
    });
  return `P${rotation}: ${parts.join(' ')}`;
}

export function formatReception(rs: ReceptionSystem, onlyCustom = false): string {
  const order = labelsFor(rs.system);
  const lines: string[] = [];
  for (let r = 1; r <= 6; r++) {
    if (onlyCustom && !rs.rotations[r]) continue;
    lines.push(formatRotation(r, rotationReception(rs, r), order));
  }
  return lines.join('\n');
}

export type ParseError =
  | { kind: 'syntax'; line: number; text: string }
  | { kind: 'rotation'; line: number; text: string }
  | { kind: 'label'; line: number; text: string }
  | { kind: 'zone'; line: number; text: string }
  | { kind: 'duplicate'; line: number; text: string };

export interface ParseResult {
  rotations: Partial<Record<number, RotationReception>>;
  errors: ParseError[];
}

const TOKEN = /^([A-Z]+[12]?)@([1-9])([xf]?)(\*?)$/i;

// Llegeix la notació de text. Accepta OH i MB sense número (s'assignen per ordre).
export function parseReception(text: string, code: SystemCode): ParseResult {
  const allowed = labelsFor(code);
  const rotations: ParseResult['rotations'] = {};
  const errors: ParseError[] = [];
  const lines = text
    .split(/[\n;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const m = /^P\s*([1-6])\s*:\s*(.*)$/i.exec(line);
    if (!m) {
      errors.push({ kind: /^P/i.test(line) ? 'rotation' : 'syntax', line: lineNo, text: line });
      return;
    }
    const rotation = Number(m[1]);
    const rec: RotationReception = { spots: {}, receivers: [] };
    for (const tok of m[2].split(/\s+/).filter(Boolean)) {
      const t = TOKEN.exec(tok);
      if (!t) {
        errors.push({ kind: 'syntax', line: lineNo, text: tok });
        continue;
      }
      let label = t[1].toUpperCase() as SpotLabel;
      if (label === ('OP' as SpotLabel)) label = 'OPP';
      if (label === ('OH' as SpotLabel) || label === ('MB' as SpotLabel) || label === ('S' as SpotLabel)) {
        const candidates = allowed.filter((l) => l.startsWith(label) && !rec.spots[l]);
        if (label === 'S' && allowed.includes('S')) label = 'S';
        else if (candidates.length) label = candidates[0];
      }
      if (!allowed.includes(label)) {
        errors.push({ kind: 'label', line: lineNo, text: tok });
        continue;
      }
      if (rec.spots[label]) {
        errors.push({ kind: 'duplicate', line: lineNo, text: tok });
        continue;
      }
      const spot = spotOfZone(Number(t[2]), t[3].toLowerCase() as ZoneMod);
      if (!spot) {
        errors.push({ kind: 'zone', line: lineNo, text: tok });
        continue;
      }
      rec.spots[label] = spot;
      if (t[4]) rec.receivers.push(label);
    }
    rotations[rotation] = rec;
  });
  return { rotations, errors };
}

export function romanOf(position: number): string {
  return ROMAN[position];
}
