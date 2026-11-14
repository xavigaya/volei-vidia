import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { PlayerPosition, SideCode } from '../lib/types';
import type { UseMatch } from '../matches/useMatch';
import { inferSystem, isSystemCode, type InferResult, type SystemCode, type TeamSystem } from './gameSystems';
import { isTemplateCode, newReceptionSystem, type ReceptionSystem } from './reception';
import type { Scoresheet } from './scoresheet';

interface SystemRow {
  side: SideCode;
  set_number: number;
  system: string;
  anchor: number;
}

interface ReceptionRow {
  team_id: string | null; // null = recepció per defecte del club
  system: string;
  template: string;
  has_libero: boolean;
  rotations: ReceptionSystem['rotations'];
}

// Sistema d'un equip en un set: el desat o, si no n'hi ha, el deduït
export interface SetTeamSystem {
  set: number;
  side: SideCode;
  lineup: number[];
  saved: TeamSystem | null;
  inferred: InferResult;
  current: TeamSystem | null;
}

const key = (side: SideCode, set: number) => `${side}${set}`;

function isMissingTable(message: string | undefined): boolean {
  return !!message && /relation .* does not exist|could not find the table|schema cache/i.test(message);
}

export function useRecognition(m: UseMatch) {
  const match = m.match!;
  const [systems, setSystems] = useState<Map<string, TeamSystem>>(new Map());
  const [receptions, setReceptions] = useState<ReceptionRow[]>([]);
  const [scoresheet, setScoresheet] = useState<Scoresheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missingMigration, setMissingMigration] = useState(false);
  // La migració 0015 (recepció per defecte del club) és opcional
  const [defaultsAvailable, setDefaultsAvailable] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [sys, rec, sheet, defs] = await Promise.all([
      supabase.from('match_team_systems').select('side, set_number, system, anchor').eq('match_id', match.id),
      supabase
        .from('team_reception_systems')
        .select('team_id, system, template, has_libero, rotations')
        .in('team_id', [match.home_team_id, match.away_team_id]),
      supabase.from('match_scoresheets').select('data').eq('match_id', match.id).maybeSingle(),
      supabase.from('club_reception_defaults').select('system, template, has_libero, rotations').eq('club_id', match.club_id),
    ]);
    const firstError = sys.error ?? rec.error ?? sheet.error;
    if (firstError) {
      if (isMissingTable(firstError.message)) setMissingMigration(true);
      else setError(firstError.message);
    } else {
      const map = new Map<string, TeamSystem>();
      for (const r of (sys.data ?? []) as SystemRow[]) {
        if (isSystemCode(r.system)) map.set(key(r.side, r.set_number), { code: r.system, anchor: r.anchor });
      }
      setSystems(map);
      const defaults = defs.error ? [] : ((defs.data ?? []) as Omit<ReceptionRow, 'team_id'>[]).map((d) => ({ ...d, team_id: null }));
      setDefaultsAvailable(!defs.error);
      setReceptions([...((rec.data ?? []) as ReceptionRow[]), ...defaults]);
      setScoresheet(((sheet.data as { data: Scoresheet } | null)?.data as Scoresheet) ?? null);
    }
    setLoading(false);
  }, [match.id, match.club_id, match.home_team_id, match.away_team_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const positionOf = useMemo(() => {
    const map = new Map<string, PlayerPosition>();
    for (const p of m.players) map.set(`${p.side}${p.shirt_number}`, p.position);
    return (side: SideCode) => (n: number) => map.get(`${side}${n}`);
  }, [m.players]);

  const setSystemsList: SetTeamSystem[] = useMemo(() => {
    const out: SetTeamSystem[] = [];
    for (const s of m.state?.sets ?? []) {
      for (const side of ['H', 'A'] as SideCode[]) {
        const lineup = s.startLineups[side].positions;
        const saved = systems.get(key(side, s.number)) ?? null;
        const inferred = inferSystem(lineup, positionOf(side));
        out.push({ set: s.number, side, lineup, saved, inferred, current: saved ?? inferred.system });
      }
    }
    return out;
  }, [m.state, systems, positionOf]);

  const saveSystems = useCallback(
    async (rows: { side: SideCode; set: number; system: TeamSystem }[]) => {
      const { error: e } = await supabase.from('match_team_systems').upsert(
        rows.map((r) => ({
          match_id: match.id,
          club_id: match.club_id,
          side: r.side,
          set_number: r.set,
          system: r.system.code,
          anchor: r.system.anchor,
        })),
      );
      if (e) return e.message;
      await load();
      return null;
    },
    [match.id, match.club_id, load],
  );

  const teamOf = useCallback((side: SideCode) => (side === 'H' ? match.home_team_id : match.away_team_id), [match]);

  // Sistema de recepció d'un equip: el seu, si no el per defecte del club i,
  // si no n'hi ha cap, la plantilla R3
  const receptionFor = useCallback(
    (side: SideCode, code: SystemCode, hasLibero: boolean): ReceptionSystem => {
      const row =
        receptions.find((r) => r.team_id === teamOf(side) && r.system === code) ??
        receptions.find((r) => r.team_id === null && r.system === code);
      if (!row) return newReceptionSystem(code, 'R3', hasLibero);
      return {
        system: code,
        template: isTemplateCode(row.template) ? row.template : 'R3',
        hasLibero: row.has_libero,
        rotations: row.rotations ?? {},
      };
    },
    [receptions, teamOf],
  );

  // D'on surt la recepció que es mostra
  const receptionSource = useCallback(
    (side: SideCode, code: SystemCode): 'team' | 'club' | 'template' => {
      if (receptions.some((r) => r.team_id === teamOf(side) && r.system === code)) return 'team';
      if (receptions.some((r) => r.team_id === null && r.system === code)) return 'club';
      return 'template';
    },
    [receptions, teamOf],
  );

  const isReceptionSaved = useCallback(
    (side: SideCode, code: SystemCode) => receptions.some((r) => r.team_id === teamOf(side) && r.system === code),
    [receptions, teamOf],
  );

  const saveReception = useCallback(
    async (side: SideCode, rs: ReceptionSystem) => {
      const { error: e } = await supabase.from('team_reception_systems').upsert({
        team_id: teamOf(side),
        club_id: match.club_id,
        system: rs.system,
        template: rs.template,
        has_libero: rs.hasLibero,
        rotations: rs.rotations,
      });
      if (e) return e.message;
      await load();
      return null;
    },
    [teamOf, match.club_id, load],
  );

  // Fa servir aquesta recepció per defecte a tots els equips i partits del club
  const saveClubDefault = useCallback(
    async (side: SideCode, rs: ReceptionSystem) => {
      const { error: e } = await supabase.from('club_reception_defaults').upsert({
        club_id: match.club_id,
        system: rs.system,
        template: rs.template,
        has_libero: rs.hasLibero,
        rotations: rs.rotations,
        source_team_id: teamOf(side),
        source_match_id: match.id,
      });
      if (e) return isMissingTable(e.message) ? 'missing_migration_0015' : e.message;
      await load();
      return null;
    },
    [match.club_id, match.id, teamOf, load],
  );

  const saveScoresheet = useCallback(
    async (data: Scoresheet) => {
      const { error: e } = await supabase
        .from('match_scoresheets')
        .upsert({ match_id: match.id, club_id: match.club_id, data });
      if (e) return e.message;
      setScoresheet(data);
      return null;
    },
    [match.id, match.club_id],
  );

  return {
    loading,
    error,
    missingMigration,
    setSystemsList,
    saveSystems,
    receptionFor,
    receptionSource,
    isReceptionSaved,
    saveClubDefault,
    defaultsAvailable,
    reload: load,
    saveReception,
    scoresheet,
    saveScoresheet,
    positionOf,
  };
}

export type UseRecognition = ReturnType<typeof useRecognition>;
