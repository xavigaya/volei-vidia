-- =====================================================================
-- Volei VidIA — Sincronització del vídeo per trams
--
-- Es pot sincronitzar el vídeo a partir d'una acció i aplicar-ho només a
-- aquella acció i les següents. Així, si el vídeo s'ha aturat o tallat (p.
-- ex. entre sets), es torna a sincronitzar des del punt on es desquadra.
-- Les accions importades de DataVolley porten l'hora del fitxer, de manera
-- que també es poden sincronitzar.
-- =====================================================================

drop function if exists public.sync_match_video(uuid, integer, double precision, boolean);

create or replace function public.sync_match_video(
  p_match uuid,
  p_seq integer,
  p_time double precision,
  p_only_missing boolean default true,
  p_from_here boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anchor timestamptz;
  v_count integer;
begin
  if not public.can_code_match(p_match) then
    raise exception 'not_allowed';
  end if;
  select created_at into v_anchor from public.match_events where match_id = p_match and seq = p_seq;
  if v_anchor is null then
    raise exception 'event_not_found';
  end if;
  update public.match_events
     set video_time = greatest(0, p_time + extract(epoch from (created_at - v_anchor)))
   where match_id = p_match
     and (not p_from_here or seq >= p_seq)
     and (not p_only_missing or video_time is null or seq = p_seq);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.sync_match_video(uuid, integer, double precision, boolean, boolean) from public, anon;
grant execute on function public.sync_match_video(uuid, integer, double precision, boolean, boolean) to authenticated;
