import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useCurrentClub } from '../club/ClubProvider';
import { playerDisplayName, type MatchPlayer, type SideCode } from '../lib/types';
import { Modal } from '../components/ui';
import {
  applyEvent,
  EngineError,
  initialState,
  onCourt,
  suggestNextLineup,
  targetPoints,
  type MatchEvent,
  type MatchEventData,
  type MatchState,
  type Side,
} from '../engine/match';
import { eventCode, parseCommand, resolveAction } from '../engine/commands';
import { ActionPad, type Selection } from './ActionPad';
import { Legend, EVAL_KEY } from './Legend';
import { Court } from './Court';
import { LineupForm } from './LineupForm';
import type { UseMatch } from './useMatch';
import { VideoPanel, sourceFromMatch } from '../video/VideoPanel';
import { ClipsPanel } from '../video/ClipsPanel';
import type { PlayerHandle, VideoSource } from '../video/VideoPlayer';
import { formatTime } from '../video/youtube';
import { paramToFilter } from '../video/clips';
import { readAutoPause, writeAutoPause, type AutoPause } from '../video/autoPause';

const SIDES: Side[] = ['H', 'A'];

export function engineErrorText(t: TFunction, e: unknown): string {
  if (e instanceof EngineError) return t(`engine.${e.code}`, e.params);
  return e instanceof Error ? e.message : String(e);
}

function isTouch(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
}

