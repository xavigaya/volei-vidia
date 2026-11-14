// =====================================================================
// Calibració del vídeo (reconeixement de jugades, etapa 1.1)
//
// Sobre un fotograma es marquen:
//   * les 4 cantonades de la pista (en ordre respecte a la càmera),
//   * els dos extrems de la cinta superior de la xarxa,
//   * la part superior de les dues antenes.
//
// Coordenades "de càmera" de la pista (metres), independents de qui juga a
// cada costat:
//   u: 0..9   d'esquerra a dreta vist des de la càmera
//   v: 0..18  de la línia de fons propera a la càmera (0) a la llunyana (18)
//   z: alçada sobre el terra (la xarxa és a v = 9)
//
// Amb les cantonades es calcula l'homografia del terra (imatge ⇄ pista).
// Amb la xarxa i les antenes (punts amb alçada) es calcula el model complet
// de la càmera (matriu 3×4), que permet saber l'alçada de la pilota.
// =====================================================================

import type { Point2 } from '../engine/actions';

export type Side = 'H' | 'A';

// Punt de la imatge normalitzat (0..1 respecte a l'amplada i l'alçada del fotograma)
export interface ImgPt {
  x: number;
  y: number;
}

export type CalPointKey = 'nl' | 'nr' | 'fr' | 'fl' | 'netL' | 'netR' | 'antL' | 'antR';
export const CAL_POINTS: CalPointKey[] = ['nl', 'nr', 'fr', 'fl', 'netL', 'netR', 'antL', 'antR'];

export const ANTENNA_ABOVE_NET = 0.8; // m (les antenes sobresurten 80 cm de la xarxa)
export const NET_HEIGHTS = { M: 2.43, F: 2.24 } as const;

export interface Calibration {
  fromTime: number; // segons del vídeo a partir dels quals és vàlida
  width: number; // mida del fotograma (px)
  height: number;
  points: Partial<Record<CalPointKey, ImgPt>>;
  netHeight: number;
  // Equip al costat de la càmera a cada set (1..5)
  nearSide: Partial<Record<number, Side>>;
}

// Coordenades de càmera de cada punt de calibració (u, v, z)
export function worldOf(key: CalPointKey, netHeight: number): [number, number, number] {
  switch (key) {
    case 'nl':
      return [0, 0, 0];
    case 'nr':
      return [9, 0, 0];
    case 'fr':
      return [9, 18, 0];
    case 'fl':
      return [0, 18, 0];
    case 'netL':
      return [0, 9, netHeight];
    case 'netR':
      return [9, 9, netHeight];
    case 'antL':
      return [0, 9, netHeight + ANTENNA_ABOVE_NET];
    case 'antR':
      return [9, 9, netHeight + ANTENNA_ABOVE_NET];
  }
}

// ---------------------------------------------------------------------
// Àlgebra lineal mínima
// ---------------------------------------------------------------------
export type Mat3 = number[]; // 9 valors, per files
export type Mat34 = number[]; // 12 valors, per files

// Sistema lineal A·x = b (eliminació gaussiana amb pivotatge parcial)
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

