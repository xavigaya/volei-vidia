import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { playerDisplayName, type MatchPlayer, type SideCode } from '../lib/types';
import type { Side, TeamLineup } from '../engine/match';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

interface Props {
  setNumber: number;
  isTiebreak: boolean;
  players: MatchPlayer[];
  teamNames: Record<SideCode, string>;
  initial: { home: TeamLineup; away: TeamLineup; serving: Side } | null;
  onSubmit: (v: { home: TeamLineup; away: TeamLineup; serving: Side }) => Promise<string | null>;
  onCancel: () => void;
  // Avís a sobre del formulari (p. ex. "formació presa de l'acta")
  note?: string | null;
  // Formació alternativa que es pot aplicar amb un botó (p. ex. la de l'acta)
  alternative?: { label: string; value: { home: TeamLineup; away: TeamLineup; serving: Side } } | null;
}

function playerName(list: MatchPlayer[], n: number): string {
  const p = list.find((x) => x.shirt_number === n);
  return p ? playerDisplayName(p.players) : '';
}

function middlesOf(players: MatchPlayer[], side: SideCode): number[] {
  return players.filter((p) => p.side === side && p.position === 'MB').map((p) => p.shirt_number);
}

function blank(players: MatchPlayer[], side: SideCode): TeamLineup {
  const liberos = players.filter((p) => p.side === side && p.is_libero).map((p) => p.shirt_number);
  const middles = middlesOf(players, side);
  return { positions: [-1, -1, -1, -1, -1, -1], liberos, middles, autoLibero: liberos.length > 0 && middles.length > 0 };
}