// active = false: la pestanya està amagada (estadístiques, convocatòria). El
// component es manté muntat perquè el vídeo no es reiniciï, però s'atura i no
// escolta el teclat.
export function LiveScoring({ m, clipFilter, active = true }: { m: UseMatch; clipFilter?: string | null; active?: boolean }) {
  const { t } = useTranslation();
  const club = useCurrentClub();
  const match = m.match!;
  const state = m.state!;
  // Costat de cada equip a la pantalla (es recorda per partit en aquest dispositiu)
  const flipKey = `svidia.flip.${match.id}`;
  const [flip, setFlipState] = useState(() => {
    try {
      return localStorage.getItem(flipKey) === '1';
    } catch {
      return false;
    }
  });
  const setFlip = (f: (v: boolean) => boolean) =>
    setFlipState((v) => {
      const nv = f(v);
      try {
        localStorage.setItem(flipKey, nv ? '1' : '0');
      } catch {
        /* sense emmagatzematge */
      }
      return nv;
    });
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [lineupOpen, setLineupOpen] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const [subSide, setSubSide] = useState<Side | null>(null);
  const [liberoSide, setLiberoSide] = useState<Side | null>(null);
  const [command, setCommand] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const cmdRef = useRef<HTMLInputElement>(null);
  // Vídeo: cada acció desa l'instant on és el reproductor
  const playerRef = useRef<PlayerHandle | null>(null);
  const [source, setSource] = useState<VideoSource | null>(() => sourceFromMatch(match.video_url));
  const videoTime = useCallback(() => (source ? (playerRef.current?.getTime() ?? null) : null), [source]);
  // Pausa automàtica mentre s'escriu a la línia d'ordres
  const [autoPause, setAutoPauseState] = useState<AutoPause>(readAutoPause);
  const setAutoPause = (v: AutoPause) => {
    setAutoPauseState(v);
    writeAutoPause(v);
  };
  const autoPaused = useRef(false);
  const resumeTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
    },
    [],
  );
  const onTyping = () => {
    const p = playerRef.current;
    if (!source || !autoPause.enabled || !p) return;
    if (p.isPlaying()) {
      p.pause();
      autoPaused.current = true;
    }
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => {
      // Només es reprèn si l'havíem aturat nosaltres
      if (autoPaused.current) playerRef.current?.play();
      autoPaused.current = false;
    }, autoPause.delay * 1000);
  };
  useEffect(() => {
    if (!active) {
      if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
      autoPaused.current = false;
      playerRef.current?.pause();
    }
  }, [active]);
  const seekTo = (time: number | null | undefined) => {
    if (time == null || !playerRef.current) return;
    playerRef.current.seek(time - 3);
    playerRef.current.play();
  };

  const names: Record<SideCode, string> = { H: match.home.short_name ?? match.home.name, A: match.away.short_name ?? match.away.name };
  const colors: Record<SideCode, string> = {
    H: match.home.color ?? (match.home.is_own ? club.primary_color : '#5b6575'),
    A: match.away.color ?? (match.away.is_own ? club.primary_color : '#5b6575'),
  };

  const playerMaps = useMemo(() => {
    const maps: Record<SideCode, Map<number, MatchPlayer>> = { H: new Map(), A: new Map() };
    for (const p of m.players) maps[p.side].set(p.shirt_number, p);
    return maps;
  }, [m.players]);

  const canCode = m.canCode;
  const inPlay = state.phase === 'in_play';
  const nextSet = state.currentSet + 1;

  const send = useCallback(
    async (ev: MatchEventData | ((s: MatchState) => MatchEventData)) => {
      setMessage(null);
      const r = await m.append(ev, videoTime());
      if (!r.ok) {
        setMessage({ kind: 'error', text: engineErrorText(t, r.error) });
        return false;
      }
      const infos: string[] = [];
      for (const n of r.state.notices) {
        const [kind, side, libero, player] = n.split(':');
        if (kind === 'libero_auto_out') infos.push(t('live.liberoAutoOut', { team: names[side as Side], libero, player }));
        if (kind === 'libero_auto_in') infos.push(t('live.liberoAutoIn', { team: names[side as Side], libero, player }));
      }
      const lastSet = r.state.sets[r.state.sets.length - 1];
      if (r.state.phase !== 'in_play' && lastSet?.winner && (r.state.score.H + r.state.score.A > 0)) {
        infos.push(t('live.setOver', { set: lastSet.number, team: names[lastSet.winner] }));
      }
      if (infos.length) setMessage({ kind: 'info', text: infos.join(' ') });
      return true;
    },
    [m, t, names, videoTime],
  );

  // Obre l'alineació automàticament quan toca
  useEffect(() => {
    if (active && canCode && state.phase === 'awaiting_lineup' && m.players.length > 0) setLineupOpen(true);
  }, [active, canCode, state.phase, state.currentSet, m.players.length]);

  // Focus a la línia d'ordres en ordinador; Ctrl+Z desfà
  useEffect(() => {
    if (active && canCode && !isTouch()) cmdRef.current?.focus();
  }, [active, canCode, state.lastSeq]);

  useEffect(() => {
    if (!canCode || !active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' && target !== cmdRef.current) return;
        if (target === cmdRef.current && command) return;
        e.preventDefault();
        void m.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, canCode, command, m]);

  async function onCommand(e: FormEvent) {
    e.preventDefault();
    const r = parseCommand(command);
    if (!r.ok) {
      if (r.error !== 'empty') setMessage({ kind: 'error', text: `${t(`live.cmd.${r.error}`)} (${r.token})` });
      return;
    }
    for (const ev of r.events) {
      const ok = await send((st) => (ev.type === 'partial_action' ? resolveAction(st, ev) : ev));
      if (!ok) {
        // Es deixa a la línia només el que no s'ha pogut desar
        setCommand(command.trim().split(/\s+/).slice(r.events.indexOf(ev)).join(' '));
        return;
      }
    }
    setCommand('');
  }

  const log = useMemo(() => buildLog(m.events, state.rules), [m.events, state.rules]);
  // Alineació inicial del set en curs (o de l'últim jugat), per poder-la corregir
  const lineupEvent = useMemo(() => {
    for (let i = m.events.length - 1; i >= 0; i--) {
      const e = m.events[i];
      if (e.type === 'lineup') return e;
    }
    return null;
  }, [m.events]);

  return (
    <div className={`live-layout ${source ? 'with-video' : ''}`}>
      <div className="live-video">
        <VideoPanel
          m={m}
          source={source}
          setSource={setSource}
          playerRef={playerRef}
          autoPause={autoPause}
          setAutoPause={setAutoPause}
          active={active}
        />
        {source ? (
          <ClipsPanel
            events={m.events}
            rules={state.rules}
            playerRef={playerRef}
            names={names}
            players={playerMaps}
            initialFilter={paramToFilter(clipFilter ?? null)}
          />
        ) : (
          clipFilter && <div className="notice">{t('clips.needVideo')}</div>
        )}
      </div>
    <div className="live">
      {/* Marcador */}
      <section className="scoreboard card">
        {(flip ? (['A', 'H'] as Side[]) : SIDES).map((side, i) => (
          <div key={side} className={`sb-team ${i === 1 ? 'right' : ''}`} style={{ ['--team' as string]: colors[side] }}>
            <div className="sb-name">
              {inPlay && state.serving === side && <span className="sb-serve" title={t('live.serving')} />}
              {names[side]}
            </div>
            <div className="sb-sets mono">{state.setsWon[side]}</div>
            <div className="sb-points mono">{state.currentSet > 0 ? state.score[side] : '–'}</div>
            {inPlay && (
              <div className="sb-counters small">
                <span>
                  {t('live.timeoutsShort')} {state.teams[side].timeoutsUsed}/{state.rules.timeoutsPerSet}
                </span>
                <span>
                  {t('live.subsShort')} {state.teams[side].subsUsed}/{state.rules.maxSubstitutions}
                </span>
              </div>
            )}
          </div>
        ))}
        <div className="sb-middle">
          <div className="sb-set">
            {state.phase === 'match_over'
              ? t('live.final')
              : state.currentSet > 0
                ? t('live.setN', { n: state.currentSet })
                : t('live.notStarted')}
          </div>
          {inPlay && <div className="small muted">{t('live.to', { n: targetPoints(state) })}</div>}
          <button className="btn btn-sm sb-swap" onClick={() => setFlip((f) => !f)} title={t('live.swapSides')}>
            ⇄ {t('live.swapSidesShort')}
          </button>
          <div className="sb-history mono small">
            {state.sets
              .filter((s) => s.winner)
              .map((s) => (
                <span key={s.number}>{flip ? `${s.away}-${s.home}` : `${s.home}-${s.away}`}</span>
              ))}
          </div>
        </div>
      </section>

      {message && (
        <div className={message.kind === 'error' ? 'error-box' : 'notice'} role="status">
          {message.text}
        </div>
      )}
      {state.phase === 'match_over' && (
        <div className="notice final-banner">{t('live.matchWon', { team: names[state.winner!], h: state.setsWon.H, a: state.setsWon.A })}</div>
      )}
      {m.replayErrors.length > 0 && <div className="error-box">{t('live.replayErrors', { count: m.replayErrors.length })}</div>}

      {/* Camp */}
      {state.currentSet > 0 && (
        <section className="courts">
          {(flip ? (['A', 'H'] as Side[]) : SIDES).map((side, i) => (
            <div key={side} className="court-wrap">
              <Court
                team={state.teams[side]}
                players={playerMaps[side]}
                serving={inPlay && state.serving === side}
                netOnRight={i === 0}
                color={colors[side]}
                selected={selection?.side === side ? selection.player : null}
                onPlayerClick={canCode && inPlay ? (n) => setSelection({ side, player: n }) : undefined}
              />
            </div>
          ))}
          <div className="net" aria-hidden="true" />
        </section>
      )}

      {/* Codificació d'accions */}
      {canCode && inPlay && (
        <ActionPad
          state={state}
          selection={selection}
          setSelection={setSelection}
          names={names}
          colors={colors}
          players={playerMaps}
          flipped={flip}
          send={send}
        />
      )}

      {/* Marcador manual */}
      {canCode && (
        <section className="actions">
          {(flip ? (['A', 'H'] as Side[]) : SIDES).map((side) => (
            <div key={side} className="action-col" style={{ ['--team' as string]: colors[side] }}>
              <button className="btn btn-point" disabled={!inPlay} onClick={() => void send({ type: 'point', side })}>
                {t('live.point')} {names[side]}
              </button>
              <div className="action-row">
                <button
                  className="btn btn-error"
                  disabled={!inPlay}
                  title={t('live.errorHelp', { team: names[side] })}
                  onClick={() => void send({ type: 'point', side: side === 'H' ? 'A' : 'H', error: true })}
                >
                  {t('live.error')}
                </button>
                <button className="btn" disabled={!inPlay} onClick={() => void send({ type: 'timeout', side })}>
                  {t('live.timeout')}
                </button>
                <button className="btn" disabled={!inPlay} onClick={() => setSubSide(side)}>
                  {t('live.sub')}
                </button>
                <button className="btn" disabled={!inPlay || state.teams[side].liberos.length === 0} onClick={() => setLiberoSide(side)}>
                  {t('positions.L')}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {canCode && (
        <section className="command-bar card">
          <form onSubmit={onCommand} className="row">
            <input
              ref={cmdRef}
              className="mono cmd-input"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setCommand('');
                // Les dreceres amb Ctrl (vídeo, desfer) no compten com a escriure
                if (!e.ctrlKey && !e.metaKey && !e.altKey) onTyping();
              }}
              placeholder={t('live.cmdPlaceholder')}
              aria-label={t('live.cmdLabel')}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <button className="btn">↵</button>
          </form>
          <div className="row wrap toolbar">
            {state.phase === 'awaiting_lineup' && (
              <button className="btn btn-primary" onClick={() => setLineupOpen(true)} disabled={m.players.length === 0}>
                {t('live.lineupForSet', { n: nextSet })}
              </button>
            )}
            {lineupEvent && (
              <button className="btn" onClick={() => setFixOpen(true)} title={t('live.fixLineupHelp')}>
                ✎ {t('live.fixLineup', { n: lineupEvent.set })}
              </button>
            )}
            <button className="btn" onClick={() => void m.undo()} disabled={m.events.length === 0} title="Ctrl+Z">
              ↶ {t('live.undo')}
            </button>
            <button className="btn cmd-help" onClick={() => setLegendOpen(true)}>
              {t('legend.title')}
            </button>
          </div>
        </section>
      )}

      {/* Registre */}
      <section className="card event-log">
        <h2>{t('live.log')}</h2>
        {log.length === 0 ? (
          <p className="muted">{t('live.logEmpty')}</p>
        ) : (
          <ol reversed>
            {log
              .slice()
              .reverse()
              .slice(0, 60)
              .map((row) => (
                <li key={row.ev.seq} className={`log-${row.ev.type}`}>
                  <span className="mono log-score">
                    {row.set > 0 && `S${row.set} `}
                    {row.h}-{row.a}
                  </span>
                  <span className="mono log-code">{eventCode(row.ev)}</span>
                  <span>{describe(t, row.ev, names, playerMaps)}</span>
                  {source && (
                    <span className="log-time">
                      <button
                        className="btn-link mono small"
                        disabled={row.ev.videoTime == null}
                        onClick={() => seekTo(row.ev.videoTime)}
                        title={t('video.goTo')}
                      >
                        {formatTime(row.ev.videoTime)}
                      </button>
                      {canCode && (
                        <button
                          className="btn-icon small"
                          title={t('video.setTime')}
                          onClick={() => {
                            const now = playerRef.current?.getTime();
                            if (now != null) void m.setEventTime(row.ev.seq, now);
                          }}
                        >
                          ⏱
                        </button>
                      )}
                    </span>
                  )}
                </li>
              ))}
          </ol>
        )}
      </section>

      <Modal title={t('legend.title')} open={legendOpen && active} onClose={() => setLegendOpen(false)}>
        <Legend />
      </Modal>

      <Modal title={t('live.lineupForSet', { n: nextSet })} open={lineupOpen && active && state.phase === 'awaiting_lineup'} onClose={() => setLineupOpen(false)}>
        <LineupForm
          setNumber={nextSet}
          isTiebreak={nextSet === state.rules.setsToWin * 2 - 1}
          players={m.players}
          teamNames={{ H: match.home.name, A: match.away.name }}
          initial={suggestNextLineup(state)}
          onCancel={() => setLineupOpen(false)}
          onSubmit={async (v) => {
            const r = await m.append({ type: 'lineup', ...v }, videoTime());
            if (!r.ok) return engineErrorText(t, r.error);
            setLineupOpen(false);
            setMessage(null);
            return null;
          }}
        />
      </Modal>

      <Modal
        title={lineupEvent ? t('live.fixLineup', { n: lineupEvent.set }) : ''}
        open={fixOpen && !!lineupEvent && active}
        onClose={() => setFixOpen(false)}
      >
        {lineupEvent && lineupEvent.type === 'lineup' && (
          <>
            <p className="notice small">{t('live.fixLineupHelp')}</p>
            <LineupForm
              setNumber={lineupEvent.set}
              isTiebreak={lineupEvent.set === state.rules.setsToWin * 2 - 1}
              players={m.players}
              teamNames={{ H: match.home.name, A: match.away.name }}
              initial={{ home: lineupEvent.home, away: lineupEvent.away, serving: lineupEvent.serving }}
              onCancel={() => setFixOpen(false)}
              onSubmit={async (v) => {
                const r = await m.editEvent(lineupEvent.seq, { type: 'lineup', ...v });
                if (!r.ok) {
                  const ev = m.events.find((e) => e.seq === r.seq);
                  return t('live.fixLineupInvalid', {
                    what: ev ? `${eventCode(ev)} (${describe(t, ev, names, playerMaps)})` : `#${r.seq}`,
                    reason: engineErrorText(t, r.error),
                  });
                }
                setFixOpen(false);
                setMessage({ kind: 'info', text: t('live.fixLineupDone', { n: lineupEvent.set }) });
                return null;
              }}
            />
          </>
        )}
      </Modal>

      <Modal title={subSide ? `${t('live.sub')} · ${names[subSide]}` : ''} open={subSide !== null && active} onClose={() => setSubSide(null)}>
        {subSide && (
          <SubForm
            state={state}
            side={subSide}
            players={playerMaps[subSide]}
            onDone={async (out, inn) => {
              if (await send({ type: 'sub', side: subSide, out, in: inn })) setSubSide(null);
            }}
          />
        )}
      </Modal>

      <Modal title={liberoSide ? `${t('positions.L')} · ${names[liberoSide]}` : ''} open={liberoSide !== null && active} onClose={() => setLiberoSide(null)}>
        {liberoSide && (
          <LiberoForm
            state={state}
            side={liberoSide}
            onDone={async (libero, player) => {
              if (await send({ type: 'libero', side: liberoSide, libero, player })) setLiberoSide(null);
            }}
          />
        )}
      </Modal>
    </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Canvis: només s'ofereixen les combinacions reglamentàries
// ---------------------------------------------------------------------
function isValid(state: MatchState, ev: MatchEventData): boolean {
  try {
    applyEvent(state, ev);
    return true;
  } catch {
    return false;
  }
}

function label(n: number, players: Map<number, MatchPlayer>) {
  const p = players.get(n);
  return (
    <>
      <span className="mono pick-num">{n}</span>
      <span className="pick-name">{p ? playerDisplayName(p.players) : ''}</span>
    </>
  );
}

function SubForm({
  state,
  side,
  players,
  onDone,
}: {
  state: MatchState;
  side: Side;
  players: Map<number, MatchPlayer>;
  onDone: (out: number, inn: number) => void;
}) {
  const { t } = useTranslation();
  const [out, setOut] = useState<number | null>(null);
  const team = state.teams[side];
  const bench = [...players.keys()].filter((n) => !team.lineup.includes(n) && !team.liberos.includes(n)).sort((a, b) => a - b);
  const candidates = out === null ? [] : bench.filter((n) => isValid(state, { type: 'sub', side, out, in: n }));

  return (
    <div className="stack">
      <p className="muted small">
        {t('live.subsUsed', { used: team.subsUsed, max: state.rules.maxSubstitutions })}
      </p>
      <h3>{t('live.subOut')}</h3>
      <div className="pick-grid">
        {team.lineup.map((n) => {
          const possible = bench.some((b) => isValid(state, { type: 'sub', side, out: n, in: b }));
          return (
            <button key={n} type="button" className={`pick ${out === n ? 'on' : ''}`} disabled={!possible} onClick={() => setOut(n)}>
              {label(n, players)}
            </button>
          );
        })}
      </div>
      {out !== null && (
        <>
          <h3>{t('live.subIn')}</h3>
          {candidates.length === 0 ? (
            <p className="muted">{t('live.noCandidates')}</p>
          ) : (
            <div className="pick-grid">
              {candidates.map((n) => (
                <button key={n} type="button" className="pick" onClick={() => onDone(out, n)}>
                  {label(n, players)}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LiberoForm({
  state,
  side,
  onDone,
}: {
  state: MatchState;
  side: Side;
  onDone: (libero: number, player: number) => void;
}) {
  const { t } = useTranslation();
  const team = state.teams[side];
  const options: { libero: number; player: number; kind: 'in' | 'out' | 'swap' }[] = [];
  for (const l of team.liberos) {
    for (const p of [...team.lineup, ...team.liberos]) {
      if (p === l) continue;
      if (!isValid(state, { type: 'libero', side, libero: l, player: p })) continue;
      const kind = team.libero?.libero === l ? 'out' : team.libero?.libero === p ? 'swap' : 'in';
      options.push({ libero: l, player: p, kind });
    }
  }
  const court = onCourt(team);

  return (
    <div className="stack">
      {options.length === 0 ? (
        <p className="muted">{t('live.noLiberoOptions')}</p>
      ) : (
        <div className="pick-grid wide">
          {options.map((o) => (
            <button key={`${o.libero}-${o.player}`} type="button" className="pick" onClick={() => onDone(o.libero, o.player)}>
              <span className="mono pick-num">{o.libero}</span>
              <span className="pick-name">
                {o.kind === 'in' && t('live.liberoIn', { player: o.player, pos: ['I', 'II', 'III', 'IV', 'V', 'VI'][court.indexOf(o.player)] })}
                {o.kind === 'out' && t('live.liberoOut', { player: o.player })}
                {o.kind === 'swap' && t('live.liberoSwap', { player: o.player })}
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="small muted">{t('live.liberoRules')}</p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Registre d'esdeveniments amb el marcador després de cadascun
// ---------------------------------------------------------------------
function buildLog(events: MatchEvent[], rules: MatchState['rules']) {
  let s = initialState(rules);
  const rows: { ev: MatchEvent; set: number; h: number; a: number }[] = [];
  for (const ev of events) {
    try {
      s = applyEvent(s, ev);
    } catch {
      /* esdeveniment invàlid: es mostra igualment */
    }
    rows.push({ ev, set: s.currentSet, h: s.score.H, a: s.score.A });
  }
  return rows;
}

function describe(
  t: TFunction,
  ev: MatchEvent,
  names: Record<SideCode, string>,
  maps: Record<SideCode, Map<number, MatchPlayer>>,
): string {
  const who = (side: Side, n: number) => {
    const p = maps[side].get(n);
    return p ? `${n} ${playerDisplayName(p.players)}` : String(n);
  };
  switch (ev.type) {
    case 'lineup':
      return t('live.desc.lineup', { set: ev.set, team: names[ev.serving] });
    case 'point':
      return ev.error
        ? t('live.desc.error', { team: names[ev.side === 'H' ? 'A' : 'H'], other: names[ev.side] })
        : t('live.desc.point', { team: names[ev.side] });
    case 'timeout':
      return t('live.desc.timeout', { team: names[ev.side] });
    case 'sub':
      return t('live.desc.sub', { team: names[ev.side], out: who(ev.side, ev.out), in: who(ev.side, ev.in) });
    case 'libero':
      return t('live.desc.libero', { team: names[ev.side], libero: who(ev.side, ev.libero), player: who(ev.side, ev.player) });
    case 'action': {
      const zones = ev.startZone || ev.endZone ? ` · ${ev.startZone ?? '?'}→${ev.endZone ?? '?'}` : '';
      return `${names[ev.side]} ${who(ev.side, ev.player)}: ${t(`skills.${ev.skill}`)} · ${t(`evals.${ev.skill}.${EVAL_KEY[ev.evaluation]}`)}${zones}`;
    }
  }
}
