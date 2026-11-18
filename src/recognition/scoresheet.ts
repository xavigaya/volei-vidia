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

// ---------------------------------------------------------------------
// Importació de dades de l'acta en JSON (per a lectors automàtics: l'eina
// local d'anàlisi o qualsevol altre programa que llegeixi l'acta)
//
// { "sets": [ { "number": 1, "firstServe": "H",
//               "home": { "lineup": [2, 7, 12, 9, 4, 13], "serveLoss": [2, 4, 8] },
//               "away": { "lineup": [...], "serveLoss": [...] },
//               "final": { "h": 25, "a": 17 }, "start": "10:00", "end": "10:23" } ],
//   "notes": "..." }
// "H" = equip local i "A" = visitant (no confondre amb l'equip A/B de l'acta).
// ---------------------------------------------------------------------
export type ImportResult = { ok: true; sheet: Scoresheet } | { ok: false; error: string };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 99;
const time = (v: unknown): string | null => (typeof v === 'string' && /^\d{1,2}[:.h]\d{2}$/.test(v.trim()) ? v.trim().replace(/[.h]/, ':').padStart(5, '0') : null);

export function parseScoresheetJson(text: string, maxSets = 5): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'json' };
  }
  const obj = raw as { sets?: unknown; notes?: unknown };
  if (!obj || !Array.isArray(obj.sets)) return { ok: false, error: 'no_sets' };
  const sets: ScoresheetSet[] = [];
  for (const item of obj.sets as Record<string, unknown>[]) {
    const number = item?.number;
    if (!isNum(number) || number < 1 || number > maxSets) return { ok: false, error: 'set_number' };
    const team = (v: unknown): ScoresheetTeamSet => {
      const t = (v ?? {}) as { lineup?: unknown; serveLoss?: unknown };
      const lineup = Array.isArray(t.lineup) ? t.lineup.slice(0, 6).map((n) => (isNum(n) ? n : null)) : [];
      while (lineup.length < 6) lineup.push(null);
      const serveLoss = Array.isArray(t.serveLoss) ? t.serveLoss.filter(isNum) : [];
      return { lineup, serveLoss };
    };
    const final = (item.final ?? {}) as { h?: unknown; a?: unknown };
    sets.push({
      number,
      firstServe: item.firstServe === 'H' || item.firstServe === 'A' ? item.firstServe : null,
      home: team(item.home),
      away: team(item.away),
      final: { h: isNum(final.h) ? final.h : null, a: isNum(final.a) ? final.a : null },
      start: time(item.start),
      end: time(item.end),
    });
  }
  return { ok: true, sheet: { sets, notes: typeof obj.notes === 'string' ? obj.notes : null } };
}

// ---------------------------------------------------------------------
// Seqüència de punts reconstruïda a partir de l'acta
//
// Amb el primer servei i els punts al canvi de servei de cada equip es pot
// saber, punt a punt, qui serveix, qui el guanya i el marcador. Amb la
// formació inicial, també qui és el jugador que serveix (sense tenir en
// compte els canvis, que l'acta no relaciona amb cada punt).
// ---------------------------------------------------------------------
export interface Rally {
  index: number; // 0 = primer punt del set
  server: Side;
  serverPlayer: number | null;
  winner: Side;
  // Marcador abans i després del punt
  before: { h: number; a: number };
  after: { h: number; a: number };
}

export interface RallySequence {
  set: number;
  rallies: Rally[];
  complete: boolean; // arriba al final del set
  consistent: boolean; // el resultat coincideix amb el de l'acta i no sobren dades
  error?: 'no_first_serve' | 'decreasing' | 'leftover' | 'final_mismatch';
}

const otherSide = (s: Side): Side => (s === 'H' ? 'A' : 'H');

export function rallySequence(ss: ScoresheetSet, target = 25): RallySequence {
  const out: RallySequence = { set: ss.number, rallies: [], complete: false, consistent: false };
  if (!ss.firstServe) return { ...out, error: 'no_first_serve' };
  const lists = { H: ss.home.serveLoss, A: ss.away.serveLoss };
  const lineups = {
    H: ss.home.lineup.every((n) => n != null) ? (ss.home.lineup as number[]) : null,
    A: ss.away.lineup.every((n) => n != null) ? (ss.away.lineup as number[]) : null,
  };
  const rot = { H: 0, A: 0 }; // rotacions des de l'inici del set
  const idx = { H: 0, A: 0 };
  const score = { H: 0, A: 0 };
  let srv: Side = ss.firstServe;
  const over = () => Math.max(score.H, score.A) >= target && Math.abs(score.H - score.A) >= 2;
  const push = (winner: Side) => {
    const before = { h: score.H, a: score.A };
    score[winner] += 1;
    const lu = lineups[srv];
    out.rallies.push({
      index: out.rallies.length,
      server: srv,
      serverPlayer: lu ? lu[rot[srv] % 6] : null,
      winner,
      before,
      after: { h: score.H, a: score.A },
    });
  };

  while (!over()) {
    const list = lists[srv];
    if (idx[srv] >= list.length) return out; // falten dades
    const v = list[idx[srv]++];
    if (v < score[srv]) return { ...out, error: 'decreasing' };
    while (score[srv] < v && !over()) push(srv);
    if (over()) break;
    // Perd el servei: punt per a l'altre equip, que rota i passa a servir
    const o = otherSide(srv);
    push(o);
    if (over()) break;
    rot[o] += 1;
    srv = o;
  }
  out.complete = true;
  // Pot sobrar, com a molt, el resultat final escrit a la casella següent de l'equip que guanya rebent
  const leftover = (['H', 'A'] as Side[]).flatMap((s) => lists[s].slice(idx[s]).map((v) => ({ s, v })));
  const okLeftover = leftover.length === 0 || (leftover.length === 1 && leftover[0].v === score[leftover[0].s]);
  if (!okLeftover) return { ...out, error: 'leftover' };
  if ((ss.final.h != null && ss.final.h !== score.H) || (ss.final.a != null && ss.final.a !== score.A)) {
    return { ...out, error: 'final_mismatch' };
  }
  out.consistent = true;
  return out;
}

// Guanyador de cada punt del partit codificat, per set (per comparar-lo amb l'acta)
export function codedWinners(events: MatchEvent[], rules: MatchRules, rosters: Rosters | null = null): Map<number, Side[]> {
  let s = initialState(rules, rosters);
  const out = new Map<number, Side[]>();
  for (const ev of [...events].sort((a, b) => a.seq - b.seq)) {
    const before = s;
    try {
      s = applyEvent(s, ev);
    } catch (e) {
      if (e instanceof EngineError) continue;
      throw e;
    }
    if (ev.type === 'lineup') {
      out.set(s.currentSet, []);
      continue;
    }
    if (before.phase !== 'in_play') continue;
    const last = s.sets[s.sets.length - 1];
    const h = s.phase === 'in_play' ? s.score.H : last.home;
    const a = s.phase === 'in_play' ? s.score.A : last.away;
    if (h > before.score.H) out.get(before.currentSet)?.push('H');
    else if (a > before.score.A) out.get(before.currentSet)?.push('A');
  }
  return out;
}

// Primer punt on la codificació no coincideix amb l'acta (null si coincideix fins on arriba)
export function firstDivergence(acta: Rally[], coded: Side[]): number | null {
  const n = Math.min(acta.length, coded.length);
  for (let i = 0; i < n; i++) if (acta[i].winner !== coded[i]) return i;
  return null;
}