// Vector propi del valor propi més petit d'una matriu simètrica (mètode de Jacobi)
function smallestEigenvector(S: number[][]): number[] {
  const n = S.length;
  const A = S.map((r) => [...r]);
  const V: number[][] = A.map((_, i) => A.map((__, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-30) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const tt = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(tt * tt + 1);
        const s = tt * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let min = 0;
  for (let i = 1; i < n; i++) if (A[i][i] < A[min][min]) min = i;
  return V.map((row) => row[min]);
}

export function applyH(H: Mat3, x: number, y: number): [number, number] {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

export function invert3(H: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}

// Homografia que porta 4 punts src a 4 punts dst
export function homography(src: [number, number][], dst: [number, number][]): Mat3 | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [X, Y] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }
  const h = solveLinear(A, b);
  return h ? [...h, 1] : null;
}

export function project(P: Mat34, X: number, Y: number, Z: number): [number, number] {
  const w = P[8] * X + P[9] * Y + P[10] * Z + P[11];
  return [(P[0] * X + P[1] * Y + P[2] * Z + P[3]) / w, (P[4] * X + P[5] * Y + P[6] * Z + P[7]) / w];
}

// Matriu de càmera (DLT) a partir de 6 o més correspondències no coplanàries
export function cameraDLT(world: [number, number, number][], img: [number, number][]): Mat34 | null {
  if (world.length < 6) return null;
  // Normalització de les coordenades d'imatge per estabilitat numèrica
  const cx = img.reduce((s, p) => s + p[0], 0) / img.length;
  const cy = img.reduce((s, p) => s + p[1], 0) / img.length;
  const sc = Math.sqrt(2) / (img.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / img.length || 1);
  const rows: number[][] = [];
  world.forEach(([X, Y, Z], i) => {
    const x = (img[i][0] - cx) * sc;
    const y = (img[i][1] - cy) * sc;
    rows.push([X, Y, Z, 1, 0, 0, 0, 0, -x * X, -x * Y, -x * Z, -x]);
    rows.push([0, 0, 0, 0, X, Y, Z, 1, -y * X, -y * Y, -y * Z, -y]);
  });
  const S = Array.from({ length: 12 }, (_, i) => Array.from({ length: 12 }, (__, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)));
  const p = smallestEigenvector(S);
  // Desfer la normalització: P = T⁻¹ · Pn
  const inv = 1 / sc;
  const out = new Array<number>(12);
  for (let k = 0; k < 4; k++) {
    out[k] = inv * p[k] + cx * p[8 + k];
    out[4 + k] = inv * p[4 + k] + cy * p[8 + k];
    out[8 + k] = p[8 + k];
  }
  return out;
}

// ---------------------------------------------------------------------
// Resultat de la calibració
// ---------------------------------------------------------------------
export interface CalibrationModel {
  // Homografia terra → imatge (px) i inversa
  ground: Mat3 | null;
  groundInv: Mat3 | null;
  // Càmera completa (amb alçades), si hi ha xarxa o antenes
  camera: Mat34 | null;
  // Error mitjà de reprojecció de la càmera (px) i per punt
  rmse: number | null;
  errors: Partial<Record<CalPointKey, number>>;
}

const px = (c: Calibration, p: ImgPt): [number, number] => [p.x * c.width, p.y * c.height];

export function solveCalibration(c: Calibration): CalibrationModel {
  const pts = c.points;
  const corners = (['nl', 'nr', 'fr', 'fl'] as CalPointKey[]).map((k) => pts[k]);
  let ground: Mat3 | null = null;
  if (corners.every(Boolean)) {
    ground = homography(
      (['nl', 'nr', 'fr', 'fl'] as CalPointKey[]).map((k) => worldOf(k, c.netHeight).slice(0, 2) as [number, number]),
      corners.map((p) => px(c, p!)),
    );
  }
  const keys = CAL_POINTS.filter((k) => pts[k]);
  let camera: Mat34 | null = null;
  let rmse: number | null = null;
  const errors: CalibrationModel['errors'] = {};
  const hasHeight = keys.some((k) => worldOf(k, c.netHeight)[2] > 0);
  if (keys.length >= 6 && hasHeight) {
    camera = cameraDLT(
      keys.map((k) => worldOf(k, c.netHeight)),
      keys.map((k) => px(c, pts[k]!)),
    );
    if (camera) {
      let sum = 0;
      for (const k of keys) {
        const [X, Y, Z] = worldOf(k, c.netHeight);
        const [x, y] = project(camera, X, Y, Z);
        const [ix, iy] = px(c, pts[k]!);
        errors[k] = Math.hypot(x - ix, y - iy);
        sum += errors[k]! ** 2;
      }
      rmse = Math.sqrt(sum / keys.length);
    }
  }
  return { ground, groundInv: ground ? invert3(ground) : null, camera, rmse, errors };
}

// Qualitat orientativa segons l'error de reprojecció (px en un fotograma 1080p)
export function quality(rmse: number | null, height: number): 'good' | 'fair' | 'poor' | null {
  if (rmse == null) return null;
  const e = (rmse * 1080) / (height || 1080);
  return e < 4 ? 'good' : e < 10 ? 'fair' : 'poor';
}

// Punt de la imatge (px) → pista (u, v) en metres, sobre el terra
export function imageToCourt(m: CalibrationModel, x: number, y: number): { u: number; v: number } | null {
  if (!m.groundInv) return null;
  const [u, v] = applyH(m.groundInv, x, y);
  return Number.isFinite(u) && Number.isFinite(v) ? { u, v } : null;
}

// ---------------------------------------------------------------------
// Costat de cada equip i coordenades de l'app (Point2: x 0..18 amb el
// local a l'esquerra i la xarxa a x = 9; y 0..9)
// ---------------------------------------------------------------------
export function cameraToApp(u: number, v: number, near: Side): Point2 {
  return near === 'H' ? { x: v, y: u } : { x: 18 - v, y: 9 - u };
}

export function appToCamera(p: Point2, near: Side): { u: number; v: number } {
  return near === 'H' ? { u: p.y, v: p.x } : { u: 9 - p.y, v: 18 - p.x };
}

// Costat per defecte de cada set: es canvia de camp a cada set. Al set
// decisiu el costat es decideix per sorteig (i es canvia a 8 punts): es
// proposa el contrari del set anterior.
export function defaultNearSides(first: Side, sets: number): Record<number, Side> {
  const out: Record<number, Side> = {};
  for (let s = 1; s <= sets; s++) out[s] = s % 2 === 1 ? first : first === 'H' ? 'A' : 'H';
  return out;
}

// Línies de la pista en coordenades de càmera (u, v) per dibuixar-les
export function courtSegments(): { a: [number, number]; b: [number, number]; kind: 'line' | 'attack' | 'center' }[] {
  return [
    { a: [0, 0], b: [9, 0], kind: 'line' },
    { a: [9, 0], b: [9, 18], kind: 'line' },
    { a: [9, 18], b: [0, 18], kind: 'line' },
    { a: [0, 18], b: [0, 0], kind: 'line' },
    { a: [0, 9], b: [9, 9], kind: 'center' },
    { a: [0, 6], b: [9, 6], kind: 'attack' },
    { a: [0, 12], b: [9, 12], kind: 'attack' },
  ];
}

// Calibració que s'aplica en un instant del vídeo (la darrera que comença abans)
export function calibrationAt(list: Calibration[], time: number): Calibration | null {
  const sorted = [...list].sort((a, b) => a.fromTime - b.fromTime);
  let cur: Calibration | null = sorted[0] ?? null;
  for (const c of sorted) if (c.fromTime <= time) cur = c;
  return cur;
}
