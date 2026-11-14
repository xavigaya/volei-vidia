import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EVALUATIONS,
  SKILLS,
  SKILL_TYPES,
  pointWinner,
  zoneAt,
  type Evaluation,
  type Point2,
  type Skill,
  type SkillType,
} from '../engine/actions';
import { onCourt, type MatchEventData, type MatchState, type Side } from '../engine/match';
import { playerDisplayName, type MatchPlayer, type SideCode } from '../lib/types';
import { CourtMap } from './CourtMap';
import { EVAL_KEY } from './Legend';
import { suggestionPrefix, type Suggestion, type SuggestedAction } from '../recognition/suggest';

export interface Selection {
  side: Side;
  player: number;
}

interface Props {
  state: MatchState;
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
  names: Record<SideCode, string>;
  colors: Record<SideCode, string>;
  players: Record<SideCode, Map<number, MatchPlayer>>;
  flipped: boolean;
  send: (ev: MatchEventData) => Promise<boolean>;
  // Proposta de la següent acció (anàlisi assistida); null = desactivat
  suggestion?: Suggestion | null;
  // Equip que guanya aquest punt segons l'acta (si se sap)
  expectedWinner?: Side | null;
}

const ZONES_KEY = 'svidia.zonesMode';

function readZonesMode(): boolean {
  try {
    return localStorage.getItem(ZONES_KEY) === '1';
  } catch {
    return false;
  }
}

