// =====================================================================
// Format DataVolley (.dvw)
//
// Fitxer de text per seccions ([3MATCH], [3TEAMS], [3PLAYERS-H]…,
// [3SCOUT]). Cada línia de [3SCOUT] és un codi seguit de camps separats
// per ";":
//
//   codi;fase punt;fase atac;;coord inici;coord mig;coord final;hora;set;
//   pos. col·locador local;pos. col·locador visitant;fitxer vídeo;segon vídeo;;
//   local P1..P6;visitant P1..P6;
//
// Codi d'acció: equip(1) dorsal(2) fonament(1) tipus(1) qualificació(1)
// combinació(2) objectiu(1) zona inici(1) zona final(1) subzona(1)…
//   *13SM-~~~76A   servei del local 13, tipus M, "-", de la zona 7 a la 6
// Altres codis: *p25:20 (punt), *c03:13 (canvi), *T (temps mort),
// *P04>LUp / *z3>LUp (col·locador i rotació), **1set (final de set).
// =====================================================================

import { pointWinner, type Evaluation, type Skill, type SkillType } from '../engine/actions';
import {
  applyEvent,
  DEFAULT_RULES,
  initialState,
  onCourt,
  type MatchEvent,
  type MatchEventData,
  type MatchRules,
  type MatchState,
  type Side,
  type TeamLineup,
} from '../engine/match';
import type { PlayerPosition } from '../lib/types';

// ---------------------------------------------------------------------
// Tipus
// ---------------------------------------------------------------------
export interface DvwPlayer {
  number: number;
  firstName: string;
  lastName: string;
  nickname: string;
  position: PlayerPosition;
  libero: boolean;
  starts: (number | null)[]; // posició inicial a cada set (1..6)
}

export interface DvwTeam {
  code: string;
  name: string;
  coach: string;
  assistant: string;
}

export interface DvwLine {
  code: string;
  set: number | null;
  videoTime: number | null;
  rotation: Record<Side, number[] | null>; // P1..P6
}

export interface ParsedDvw {
  date: string | null; // AAAA-MM-DD
  time: string | null; // HH:MM
  season: string;
  league: string;
  phase: string;
  teams: [DvwTeam, DvwTeam];
  players: Record<Side, DvwPlayer[]>;
  sets: { h: number; a: number }[];
  video: string | null;
  scout: DvwLine[];
}

// ---------------------------------------------------------------------
// Codis de posició DataVolley: 1 líbero, 2 receptor, 3 oposat, 4 central, 5 col·locador
// ---------------------------------------------------------------------
const ROLE_TO_POS: Record<string, PlayerPosition> = { '1': 'L', '2': 'OH', '3': 'OPP', '4': 'MB', '5': 'S' };
const POS_TO_ROLE: Record<PlayerPosition, string> = { L: '1', OH: '2', OPP: '3', MB: '4', S: '5', UNI: '2', U: '0' };

