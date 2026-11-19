import { describe, expect, it } from 'vitest';
import { emptyReview, guessSkills, importDetections, reviewToJson, setAt, summarize, workList, type DetContact } from './review';
import type { Rally } from './scoresheet';

const det = JSON.stringify({
  format: 'volei-vidia/vision-detections',
  tool: { name: 'vidia-vision', version: '0.2.2' },
  video: { name: 'p.mp4', duration: 600, fps: 30, width: 1920, height: 1080 },
  contacts: [
    { t: 10.0, side: 'H', audio: true, visual: true, score: 0.9, u: 4, v: -0.5 },
    { t: 11.2, side: 'A', audio: true, visual: false, score: 0.5, u: 3, v: 15 },
    { t: 40.0, side: 'A', audio: true, visual: true, score: 0.9, u: 4, v: 18.5 },
    { t: 41.0, side: 'H', audio: true, visual: true, score: 0.9, u: 2, v: 4 },
  ],
  rallies: [
    { set: 1, index: 1, start: 40.0, end: 41.0, contacts: [2, 3], whistle: true, aboveNet: 4 },
    { set: 1, index: 0, start: 10.0, end: 11.2, contacts: [0, 1], whistle: false, aboveNet: 7 },
    { start: 'x', end: 2 },
  ],
});

const acta: Record<number, Rally[]> = {
  1: [0, 1, 2].map((i) => ({ index: i, server: 'H', serverPlayer: 7, winner: i === 1 ? 'A' : 'H', before: { h: i, a: 0 }, after: { h: i + 1, a: 0 } })),
};

describe('revisió de jugades', () => {
  it('importa només jugades i contactes, ordenades per temps', () => {
    const r = importDetections(det);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.detections.rallies.map((x) => x.start)).toEqual([10, 40]);
    expect(r.detections.rallies[0].contacts).toHaveLength(2);
    expect(r.detections.tool?.version).toBe('0.2.2');
    expect(importDetections('{"format":"x"}')).toEqual({ ok: false, error: 'format' });
    expect(importDetections('nope')).toEqual({ ok: false, error: 'json' });
  });

  it('les jugades descartades no compten per lligar amb l\'acta; les afegides sí', () => {
    const r = importDetections(det);
    if (!r.ok) throw new Error();
    const review = emptyReview();
    review.rallies[1] = { status: 'rejected' }; // la del segon 10
    review.added.push({ id: 'x', set: 1, start: 20, end: 25 });
    const list = workList(r.detections, review, acta);
    expect(list.map((w) => [w.key, w.index, w.acta?.winner ?? null])).toEqual([
      ['d1', null, null],
      ['ax', 0, 'H'],
      ['d0', 1, 'A'],
    ]);
    expect(setAt(list, 30)).toBe(1);
    const s = summarize(list);
    expect(s).toMatchObject({ detected: 2, ok: 0, rejected: 1, pending: 1, added: 1, precision: 0, recall: 0 });
    const json = reviewToJson(r.detections, list, { home: 'L', away: 'V' });
    expect(json.format).toBe('volei-vidia/rally-review');
    expect(json.rallies[1]).toMatchObject({ source: 'added', status: 'ok', set: 1, index: 0 });
  });

  it('ajustar inici i final de la jugada', () => {
    const r = importDetections(det);
    if (!r.ok) throw new Error();
    const review = emptyReview();
    review.rallies[1] = { status: 'ok', start: 9.0, end: 14.0 };
    const list = workList(r.detections, review);
    expect(list[0]).toMatchObject({ start: 9, end: 14, adjusted: true, status: 'ok' });
    expect(summarize(list)).toMatchObject({ ok: 1, adjusted: 1, precision: 1, recall: 1 });
  });

  it('proposa fonaments segons l\'ordre dels tocs', () => {
    const c = (t: number, side: 'H' | 'A'): DetContact => ({ t, side, audio: true, visual: true, score: 1, u: 0, v: 0 });
    // Servei H, recepció/col·locació/atac A, bloqueig H, defensa H
    expect(guessSkills([c(0, 'H'), c(1, 'A'), c(2, 'A'), c(3, 'A'), c(3.2, 'H'), c(4, 'H')], 'H')).toEqual(['S', 'R', 'E', 'A', 'B', 'D']);
  });
});
