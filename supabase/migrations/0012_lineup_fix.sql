-- =====================================================================
-- Volei VidIA — Correcció de l'alineació d'un set
-- L'aplicació permet corregir l'alineació inicial d'un set ja començat
-- (es reprodueix tot el set amb la correcció). Aquesta correcció queda
-- al registre d'accions com a "lineup_fix".
-- =====================================================================

create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_ignore text[] := array['created_at', 'updated_at'];
  v_club uuid;
  v_id text;
  v_action text := lower(tg_op);
begin
  -- Les baixes en cascada (p. ex. tot un club o tot un partit) no es registren
  -- fila per fila: ja hi ha l'entrada de l'element principal
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if tg_op = 'DELETE' then
    if tg_table_name <> 'clubs' and v_row ? 'club_id'
       and not exists (select 1 from public.clubs where id = (v_row ->> 'club_id')::uuid) then
      return null;
    end if;
    if tg_table_name in ('match_players', 'match_events')
       and not exists (select 1 from public.matches where id = (v_row ->> 'match_id')::uuid) then
      return null;
    end if;
    if tg_table_name = 'team_players'
       and (not exists (select 1 from public.teams where id = (v_row ->> 'team_id')::uuid)
            or not exists (select 1 from public.players where id = (v_row ->> 'player_id')::uuid)) then
      return null;
    end if;
  end if;

  if tg_table_name = 'matches' then
    -- El marcador es desa a cada punt: no és una acció de gestió
    v_ignore := v_ignore || array['home_sets', 'away_sets', 'set_scores'];
  elsif tg_table_name = 'match_events' then
    -- Només inicis de set i desfer
    if tg_op = 'INSERT' and v_row ->> 'type' = 'lineup' then
      v_action := 'set_start';
    elsif tg_op = 'UPDATE' and v_row ->> 'type' = 'lineup' and (v_new -> 'data') is distinct from (v_old -> 'data') then
      -- Correcció de l'alineació d'un set
      v_action := 'lineup_fix';
      v_changes := jsonb_build_object('data', jsonb_build_array(v_old -> 'data', v_new -> 'data'));
      perform public.audit_write(v_action, tg_table_name, v_row ->> 'match_id', (v_row ->> 'club_id')::uuid,
        public.audit_label(tg_table_name, v_row), v_changes);
      return null;
    elsif tg_op = 'DELETE' then
      v_action := 'undo';
    else
      return null;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if not (v_key = any (v_ignore)) and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_array(v_old -> v_key, v_new -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  elsif tg_table_name = 'match_events' then
    v_changes := jsonb_build_object('type', v_row -> 'type', 'set', v_row -> 'set_number', 'seq', v_row -> 'seq');
  else
    v_changes := v_row - v_ignore;
  end if;

  v_club := case
    when tg_table_name = 'clubs' then (v_row ->> 'id')::uuid
    when v_row ? 'club_id' then (v_row ->> 'club_id')::uuid
    else null
  end;
  v_id := case
    when v_row ? 'id' then v_row ->> 'id'
    when tg_table_name in ('match_players', 'match_events') then v_row ->> 'match_id'
    when tg_table_name = 'team_players' then v_row ->> 'team_id'
    when tg_table_name = 'club_members' then v_row ->> 'user_id'
    else null
  end;

  perform public.audit_write(v_action, tg_table_name, v_id, v_club, public.audit_label(tg_table_name, v_row), v_changes);
  return null;
end;
$$;
