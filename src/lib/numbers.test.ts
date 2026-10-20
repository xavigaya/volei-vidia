import { describe, expect, test } from 'vitest';
import { duplicatedNumbers, pickConvocable } from './numbers';

describe('dorsals', () => {
  test('repetits dins la plantilla (només actius)', () => {
    expect([...duplicatedNumbers([{ shirt_number: 5 }, { shirt_number: 5 }, { shirt_number: 7 }, { shirt_number: 7, active: false }])]).toEqual([5]);
  });
  test('convocables sense repetir dorsal', () => {
    const r = pickConvocable(
      [
        { id: 'a', shirt_number: 5 },
        { id: 'b', shirt_number: 5 },
        { id: 'c', shirt_number: 3 },
        { id: 'd', shirt_number: 9 },
      ],
      [9],
    );
    expect(r.ok.map((x) => x.id)).toEqual(['a', 'c']);
    expect(r.skipped.map((x) => x.id)).toEqual(['b', 'd']);
  });
});
