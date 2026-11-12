// =====================================================================
// Accions de joc (codificació compatible amb DataVolley)
//
//   Fonaments (skill):  S servei · R recepció · E col·locació · A atac
//                       B bloqueig · D defensa · F free ball
//   Qualificació:       #  perfecte / punt
//                       +  positiva
//                       !  regular (DataVolley: "OK")
//                       -  negativa
//                       /  molt negativa (segons el fonament: bloquejat,
//                          bola que passa directa, invasió…)
//                       =  error / punt per al rival
//   Tipus (opcional):   H alta · M mitja · Q ràpida · T tensa · U super
//                       F rapida/fast · O altres
//
// Zones: el mig camp de cada equip es divideix en 9 zones de 3×3 m,
// numerades des del punt de vista de l'equip que hi juga:
//
//          xarxa
//     ┌───┬───┬───┐
//     │ 4 │ 3 │ 2 │   davantera
//     ├───┼───┼───┤
//     │ 7 │ 8 │ 9 │   mig
//     ├───┼───┼───┤
//     │ 5 │ 6 │ 1 │   zaga
//     └───┴───┴───┘
//        fons
// =====================================================================

import { other, type Side } from './side';

export type Skill = 'S' | 'R' | 'E' | 'A' | 'B' | 'D' | 'F';
export type Evaluation = '#' | '+' | '!' | '-' | '/' | '=';
export type SkillType = 'H' | 'M' | 'Q' | 'T' | 'U' | 'F' | 'O';

export const SKILLS: Skill[] = ['S', 'R', 'E', 'A', 'B', 'D', 'F'];
export const EVALUATIONS: Evaluation[] = ['#', '+', '!', '-', '/', '='];
export const SKILL_TYPES: SkillType[] = ['H', 'M', 'Q', 'T', 'U', 'F', 'O'];

export interface Point2 {
  x: number; // metres, 0..18 al llarg del camp (local a l'esquerra, xarxa a x=9)
  y: number; // metres, 0..9 d'amplada (0 = banda superior a la pantalla)
}

export interface Action {
  side: Side;
  player: number;
  skill: Skill;
  skillType?: SkillType | null;
  evaluation: Evaluation;
  startZone?: number | null;
  endZone?: number | null;
  start?: Point2 | null;
  end?: Point2 | null;
  // Importacions: l'acció no decideix el punt (el marcador el porten les
  // línies de punt del fitxer, p. ex. quan la codificació original no
  // coincideix amb qui va guanyar la jugada)
  noPoint?: boolean;
}

// Acció final: retorna l'equip que guanya el punt, o null si la jugada continua
export function pointWinner(a: Pick<Action, 'side' | 'skill' | 'evaluation'>): Side | null {
  if (a.evaluation === '=') return other(a.side);
  if (a.evaluation === '#' && (a.skill === 'S' || a.skill === 'A' || a.skill === 'B')) return a.side;
  if (a.evaluation === '/' && (a.skill === 'A' || a.skill === 'B')) return other(a.side);
  return null;
}

// Zona (1..9) del punt dins del mig camp on cau, i de quin costat és.
// El local juga a l'esquerra (x < 9). Retorna null si cau fora del camp.
export function zoneAt(p: Point2): { half: Side; zone: number } | null {
  if (p.x < 0 || p.x > 18 || p.y < 0 || p.y > 9) return null;
  const half: Side = p.x < 9 ? 'H' : 'A';
  // Distància a la línia de fons pròpia i posició lateral des del punt de vista de l'equip
  const depth = half === 'H' ? p.x : 18 - p.x; // 0 = fons, 9 = xarxa
  const lateral = half === 'H' ? p.y : 9 - p.y; // 0 = esquerra de l'equip
  const row = depth >= 6 ? 0 : depth >= 3 ? 1 : 2; // 0 davantera, 1 mig, 2 zaga
  const col = lateral < 3 ? 0 : lateral < 6 ? 1 : 2; // 0 esquerra, 1 centre, 2 dreta
  const ZONES = [
    [4, 3, 2],
    [7, 8, 9],
    [5, 6, 1],
  ];
  return { half, zone: ZONES[row][col] };
}

// Codi DataVolley d'una acció: *12SH#16
export function actionCode(a: Action): string {
  const team = a.side === 'H' ? '*' : 'a';
  const num = String(a.player).padStart(2, '0');
  const zones = a.startZone || a.endZone ? `${a.startZone ?? '~'}${a.endZone ?? '~'}` : '';
  return `${team}${num}${a.skill}${a.skillType ?? ''}${a.evaluation}${zones}`;
}

// Parelles d'accions complementàries: la segona descriu la mateixa jugada
// des del punt de vista de l'altre equip i no suma un altre punt.
//   S# ↔ R=   (ace / error de recepció)
//   A# ↔ B=, D=   (atac guanyador / bloqueig fora o error de defensa)
//   A/ ↔ B#   (atac bloquejat / punt de bloqueig)
const COMPLEMENTS: Record<string, string[]> = {
  'S#': ['R='],
  'R=': ['S#'],
  'A#': ['B=', 'D='],
  'B=': ['A#'],
  'D=': ['A#'],
  'A/': ['B#'],
  'B#': ['A/'],
};

export function isComplement(
  closing: Pick<Action, 'skill' | 'evaluation'>,
  next: Pick<Action, 'skill' | 'evaluation'>,
): boolean {
  return COMPLEMENTS[`${closing.skill}${closing.evaluation}`]?.includes(`${next.skill}${next.evaluation}`) ?? false;
}
