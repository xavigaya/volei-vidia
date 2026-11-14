import { describe, expect, it } from 'vitest';
import {
  appToCamera,
  CAL_POINTS,
  calibrationAt,
  cameraToApp,
  defaultNearSides,
  imageToCourt,
  project,
  quality,
  solveCalibration,
  worldOf,
  type Calibration,
  type Mat34,
} from './calibration';
import { zoneAt } from '../engine/actions';

// Càmera sintètica darrere la línia de fons propera, elevada, mirant cap a la pista
function syntheticCamera(): Mat34 {
  const f = 1400;
  const [cx, cy] = [960, 540];
  const C = [4.5, -7, 5.5]; // posició (u, v, z)
  const target = [4.5, 9, 0.5];
  const fwd = target.map((t, i) => t - C[i]);
  const n = Math.hypot(...fwd);
  const zc = fwd.map((v) => v / n); // eix òptic
  const up = [0, 0, 1];
  // x de la càmera = zc × up (cap a la dreta de la imatge), y = zc × x (cap avall)
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let xc = cross(zc, up);
  const nx = Math.hypot(...xc);
  xc = xc.map((v) => v / nx);
  const yc = cross(zc, xc);
  const R = [xc, yc, zc];
  const t = R.map((r) => -(r[0] * C[0] + r[1] * C[1] + r[2] * C[2]));
  const K = [
    [f, 0, cx],
    [0, f, cy],
    [0, 0, 1],
  ];
  const Rt = R.map((r, i) => [...r, t[i]]);
  const P: number[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) P.push(K[i][0] * Rt[0][j] + K[i][1] * Rt[1][j] + K[i][2] * Rt[2][j]);
  return P;
}

function calibrationFrom(P: Mat34, noise = 0): Calibration {
  const points: Calibration['points'] = {};
  let k = 0;
  for (const key of CAL_POINTS) {
    const [X, Y, Z] = worldOf(key, 2.43);
    const [x, y] = project(P, X, Y, Z);
    const e = noise ? Math.sin(++k * 12.9898) * noise : 0;
    points[key] = { x: (x + e) / 1920, y: (y - e) / 1080 };
  }
  return { fromTime: 0, width: 1920, height: 1080, points, netHeight: 2.43, nearSide: { 1: 'H' } };
}

describe('calibració', () => {
  const P = syntheticCamera();

  it('la càmera sintètica veu la pista dins el fotograma, la línia llunyana més amunt', () => {
    const near = project(P, 4.5, 0, 0);
    const far = project(P, 4.5, 18, 0);
    expect(near[1]).toBeGreaterThan(far[1]);
    for (const k of CAL_POINTS) {
      const [X, Y, Z] = worldOf(k, 2.43);
      const [x, y] = project(P, X, Y, Z);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1920);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(1080);
    }
  });

  it('recupera l\'homografia del terra i el model de càmera', () => {
    const m = solveCalibration(calibrationFrom(P));
    expect(m.ground).not.toBeNull();
    expect(m.camera).not.toBeNull();
    expect(m.rmse!).toBeLessThan(0.01);
    // Un punt qualsevol del terra (zona 6 del camp proper) es transforma bé
    const [x, y] = project(P, 3.2, 7.4, 0);
    const back = imageToCourt(m, x, y)!;
    expect(back.u).toBeCloseTo(3.2, 3);
    expect(back.v).toBeCloseTo(7.4, 3);
    // I la càmera reproduïda projecta igual un punt a 3 m d'alçada (pilota)
    const a = project(P, 6, 12, 3);
    const b = project(m.camera!, 6, 12, 3);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(0.05);
    expect(quality(m.rmse, 1080)).toBe('good');
  });

  it('amb errors de marcatge de pocs píxels la qualitat continua sent acceptable', () => {
    const m = solveCalibration(calibrationFrom(P, 3));
    expect(m.rmse!).toBeGreaterThan(0.1);
    expect(['good', 'fair']).toContain(quality(m.rmse, 1080));
  });

  it('sense xarxa ni antenes només hi ha homografia', () => {
    const c = calibrationFrom(P);
    for (const k of ['netL', 'netR', 'antL', 'antR'] as const) delete c.points[k];
    const m = solveCalibration(c);
    expect(m.ground).not.toBeNull();
    expect(m.camera).toBeNull();
  });

  it('coordenades de l\'app segons l\'equip que és al costat de la càmera', () => {
    // Local a prop: el seu fons és v = 0; la seva esquerra és l'esquerra de la càmera
    expect(cameraToApp(0.5, 1, 'H')).toEqual({ x: 1, y: 0.5 });
    expect(zoneAt(cameraToApp(1.5, 1.5, 'H'))).toEqual({ half: 'H', zone: 5 });
    // Visitant a prop: també la seva zona 5 és a l'esquerra de la càmera, al fons proper
    expect(zoneAt(cameraToApp(1.5, 1.5, 'A'))).toEqual({ half: 'A', zone: 5 });
    // L'equip llunyà té la zona 1 a l'esquerra de la càmera, al fons llunyà
    expect(zoneAt(cameraToApp(1.5, 16.5, 'H'))).toEqual({ half: 'A', zone: 1 });
    expect(appToCamera(cameraToApp(2, 13, 'A'), 'A')).toEqual({ u: 2, v: 13 });
  });

  it('costats per defecte i calibració per trams', () => {
    expect(defaultNearSides('A', 5)).toEqual({ 1: 'A', 2: 'H', 3: 'A', 4: 'H', 5: 'A' });
    const a = { fromTime: 0 } as Calibration;
    const b = { fromTime: 1800 } as Calibration;
    expect(calibrationAt([b, a], 100)).toBe(a);
    expect(calibrationAt([a, b], 2000)).toBe(b);
  });
});
