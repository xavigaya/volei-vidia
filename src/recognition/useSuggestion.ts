import { useEffect, useMemo, useState } from 'react';
import type { Side } from '../engine/match';
import type { UseMatch } from '../matches/useMatch';
import { suggestNext, type SuggestContext, type Suggestion } from './suggest';
import { codedWinners, firstDivergence, rallySequence, type Rally, type RallySequence } from './scoresheet';
import { useRecognition } from './useRecognition';

const KEY = 'svidia.suggest';

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

// Suggeriments per lògica de joc a la pantalla de codificació (etapa 0.2).
// Es poden desactivar (es recorda en aquest dispositiu); desactivats, la
// pantalla de codificació funciona exactament com abans.
export function useSuggestion(m: UseMatch, active: boolean) {
  const r = useRecognition(m);
  const [enabled, setEnabledState] = useState(readEnabled);
  const setEnabled = (v: boolean) => {
    setEnabledState(v);
    try {
      localStorage.setItem(KEY, v ? '1' : '0');
    } catch {
      /* sense emmagatzematge */
    }
  };

  // En tornar a la pantalla de codificació, es recarreguen els sistemes
  // (poden haver canviat a la pestanya Anàlisi assistida)
  const { reload } = r;
  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  const state = m.state;
  const ctx: SuggestContext | null = useMemo(() => {
    if (!state || state.currentSet === 0) return null;
    const build = (side: Side) => {
      const row = r.setSystemsList.find((x) => x.side === side && x.set === state.currentSet);
      const system = row?.current ?? null;
      const hasLibero = state.teams[side].liberos.length > 0;
      return { system, reception: system ? r.receptionFor(side, system.code, hasLibero) : null };
    };
    return { H: build('H'), A: build('A') };
  }, [state, r.setSystemsList, r.receptionFor]);

  const suggestion: Suggestion | null = useMemo(
    () => (enabled && state && ctx ? suggestNext(state, ctx) : null),
    [enabled, state, ctx],
  );

  // Acta: seqüència de punts del set en curs, punt esperat i primer desquadrament
  const acta = useMemo(() => {
    const sheet = r.scoresheet;
    if (!state || !sheet || state.currentSet === 0) return { sheet, sequence: null, expected: null, divergence: null };
    const set = state.currentSet;
    const ss = sheet.sets.find((s) => s.number === set);
    const target = set === state.rules.setsToWin * 2 - 1 ? state.rules.tiebreakPoints : state.rules.pointsPerSet;
    const sequence: RallySequence | null = ss ? rallySequence(ss, target) : null;
    if (!sequence || sequence.rallies.length === 0) return { sheet, sequence, expected: null, divergence: null };
    const winners = codedWinners(m.events, state.rules).get(set) ?? [];
    const divergence = firstDivergence(sequence.rallies, winners);
    const expected: Rally | null =
      state.phase === 'in_play' ? (sequence.rallies[state.score.H + state.score.A] ?? null) : null;
    return { sheet, sequence, expected, divergence };
  }, [r.scoresheet, state, m.events]);

  return { suggestion, enabled, setEnabled, acta, scoresheet: r.scoresheet };
}
