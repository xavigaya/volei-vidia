// =====================================================================
// Verificació amb l'acta oficial (reconeixement de jugades, fase 0.1)
//
// De l'acta es poden entrar, per a cada set:
//   * qui serveix primer,
//   * la formació inicial (I..VI) de cada equip,
//   * els "punts al canvi": el marcador propi de l'equip cada vegada que
//     perd el servei, en ordre (les caselles de sota de cada servidor),
//   * el resultat final, i opcionalment l'hora d'inici i de final.
//
// Es compara amb el partit codificat i es llisten les diferències.
// =====================================================================

import { applyEvent, EngineError, initialState, type MatchEvent, type MatchRules, type Rosters, type Side } from '../engine/match';

export interface ScoresheetTeamSet {
  lineup: (number | null)[]; // 6 dorsals o buit
  serveLoss: number[]; // punts al canvi
}

export interface ScoresheetSet {
  number: number;
  firstServe: Side | null;
  home: ScoresheetTeamSet;
  away: ScoresheetTeamSet;
  final: { h: number | null; a: number | null };
  start?: string | null; // hh:mm
  end?: string | null;
}

export interface Scoresheet {
  sets: ScoresheetSet[];
  notes?: string | null;
}

export function emptySet(number: number): ScoresheetSet {
  const team = (): ScoresheetTeamSet => ({ lineup: [null, null, null, null, null, null], serveLoss: [] });
  return { number, firstServe: null, home: team(), away: team(), final: { h: null, a: null }, start: null, end: null };
}

// Dades equivalents calculades a partir del partit codificat
export interface CodedSet {
  number: number;
  firstServe: Side;
  lineups: { H: number[]; A: number[] };
  serveLoss: { H: number[]; A: number[] };
  final: { h: number; a: number };
  finished: boolean;
}

export function codedSets(events: MatchEvent[], rules: MatchRules, rosters: Rosters | null = null): CodedSet[] {
  let s = initialState(rules, rosters);
  const sets: CodedSet[] = [];
  for (const ev of [...events].sort((a, b) => a.seq - b.seq)) {
    const before = s;
    try {
      s = applyEvent(s, ev);
    } catch (e) {
      if (e instanceof EngineError) continue;
      throw e;
    }
    if (ev.type === 'lineup') {
      sets.push({
        number: s.currentSet,
        firstServe: ev.serving,
        lineups: { H: [...ev.home.positions], A: [...ev.away.positions] },
        serveLoss: { H: [], A: [] },
        final: { h: 0, a: 0 },
        finished: false,
      });
      continue;
    }
    const cur = sets[sets.length - 1];
    if (!cur || before.phase !== 'in_play') continue;
    const scored = s.score.H + s.score.A !== before.score.H + before.score.A || s.currentSet !== before.currentSet;
    if (!scored) continue;
    const setEnded = s.phase !== 'in_play';
    const last = s.sets[s.sets.length - 1];
    const h = setEnded ? last.home : s.score.H;
    const a = setEnded ? last.away : s.score.A;
    cur.final = { h, a };
    // Ha perdut el servei qui servia abans del punt?
    const loser = before.serving;
    const winnerSide: Side = h > before.score.H ? 'H' : 'A';
    if (winnerSide !== loser && !setEnded) cur.serveLoss[loser].push(loser === 'H' ? h : a);
    if (setEnded) cur.finished = true;
  }
  return sets;
}

export type DiffKind = 'missing_set' | 'first_serve' | 'lineup' | 'serve_loss' | 'final';

export interface Diff {
  set: number;
  kind: DiffKind;
  side?: Side;
  // Posició (lineup) o ordre del canvi de servei (serve_loss), començant per 1
  index?: number;
  expected: string; // acta
  actual: string; // codificat
}

// L'acta sol escriure el resultat final a l'última casella: si n'hi ha una
// de més i coincideix amb el resultat final, no compta com a canvi de servei
function stripFinal(sheet: number[], coded: number[], final: number | null): number[] {
  if (final != null && sheet.length === coded.length + 1 && sheet[sheet.length - 1] === final) return sheet.slice(0, -1);
  return sheet;
}

export function compareScoresheet(sheet: Scoresheet, coded: CodedSet[]): Diff[] {
  const diffs: Diff[] = [];
  for (const ss of sheet.sets) {
    const hasData =
      ss.firstServe != null ||
      ss.final.h != null ||
      ss.final.a != null ||
      [ss.home, ss.away].some((t) => t.serveLoss.length > 0 || t.lineup.some((n) => n != null));
    if (!hasData) continue;
    const c = coded.find((x) => x.number === ss.number);
    if (!c) {
      diffs.push({ set: ss.number, kind: 'missing_set', expected: `${ss.final.h ?? '?'}-${ss.final.a ?? '?'}`, actual: '–' });
      continue;
    }
    if (ss.firstServe && ss.firstServe !== c.firstServe) {
      diffs.push({ set: ss.number, kind: 'first_serve', expected: ss.firstServe, actual: c.firstServe });
    }
    for (const side of ['H', 'A'] as Side[]) {
      const team = side === 'H' ? ss.home : ss.away;
      team.lineup.forEach((n, i) => {
        if (n != null && n !== c.lineups[side][i]) {
          diffs.push({ set: ss.number, kind: 'lineup', side, index: i + 1, expected: String(n), actual: String(c.lineups[side][i] ?? '–') });
        }
      });
      const final = side === 'H' ? ss.final.h : ss.final.a;
      const act = c.serveLoss[side];
      const exp = stripFinal(team.serveLoss, act, final ?? (side === 'H' ? c.final.h : c.final.a));
      if (exp.length) {
        const n = Math.max(exp.length, act.length);
        for (let i = 0; i < n; i++) {
          if (exp[i] !== act[i]) {
            diffs.push({
              set: ss.number,
              kind: 'serve_loss',
              side,
              index: i + 1,
              expected: exp[i] != null ? String(exp[i]) : '–',
              actual: act[i] != null ? String(act[i]) : '–',
            });
            break; // a partir del primer error, la resta sol estar desplaçada
          }
        }
      }
    }
    if ((ss.final.h != null && ss.final.h !== c.final.h) || (ss.final.a != null && ss.final.a !== c.final.a)) {
      diffs.push({ set: ss.number, kind: 'final', expected: `${ss.final.h ?? '?'}-${ss.final.a ?? '?'}`, actual: `${c.final.h}-${c.final.a}` });
    }
  }
  return diffs;
}

// "1 5 9, 12" → [1, 5, 9, 12]
export function parseNumberList(text: string): number[] {
  return text
    .split(/[\s,;.-]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 99);
}

export function durationMinutes(start?: string | null, end?: string | null): number | null {
  const m = (t?: string | null) => {
    const r = t ? /^(\d{1,2})[:.h](\d{2})$/.exec(t.trim()) : null;
    return r ? Number(r[1]) * 60 + Number(r[2]) : null;
  };
  const a = m(start);
  const b = m(end);
  if (a == null || b == null) return null;
  return (b - a + 24 * 60) % (24 * 60);
}
