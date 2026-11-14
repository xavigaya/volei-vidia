-- =====================================================================
-- Volei VidIA — Recepció per defecte del club
--
-- Sistema de recepció que s'aplica, per a cada sistema de joc, a tots els
-- equips i partits del club que no en tenen un de propi. Es crea des de la
-- pestanya Anàlisi assistida a partir de la recepció d'un equip.
-- Ordre d'aplicació: recepció de l'equip → recepció per defecte del club →
-- plantilla calculada.
-- =====================================================================

create table if not exists public.club_reception_defaults (
  club_id     uuid not null references public.clubs (id) on delete cascade,
  system      text not null check (system in ('51', '51m', '62', '42')),
  template    text not null default 'R3' check (template in ('R2', 'R3', 'R4', 'R5')),
  has_libero  boolean not null default true,
  rotations   jsonb not null default '{}'::jsonb,
  -- Equip i partit d'on es va copiar (informatiu)
  source_team_id  uuid references public.teams (id) on delete set null,
  source_match_id uuid references public.matches (id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  primary key (club_id, system)
);

create or replace function public.touch_reception_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists club_reception_defaults_touch on public.club_reception_defaults;
create trigger club_reception_defaults_touch before insert or update on public.club_reception_defaults
  for each row execute function public.touch_reception_default();

alter table public.club_reception_defaults enable row level security;

drop policy if exists club_reception_defaults_select on public.club_reception_defaults;
create policy club_reception_defaults_select on public.club_reception_defaults
  for select using (public.is_club_member(club_id));
drop policy if exists club_reception_defaults_write on public.club_reception_defaults;
create policy club_reception_defaults_write on public.club_reception_defaults
  for all using (public.has_club_role(club_id, array['admin','analyst']::public.club_role[]))
  with check (public.has_club_role(club_id, array['admin','analyst']::public.club_role[]));