const SKILL_RE = /^([*a])(\d{1,2})([SREABDF])([HMQTUFON~])?([#+!\-/=])(.*)$/i;

// ---------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------
export function decodeDvw(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

function sections(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let cur = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const m = /^\[3([A-Z-]+)\]/.exec(line);
    if (m) {
      cur = m[1];
      out.set(cur, []);
    } else if (cur && line) out.get(cur)!.push(line);
  }
  return out;
}

const num = (s: string | undefined): number | null => {
  if (s == null || s.trim() === '') return null;
  const n = Number(s.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function parseDate(s: string | undefined): string | null {
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function parsePlayers(lines: string[] | undefined): DvwPlayer[] {
  return (lines ?? [])
    .map((l) => l.split(';'))
    .filter((f) => num(f[1]) != null)
    .map((f) => {
      const role = (f[13] ?? '').trim();
      const libero = (f[12] ?? '').trim().toUpperCase() === 'L' || role === '1';
      return {
        number: num(f[1])!,
        starts: [3, 4, 5, 6, 7].map((i) => {
          const v = num(f[i]);
          return v != null && v >= 1 && v <= 6 ? v : null;
        }),
        lastName: (f[9] ?? '').trim(),
        firstName: (f[10] ?? '').trim(),
        nickname: (f[11] ?? '').trim(),
        position: libero ? 'L' : (ROLE_TO_POS[role] ?? 'U'),
        libero,
      };
    });
}

export function parseDvw(text: string): ParsedDvw {
  const sec = sections(text);
  const match = (sec.get('MATCH')?.[0] ?? '').split(';');
  const teamLines = (sec.get('TEAMS') ?? []).map((l) => l.split(';'));
  const team = (f: string[] | undefined, fallback: string): DvwTeam => ({
    code: (f?.[0] ?? '').trim(),
    name: (f?.[1] ?? '').trim() || fallback,
    coach: (f?.[3] ?? '').trim(),
    assistant: (f?.[4] ?? '').trim(),
  });
  const sets = (sec.get('SET') ?? [])
    .map((l) => {
      const scores = [...l.matchAll(/(\d{1,2})\s*-\s*(\d{1,2})/g)];
      const last = scores[scores.length - 1];
      return last ? { h: Number(last[1]), a: Number(last[2]) } : null;
    })
    .filter((x): x is { h: number; a: number } => !!x && x.h + x.a > 0);

  const scout: DvwLine[] = (sec.get('SCOUT') ?? []).map((l) => {
    const f = l.split(';');
    const rot = (from: number) => {
      const v = f.slice(from, from + 6).map((x) => num(x));
      return v.length === 6 && v.every((x) => x != null) ? (v as number[]) : null;
    };
    return { code: f[0].trim(), set: num(f[8]), videoTime: num(f[12]), rotation: { H: rot(14), A: rot(20) } };
  });

  const videoLine = (sec.get('VIDEO') ?? [])[0];
  const timeMatch = /(\d{1,2})[.:](\d{2})/.exec(match[1] ?? '');
  return {
    date: parseDate(match[0]),
    time: timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : null,
    season: (match[2] ?? '').trim(),
    league: (match[3] ?? '').trim(),
    phase: (match[4] ?? '').trim(),
    teams: [team(teamLines[0], 'Local'), team(teamLines[1], 'Visitant')],
    players: { H: parsePlayers(sec.get('PLAYERS-H')), A: parsePlayers(sec.get('PLAYERS-V')) },
    sets,
    video: videoLine ? videoLine.replace(/^Camera\d*=/i, '').trim() || null : null,
    scout,
  };
}

// ---------------------------------------------------------------------
// Conversió de les línies de scout a esdeveniments del motor
// ---------------------------------------------------------------------
export interface ImportResult {
  events: (MatchEventData & { videoTime: number | null })[];
  warnings: string[];
  state: MatchState;
}

export function dvwToEvents(dv: ParsedDvw, baseRules: MatchRules = DEFAULT_RULES): ImportResult {
  const rules: MatchRules = { ...baseRules, lenientActions: true };
  const rosters = { H: dv.players.H.map((p) => p.number), A: dv.players.A.map((p) => p.number) };
  let state = initialState(rules, rosters);
  const events: ImportResult['events'] = [];
  const warnings: string[] = [];
  const liberos = { H: dv.players.H.filter((p) => p.libero).map((p) => p.number).slice(0, 2), A: dv.players.A.filter((p) => p.libero).map((p) => p.number).slice(0, 2) };

  const push = (ev: MatchEventData, vt: number | null, line: string): boolean => {
    try {
      state = applyEvent(state, ev);
      events.push({ ...ev, videoTime: vt });
      return true;
    } catch (e) {
      warnings.push(`${line}: ${(e as Error).message}`);
      return false;
    }
  };

  // Completa el set amb punts si el fitxer s'atura abans d'arribar al resultat final
  const closeSet = (line: string) => {
    if (state.phase !== 'in_play') return;
    const target = dv.sets[state.currentSet - 1];
    if (!target) return;
    let guard = 0;
    while (state.phase === 'in_play' && guard++ < 100) {
      // Es reparteixen els punts que falten perquè el set no s'acabi abans d'hora
      const remH = target.h - state.score.H;
      const remA = target.a - state.score.A;
      if (remH <= 0 && remA <= 0) break;
      const side: Side = remA <= 0 ? 'H' : remH <= 0 ? 'A' : remH > remA ? 'H' : remA > remH ? 'A' : target.h < target.a ? 'H' : 'A';
      push({ type: 'point', side }, null, line);
    }
    if (state.phase === 'in_play') warnings.push(`${line}: set ${state.currentSet} no tancat`);
  };

  const lineupFor = (idx: number, side: Side): number[] | null => {
    const l = dv.scout[idx];
    if (l?.rotation[side]) return l.rotation[side];
    // Alternativa: posicions inicials de la secció de jugadors
    const setNo = state.currentSet + 1;
    const pos: number[] = [];
    for (const p of dv.players[side]) {
      const st = p.starts[setNo - 1];
      if (st) pos[st - 1] = p.number;
    }
    return pos.filter((x) => x != null).length === 6 ? pos : null;
  };

  // Qui serveix primer: el primer servei d'aquest set
  const firstServe = (from: number): Side => {
    for (let i = from; i < dv.scout.length; i++) {
      const c = dv.scout[i].code;
      if (/^\*\*\d/.test(c)) break;
      const m = SKILL_RE.exec(c);
      if (m && m[3].toUpperCase() === 'S') return m[1] === '*' ? 'H' : 'A';
    }
    return 'H';
  };

  // El marcador real el donen les línies de punt (*p25:20 / ap25:20): per a
  // cada línia, quin equip guanya la jugada en curs (la següent línia de punt)
  const rallyWinner: (Side | null)[] = new Array(dv.scout.length).fill(null);
  {
    let next: Side | null = null;
    for (let i = dv.scout.length - 1; i >= 0; i--) {
      const c = dv.scout[i].code;
      if (/^\*\*\d/.test(c)) next = null;
      else if (/^[*a]p\d{1,2}:\d{1,2}/i.test(c)) next = c[0] === '*' ? 'H' : 'A';
      rallyWinner[i] = next;
    }
  }
  const hasPointLines = dv.scout.some((l) => /^[*a]p\d{1,2}:\d{1,2}/i.test(l.code));
  let rallyPointGiven = false;

  dv.scout.forEach((line, idx) => {
    const code = line.code;
    if (!code) return;
    const side: Side = code[0] === '*' ? 'H' : 'A';

    // Final de set
    if (/^\*\*\d+set/i.test(code)) {
      closeSet(code);
      return;
    }

    const isPlayLine = SKILL_RE.test(code) || /^[*a]p\d/i.test(code) || /^[*a]c\d/i.test(code) || /^[*a]T$/.test(code);
    if (!isPlayLine) return;

    // Línia de punt amb el set ja acabat (p. ex. "ap17:25" després de l'acció
    // que el tanca): no obre un set nou. Només ho fa el primer punt (1:0 / 0:1).
    const pl = /^[*a]p(\d{1,2}):(\d{1,2})/i.exec(code);
    if (pl && state.phase !== 'in_play' && Number(pl[1]) + Number(pl[2]) !== 1) return;

    // Inici de set: alineació a partir de la rotació de la primera línia
    if (state.phase === 'awaiting_lineup') {
      const h = lineupFor(idx, 'H');
      const a = lineupFor(idx, 'A');
      if (!h || !a) {
        warnings.push(`${code}: alineació desconeguda`);
        return;
      }
      const lu = (positions: number[], s: Side): TeamLineup => ({ positions, liberos: liberos[s].filter((n) => !positions.includes(n)) });
      if (!push({ type: 'lineup', home: lu(h, 'H'), away: lu(a, 'A'), serving: firstServe(idx) }, line.videoTime, code)) return;
    }
    if (state.phase !== 'in_play') return;

    const m = SKILL_RE.exec(code);
    if (m) {
      const rest = m[6] ?? '';
      const zone = (c: string | undefined) => (c && /[1-9]/.test(c) ? Number(c) : null);
      const type = (m[4] ?? '').toUpperCase();
      const action = {
        side,
        player: Number(m[2]),
        skill: m[3].toUpperCase() as Skill,
        evaluation: m[5] as Evaluation,
      };
      // Amb línies de punt, una acció només dona el punt si coincideix amb qui
      // el guanya de veritat i encara no s'ha donat en aquesta jugada
      const pw = pointWinner(action);
      const noPoint = hasPointLines && pw != null && (pw !== rallyWinner[idx] || rallyPointGiven);
      const before = state.score.H + state.score.A;
      push(
        {
          type: 'action',
          ...action,
          skillType: /^[HMQTUFO]$/.test(type) ? (type as SkillType) : null,
          startZone: zone(rest[3]),
          endZone: zone(rest[4]),
          ...(noPoint ? { noPoint: true } : {}),
        },
        line.videoTime,
        code,
      );
      if (state.score.H + state.score.A !== before) rallyPointGiven = true;
      return;
    }
    let mm = /^[*a]p(\d{1,2}):(\d{1,2})/i.exec(code);
    if (mm) {
      // El punt ja s'ha comptat si l'acció final el donava; si no, s'afegeix
      const target = { H: Number(mm[1]), A: Number(mm[2]) };
      if (state.score[side] < target[side]) push({ type: 'point', side }, line.videoTime, code);
      rallyPointGiven = false;
      if (state.phase === 'in_play' && (state.score.H !== target.H || state.score.A !== target.A)) {
        warnings.push(`${code}: marcador ${state.score.H}-${state.score.A}`);
      }
      return;
    }
    mm = /^[*a]c(\d{1,2}):(\d{1,2})/i.exec(code);
    if (mm) {
      push({ type: 'sub', side, out: Number(mm[1]), in: Number(mm[2]) }, line.videoTime, code);
      return;
    }
    if (/^[*a]T$/.test(code)) push({ type: 'timeout', side }, line.videoTime, code);
  });
  closeSet('final');
  return { events, warnings, state };
}

// ---------------------------------------------------------------------
// Escriptura
// ---------------------------------------------------------------------
export interface ExportInput {
  date: string | null; // ISO
  season: string;
  league: string;
  phase: string;
  teams: [DvwTeam, DvwTeam];
  players: Record<Side, { number: number; firstName: string; lastName: string; nickname: string; position: PlayerPosition; libero: boolean }[]>;
  events: MatchEvent[];
  rules: MatchRules;
  video: string | null;
}

const p2 = (n: number) => String(n).padStart(2, '0');

function hhmmss(d: Date): string {
  return `${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}`;
}

export function exportDvw(input: ExportInput): string {
  const out: string[] = [];
  const date = input.date ? new Date(input.date) : new Date();
  const setters: Record<Side, number[]> = {
    H: input.players.H.filter((p) => p.position === 'S').map((p) => p.number),
    A: input.players.A.filter((p) => p.position === 'S').map((p) => p.number),
  };

  // Reproducció per saber rotacions i marcador a cada línia
  let s = initialState({ ...input.rules, lenientActions: true });
  const scout: string[] = [];
  let pending: string[] = [];
  const starts: Record<Side, Map<number, (number | null)[]>> = { H: new Map(), A: new Map() };

  const rotationCols = (st: MatchState) => {
    const cols = (side: Side) => {
      const l = st.teams[side].lineup;
      return l.length === 6 ? l.map(String) : ['', '', '', '', '', ''];
    };
    return [...cols('H'), ...cols('A')];
  };
  const setterPos = (st: MatchState, side: Side) => {
    const idx = st.teams[side].lineup.findIndex((n) => setters[side].includes(n));
    return idx >= 0 ? String(idx + 1) : '';
  };
  const line = (code: string, st: MatchState, vt: number | null | undefined) => {
    scout.push(
      [code, '', '', '', '', '', '', hhmmss(date), String(st.currentSet || 1), setterPos(st, 'H'), setterPos(st, 'A'), '1', vt != null ? String(Math.round(vt)) : '', '', ...rotationCols(st), ''].join(';'),
    );
  };
  const flush = () => {
    scout.push(...pending);
    pending = [];
  };

  for (const ev of [...input.events].sort((a, b) => a.seq - b.seq)) {
    const before = s;
    try {
      s = applyEvent(s, ev);
    } catch {
      continue;
    }
    const complement = s.notices.includes('complement');
    if (!complement) flush();
    const team = (sd: Side) => (sd === 'H' ? '*' : 'a');

    switch (ev.type) {
      case 'lineup': {
        for (const sd of ['H', 'A'] as Side[]) {
          const l = sd === 'H' ? ev.home : ev.away;
          l.positions.forEach((n, i) => {
            const arr = starts[sd].get(n) ?? [null, null, null, null, null];
            arr[s.currentSet - 1] = i + 1;
            starts[sd].set(n, arr);
          });
          const sp = setterPos(s, sd);
          const setter = s.teams[sd].lineup.find((n) => setters[sd].includes(n));
          if (setter != null && sp) {
            line(`${team(sd)}P${p2(setter)}>LUp`, s, ev.videoTime);
            line(`${team(sd)}z${sp}>LUp`, s, ev.videoTime);
          }
        }
        break;
      }
      case 'action': {
        const code =
          `${team(ev.side)}${p2(ev.player)}${ev.skill}${ev.skillType ?? 'H'}${ev.evaluation}~~~` +
          `${ev.startZone ?? '~'}${ev.endZone ?? '~'}`;
        // Les accions es registren amb la rotació d'abans de l'acció
        line(code, complement ? s : before, ev.videoTime);
        break;
      }
      case 'sub':
        line(`${team(ev.side)}c${p2(ev.out)}:${p2(ev.in)}`, s, ev.videoTime);
        break;
      case 'timeout':
        line(`${team(ev.side)}T`, s, ev.videoTime);
        break;
      case 'libero':
      case 'point':
        break;
    }

    // Punt: la línia *p/ap s'escriu després de les accions complementàries
    if (s.score.H + s.score.A !== before.score.H + before.score.A && before.phase === 'in_play') {
      const winner: Side = s.score.H > before.score.H ? 'H' : 'A';
      const saved = scout.length;
      line(`${team(winner)}p${p2(s.score.H)}:${p2(s.score.A)}`, s, ev.videoTime);
      pending.push(...scout.splice(saved));
      if (s.phase !== 'in_play') {
        const saved2 = scout.length;
        line(`**${before.currentSet}set`, s, ev.videoTime);
        pending.push(...scout.splice(saved2));
      }
    }
  }
  flush();

  const setsWon = (sd: Side) => s.sets.filter((x) => x.winner === sd).length;
  const dd = `${p2(date.getDate())}/${p2(date.getMonth() + 1)}/${date.getFullYear()}`;

  out.push('[3DATAVOLLEYSCOUT]', 'FILEFORMAT: 2.0', 'GENERATOR-PRG: Volei VidIA', `GENERATOR-DAY: ${dd} ${hhmmss(new Date())}`);
  out.push('[3MATCH]', `${dd};${hhmmss(date)};${input.season};${input.league};${input.phase};;;;;;Z;0;`);
  out.push('[3TEAMS]');
  input.teams.forEach((t, i) => out.push(`${t.code};${t.name};${setsWon(i === 0 ? 'H' : 'A')};${t.coach};${t.assistant};;;;`));
  out.push('[3MORE]', '[3COMMENTS]', '[3SET]');
  for (let i = 0; i < 5; i++) {
    const st = s.sets[i];
    out.push(st ? `True;;;;${st.home}-${st.away};;` : 'True;;;;;;');
  }
  for (const sd of ['H', 'A'] as Side[]) {
    out.push(sd === 'H' ? '[3PLAYERS-H]' : '[3PLAYERS-V]');
    input.players[sd].forEach((p, i) => {
      const st = starts[sd].get(p.number) ?? [null, null, null, null, null];
      out.push(
        [sd === 'H' ? 0 : 1, p.number, i + 1, ...st.map((x) => (x == null ? '' : String(x))), `${sd}${p2(p.number)}`, p.lastName, p.firstName, p.nickname, p.libero ? 'L' : '', POS_TO_ROLE[p.position], 'False', '', ''].join(';'),
      );
    });
  }
  out.push('[3ATTACKCOMBINATION]', '[3SETTERCALL]', '[3WINNINGSYMBOLS]', '[3RESERVE]', '[3VIDEO]');
  if (input.video) out.push(`Camera0=${input.video}`);
  out.push('[3SCOUT]', ...scout);
  return out.join('\r\n') + '\r\n';
}

// Text → bytes Windows-1252 (Latin-1), la codificació habitual dels fitxers .dvw
export function encodeLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    bytes[i] = c < 256 ? c : 63; // "?"
  }
  return bytes;
}

// Utilitat per als tests i la vista prèvia
export function onCourtNumbers(state: MatchState, side: Side): number[] {
  return onCourt(state.teams[side]);
}