// Panell tàctil: jugador (tocant el camp) → fonament → [tipus] → qualificació → [origen i destinació]
export function ActionPad({ state, selection, setSelection, names, colors, players, flipped, send, suggestion, expectedWinner }: Props) {
  const { t } = useTranslation();
  const [skill, setSkill] = useState<Skill | null>(null);
  const [skillType, setSkillType] = useState<SkillType | null>(null);
  const [pending, setPending] = useState<Evaluation | null>(null);
  const [start, setStart] = useState<Point2 | null>(null);
  const [zonesMode, setZonesMode] = useState(readZonesMode);
  const inPlay = state.phase === 'in_play';

  useEffect(() => {
    try {
      localStorage.setItem(ZONES_KEY, zonesMode ? '1' : '0');
    } catch {
      /* sense emmagatzematge */
    }
  }, [zonesMode]);

  function reset() {
    setSelection(null);
    setSkill(null);
    setSkillType(null);
    setPending(null);
    setStart(null);
  }

  // Si canvia la jugada (punt, desfer…) i el jugador ja no és al camp, es neteja
  useEffect(() => {
    if (selection && !onCourt(state.teams[selection.side]).includes(selection.player)) reset();
  }, [state.lastSeq]);

  function chooseSkill(s: Skill) {
    setSkill(s);
    // Servei sense jugador: el fa qui és a la posició I de l'equip que serveix
    if (s === 'S' && (!selection || selection.side !== state.serving)) {
      setSelection({ side: state.serving, player: onCourt(state.teams[state.serving])[0] });
    }
  }

  // Accepta una proposta: jugador i fonament en un sol toc
  function accept(a: SuggestedAction, player: number) {
    setSelection({ side: a.side, player });
    setSkill(a.skill);
    setSkillType(null);
  }

  async function commit(evaluation: Evaluation, s: Point2 | null, e: Point2 | null) {
    if (!selection || !skill) return;
    const ok = await send({
      type: 'action',
      side: selection.side,
      player: selection.player,
      skill,
      skillType,
      evaluation,
      startZone: s ? (zoneAt(s)?.zone ?? null) : null,
      endZone: e ? (zoneAt(e)?.zone ?? null) : null,
      start: s,
      end: e,
    });
    if (ok) reset();
  }

  function chooseEval(ev: Evaluation) {
    if (zonesMode) {
      setPending(ev);
      setStart(null);
    } else void commit(ev, null, null);
  }

  function onTap(p: Point2) {
    if (!pending) return;
    if (!start) setStart(p);
    else void commit(pending, start, p);
  }

  const selPlayer = selection ? players[selection.side].get(selection.player) : null;

  return (
    <section className="card action-pad stack">
      <div className="row between wrap">
        <div className="ap-selected" style={selection ? { ['--team' as string]: colors[selection.side] } : undefined}>
          {selection ? (
            <>
              <span className="ap-team">{names[selection.side]}</span>
              <span className="mono ap-num">{selection.player}</span>
              <span>{selPlayer ? playerDisplayName(selPlayer.players) : ''}</span>
            </>
          ) : (
            <span className="muted">{t('code.pickPlayer')}</span>
          )}
        </div>
        <div className="row wrap">
          <label className="check small">
            <input type="checkbox" checked={zonesMode} onChange={(e) => setZonesMode(e.target.checked)} />
            {t('code.zonesMode')}
          </label>
          {(selection || skill) && (
            <button className="btn btn-sm" onClick={reset}>
              {t('common.cancel')}
            </button>
          )}
        </div>
      </div>

      {suggestion && !skill && !pending && (
        <div className="ap-suggest" aria-label={t('recognition.suggest.title')}>
          <span className="small muted">{t('recognition.suggest.title')}</span>
          {[suggestion.primary, ...suggestion.alternatives].flatMap((a, ai) =>
            a.candidates.slice(0, ai === 0 ? 3 : 1).map((c, ci) => {
              const p = players[a.side].get(c.player);
              return (
                <button
                  key={`${ai}-${c.player}`}
                  className={`chip-btn ap-suggest-chip ${ai === 0 && ci === 0 ? 'on' : ''} ${ai > 0 ? 'alt' : ''}`}
                  style={{ ['--team' as string]: colors[a.side] }}
                  onClick={() => accept(a, c.player)}
                  title={`${names[a.side]} · ${t(`skills.${a.skill}`)} · ${p ? playerDisplayName(p.players) : c.player}`}
                >
                  <span className="mono">{suggestionPrefix(a, c.player)}</span>
                  <span className="small">{t(`skills.${a.skill}`)}</span>
                  {c.label && <span className="small muted-on">{c.label}</span>}
                </button>
              );
            }),
          )}
        </div>
      )}

      <div className="ap-skills">
        {SKILLS.map((s) => (
          <button
            key={s}
            className={`ap-btn ${skill === s ? 'on' : ''}`}
            disabled={!inPlay || (!selection && s !== 'S') || !!pending}
            onClick={() => chooseSkill(s)}
          >
            <span className="mono ap-key">{s}</span>
            <span className="ap-label">{t(`skills.${s}`)}</span>
          </button>
        ))}
      </div>

      {skill && (
        <div className="ap-types">
          {SKILL_TYPES.map((ty) => (
            <button
              key={ty}
              className={`ap-type ${skillType === ty ? 'on' : ''}`}
              onClick={() => setSkillType(skillType === ty ? null : ty)}
              title={t(`skillTypes.${ty}`)}
              disabled={!!pending}
            >
              <span className="mono">{ty}</span> <span className="small">{t(`skillTypes.${ty}`)}</span>
            </button>
          ))}
        </div>
      )}

      {skill && (
        <div className="ap-evals">
          {EVALUATIONS.map((ev) => {
            const w = selection ? pointWinner({ side: selection.side, skill, evaluation: ev }) : null;
            return (
              <button
                key={ev}
                className={`ap-eval ${pending === ev ? 'on' : ''} ${w ? (w === selection?.side ? 'win' : 'lose') : ''} ${w && expectedWinner && w !== expectedWinner ? 'acta-against' : ''}`}
                title={w && expectedWinner && w !== expectedWinner ? t('recognition.acta.againstActa', { team: names[expectedWinner] }) : undefined}
                onClick={() => chooseEval(ev)}
                disabled={!!pending && pending !== ev}
              >
                <span className="mono ap-symbol">{ev}</span>
                <span className="ap-label">{t(`evals.${skill}.${EVAL_KEY[ev]}`)}</span>
              </button>
            );
          })}
        </div>
      )}

      {pending && (
        <div className="stack">
          <div className="row between wrap">
            <strong>{start ? t('code.tapEnd') : t('code.tapStart')}</strong>
            <button className="btn btn-sm" onClick={() => void commit(pending, start, null)}>
              {t('code.saveWithout')}
            </button>
          </div>
          <CourtMap
            flipped={flipped}
            start={start}
            end={null}
            onTap={onTap}
            colors={{ left: colors[flipped ? 'A' : 'H'], right: colors[flipped ? 'H' : 'A'] }}
          />
        </div>
      )}
    </section>
  );
}