export function LineupForm({ setNumber, isTiebreak, players, teamNames, initial, onSubmit, onCancel, note, alternative }: Props) {
  const { t } = useTranslation();
  const [home, setHome] = useState<TeamLineup>(
    initial ? { ...initial.home, middles: middlesOf(players, 'H') } : blank(players, 'H'),
  );
  const [away, setAway] = useState<TeamLineup>(
    initial ? { ...initial.away, middles: middlesOf(players, 'A') } : blank(players, 'A'),
  );
  const [serving, setServing] = useState<Side>(initial?.serving ?? 'H');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bySide = useMemo(
    () => ({
      H: players.filter((p) => p.side === 'H'),
      A: players.filter((p) => p.side === 'A'),
    }),
    [players],
  );

  function teamBlock(side: SideCode, value: TeamLineup, setValue: (v: TeamLineup) => void) {
    const list = bySide[side];
    const field = list.filter((p) => !value.liberos.includes(p.shirt_number));
    const liberoCandidates = list.filter((p) => p.is_libero || value.liberos.includes(p.shirt_number));
    const used = new Set(value.positions);
    return (
      <fieldset className="lineup-team card">
        <legend>{teamNames[side]}</legend>
        <div className="row wrap lineup-tools">
          <button
            type="button"
            className="btn btn-sm"
            title={t('live.rotateForwardHelp')}
            onClick={() => setValue({ ...value, positions: value.positions.map((_, i) => value.positions[(i + 1) % 6]) })}
          >
            ↻ {t('live.rotateForward')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            title={t('live.rotateBackHelp')}
            onClick={() => setValue({ ...value, positions: value.positions.map((_, i) => value.positions[(i + 5) % 6]) })}
          >
            ↺ {t('live.rotateBack')}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setValue({ ...value, positions: [-1, -1, -1, -1, -1, -1] })}>
            ✕ {t('live.clearPositions')}
          </button>
        </div>
        {list.length === 0 && <p className="warn small">{t('matches.noPlayersCalled')}</p>}
        <div className="lineup-grid">
          {/* Disposició com al camp: IV III II a dalt, V VI I a baix */}
          {[3, 2, 1, 4, 5, 0].map((idx) => (
            <label key={idx} className="field lineup-slot">
              <span>{ROMAN[idx]}</span>
              <select
                value={value.positions[idx]}
                onChange={(e) => {
                  const positions = [...value.positions];
                  positions[idx] = Number(e.target.value);
                  setValue({ ...value, positions });
                }}
                required
              >
                <option value={-1}>—</option>
                {field.map((p) => (
                  <option
                    key={p.player_id}
                    value={p.shirt_number}
                    disabled={used.has(p.shirt_number) && value.positions[idx] !== p.shirt_number}
                  >
                    {p.shirt_number} · {playerDisplayName(p.players)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {value.liberos.length > 0 && (
          <label className="check">
            <input
              type="checkbox"
              checked={!!value.autoLibero}
              onChange={(e) => setValue({ ...value, autoLibero: e.target.checked })}
            />
            <span>
              {t('live.autoLibero')}
              <br />
              <small className="muted">
                {value.middles && value.middles.length > 0
                  ? t('live.autoLiberoMiddles', { list: value.middles.join(', ') })
                  : t('live.autoLiberoNoMiddles')}
              </small>
            </span>
          </label>
        )}
        {value.autoLibero && value.liberos.length > 1 && (
          <label className="row small">
            <span className="muted">{t('live.defaultLibero')}</span>
            <select
              value={value.defaultLibero ?? value.liberos[0]}
              onChange={(e) => setValue({ ...value, defaultLibero: Number(e.target.value) })}
            >
              {value.liberos.map((n) => (
                <option key={n} value={n}>
                  {n} · {playerName(list, n)}
                </option>
              ))}
            </select>
          </label>
        )}
        {liberoCandidates.length > 0 && (
          <div className="row wrap">
            <span className="small muted">{t('positions.L')}:</span>
            {liberoCandidates.map((p) => (
              <label key={p.player_id} className="check">
                <input
                  type="checkbox"
                  checked={value.liberos.includes(p.shirt_number)}
                  disabled={!value.liberos.includes(p.shirt_number) && value.liberos.length >= 2}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      liberos: e.target.checked
                        ? [...value.liberos, p.shirt_number]
                        : value.liberos.filter((n) => n !== p.shirt_number),
                      positions: value.positions.map((n) => (e.target.checked && n === p.shirt_number ? -1 : n)),
                    })
                  }
                />
                <span className="mono">{p.shirt_number}</span> {playerDisplayName(p.players)}
              </label>
            ))}
          </div>
        )}
      </fieldset>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if ([...home.positions, ...away.positions].some((n) => n < 0)) {
      setError(t('live.lineupIncomplete'));
      return;
    }
    setBusy(true);
    // Els centrals es prenen sempre de la convocatòria actual
    const fix = (l: TeamLineup, side: SideCode): TeamLineup => ({
      ...l,
      middles: middlesOf(players, side),
      autoLibero: !!l.autoLibero && l.liberos.length > 0,
    });
    setError(await onSubmit({ home: fix(home, 'H'), away: fix(away, 'A'), serving }));
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="stack">
      {note && <p className="notice small">{note}</p>}
      {alternative && (
        <div className="row wrap">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setHome({ ...alternative.value.home, middles: middlesOf(players, 'H') });
              setAway({ ...alternative.value.away, middles: middlesOf(players, 'A') });
              setServing(alternative.value.serving);
            }}
          >
            {alternative.label}
          </button>
        </div>
      )}
      <p className="muted small">
        {t('live.lineupHelp', { set: setNumber })}
        {isTiebreak && <> {t('live.tiebreakToss')}</>}
      </p>
      <div className="grid-2">
        {teamBlock('H', home, setHome)}
        {teamBlock('A', away, setAway)}
      </div>
      <div className="row wrap">
        <span className="field-label">{t('live.firstServe')}:</span>
        <div className="segmented">
          {(['H', 'A'] as Side[]).map((s) => (
            <button key={s} type="button" className={serving === s ? 'on' : ''} onClick={() => setServing(s)}>
              {teamNames[s]}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="row end">
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {t('live.startSet', { set: setNumber })}
        </button>
      </div>
    </form>
  );
}
