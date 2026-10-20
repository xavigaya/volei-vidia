// Dorsals repetits dins d'una plantilla (es permeten, però no es poden
// convocar tots dos jugadors al mateix partit)
export function duplicatedNumbers(list: { shirt_number: number; active?: boolean }[]): Set<number> {
  const seen = new Set<number>();
  const dup = new Set<number>();
  for (const p of list) {
    if (p.active === false) continue;
    if (seen.has(p.shirt_number)) dup.add(p.shirt_number);
    seen.add(p.shirt_number);
  }
  return dup;
}

// Tria quins jugadors es poden convocar: no es repeteix cap dorsal (ni amb els
// ja convocats). Els que queden fora es retornen a part.
export function pickConvocable<T extends { shirt_number: number }>(candidates: T[], alreadyUsed: Iterable<number> = []): { ok: T[]; skipped: T[] } {
  const used = new Set(alreadyUsed);
  const ok: T[] = [];
  const skipped: T[] = [];
  for (const c of candidates) {
    if (used.has(c.shirt_number)) skipped.push(c);
    else {
      used.add(c.shirt_number);
      ok.push(c);
    }
  }
  return { ok, skipped };
}
