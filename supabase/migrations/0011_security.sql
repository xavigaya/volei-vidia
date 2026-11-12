-- =====================================================================
-- Volei VidIA — Reforç de seguretat (auditoria d'octubre de 2026)
--
--  1. audit_label() deixa de ser accessible des de l'API: era una funció
--     "security definer" que, cridada directament, retornava correus i noms
--     de qualsevol club a partir d'un identificador.
--  2. Les invitacions només s'accepten si el correu de l'usuari està
--     confirmat (evita que algú es registri amb el correu d'un convidat).
--  3. Registre restringit (opcional): funció per al hook "Before User
--     Created" de Supabase que només deixa crear comptes a correus amb una
--     invitació pendent. S'ha d'activar al tauler (vegeu el README).
--  4. log_action(): límit de mida de les dades i de freqüència per usuari,
--     perquè ningú no pugui omplir el registre d'auditoria.
--  5. Logotips: només PNG, JPEG o WebP (sense SVG) i com a màxim 1 MB.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. audit_label: només per a ús intern dels disparadors
-- ---------------------------------------------------------------------
-- (els disparadors la continuen fent servir: s'executen com a propietari)
revoke all on function public.audit_label(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Invitacions: cal el correu confirmat
-- ---------------------------------------------------------------------
create or replace function public.accept_pending_invitations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_count integer := 0;
  r record;
begin
  if auth.uid() is null then
    return 0;
  end if;
  -- El correu es llegeix de la base de dades (no del testimoni) i ha d'estar confirmat
  select lower(u.email::text) into v_email
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
  if v_email is null then
    return 0;
  end if;
  for r in
    select * from public.club_invitations
    where email = v_email and accepted_at is null
  loop
    insert into public.club_members (club_id, user_id, role)
    values (r.club_id, auth.uid(), r.role)
    on conflict (club_id, user_id) do nothing;
    update public.club_invitations set accepted_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.accept_pending_invitations() from public, anon;
grant execute on function public.accept_pending_invitations() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Registre només per a convidats (hook "Before User Created")
--    Supabase > Authentication > Hooks > Before User Created >
--    Postgres > public.hook_only_invited_signup
-- ---------------------------------------------------------------------
create or replace function public.hook_only_invited_signup(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if v_email <> '' and exists (
    select 1 from public.club_invitations
    where email = v_email and accepted_at is null
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Només es poden registrar les persones convidades per un club.'
    )
  );
end;
$$;

revoke all on function public.hook_only_invited_signup(jsonb) from public, anon, authenticated;
grant execute on function public.hook_only_invited_signup(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------------
-- 4. log_action amb límits
-- ---------------------------------------------------------------------
create or replace function public.log_action(
  p_action text,
  p_entity text,
  p_entity_id text default null,
  p_club uuid default null,
  p_summary text default null,
  p_details jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if p_action not in ('login', 'logout', 'export', 'import', 'upload', 'view') then
    raise exception 'bad_action';
  end if;
  if p_club is not null and not public.is_club_member(p_club) then
    raise exception 'not_allowed';
  end if;
  if p_details is not null and pg_column_size(p_details) > 4000 then
    raise exception 'details_too_large';
  end if;
  -- Com a màxim 60 entrades per minut i usuari: la resta s'ignoren
  if (select count(*) from public.audit_log
      where user_id = auth.uid() and at > now() - interval '1 minute') >= 60 then
    return;
  end if;
  perform public.audit_write(p_action, left(p_entity, 40), left(p_entity_id, 80), p_club, p_summary, p_details);
  if p_action = 'login' then
    perform public.audit_purge();
  end if;
end;
$$;

revoke all on function public.log_action(text, text, text, uuid, text, jsonb) from public, anon;
grant execute on function public.log_action(text, text, text, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Logotips: formats d'imatge sense codi i mida màxima
-- ---------------------------------------------------------------------
update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'],
       file_size_limit = 1048576
 where id = 'club-logos';
