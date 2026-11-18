-- =====================================================================
-- Volei VidIA — Reconeixement de jugades, fase 0.1
--
--  * Sistema de joc de cada equip a cada set (5-1, 6-2, 4-2 i ordre).
--  * Sistemes de recepció guardats per equip (per a cada sistema de joc).
--  * Dades de l'acta oficial per verificar el partit codificat.
--
-- No modifica cap taula existent: si no es fan servir, l'aplicació
-- funciona exactament igual.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Sistema de joc per partit, equip i set
-- ---------------------------------------------------------------------
create table if not exists public.match_team_systems (
  match_id    uuid not null references public.matches (id) on delete cascade,
  club_id     uuid not null references public.clubs (id) on delete cascade,
  side        text not null check (side in ('H', 'A')),
  set_number  integer not null check (set_number between 1 and 5),
  system      text not null check (system in ('51', '51m', '62', '42')),
  -- Posició (0..5 = I..VI) del col·locador de referència a la formació inicial
  anchor      integer not null check (anchor between 0 and 5),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  primary key (match_id, side, set_number)
);

create index if not exists match_team_systems_club_idx on public.match_team_systems (club_id);

-- ---------------------------------------------------------------------
-- Sistemes de recepció per equip i sistema de joc
-- ---------------------------------------------------------------------
create table if not exists public.team_reception_systems (
  team_id     uuid not null references public.teams (id) on delete cascade,
  club_id     uuid not null references public.clubs (id) on delete cascade,
  system      text not null check (system in ('51', '51m', '62', '42')),
  template    text not null default 'R3' check (template in ('R2', 'R3', 'R4', 'R5')),
  has_libero  boolean not null default true,
  -- Rotacions personalitzades: {"1": {"spots": {"S": {"l": 7.5, "d": 7}, ...}, "receivers": ["L", ...]}, ...}
  rotations   jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  primary key (team_id, system)
);

create index if not exists team_reception_systems_club_idx on public.team_reception_systems (club_id);

-- ---------------------------------------------------------------------
-- Dades de l'acta oficial (per verificar el partit codificat)
-- ---------------------------------------------------------------------
create table if not exists public.match_scoresheets (
  match_id    uuid primary key references public.matches (id) on delete cascade,
  club_id     uuid not null references public.clubs (id) on delete cascade,
  data        jsonb not null default '{"sets": []}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

create index if not exists match_scoresheets_club_idx on public.match_scoresheets (club_id);

-- ---------------------------------------------------------------------
-- El club de cada fila ha de coincidir amb el del partit / equip
-- ---------------------------------------------------------------------
create or replace function public.check_recognition_club()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club uuid;
begin
  if tg_table_name = 'team_reception_systems' then
    select club_id into v_club from public.teams where id = new.team_id;
  else
    select club_id into v_club from public.matches where id = new.match_id;
  end if;
  if v_club is null or v_club <> new.club_id then
    raise exception 'club_mismatch';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists match_team_systems_club on public.match_team_systems;
create trigger match_team_systems_club before insert or update on public.match_team_systems
  for each row execute function public.check_recognition_club();

drop trigger if exists team_reception_systems_club on public.team_reception_systems;
create trigger team_reception_systems_club before insert or update on public.team_reception_systems
  for each row execute function public.check_recognition_club();

drop trigger if exists match_scoresheets_club on public.match_scoresheets;
create trigger match_scoresheets_club before insert or update on public.match_scoresheets
  for each row execute function public.check_recognition_club();

-- ---------------------------------------------------------------------
-- RLS: tothom del club ho pot veure; el sistema de joc i l'acta els edita
-- qui pot codificar el partit; els sistemes de recepció, analistes i
-- administradors del club.
-- ---------------------------------------------------------------------
alter table public.match_team_systems     enable row level security;
alter table public.team_reception_systems enable row level security;
alter table public.match_scoresheets      enable row level security;

drop policy if exists match_team_systems_select on public.match_team_systems;
create policy match_team_systems_select on public.match_team_systems
  for select using (public.is_club_member(club_id));
drop policy if exists match_team_systems_write on public.match_team_systems;
create policy match_team_systems_write on public.match_team_systems
  for all using (public.can_code_match(match_id))
  with check (public.can_code_match(match_id));

drop policy if exists team_reception_systems_select on public.team_reception_systems;
create policy team_reception_systems_select on public.team_reception_systems
  for select using (public.is_club_member(club_id));
drop policy if exists team_reception_systems_write on public.team_reception_systems;
create policy team_reception_systems_write on public.team_reception_systems
  for all using (public.has_club_role(club_id, array['admin','analyst']::public.club_role[]))
  with check (public.has_club_role(club_id, array['admin','analyst']::public.club_role[]));

drop policy if exists match_scoresheets_select on public.match_scoresheets;
create policy match_scoresheets_select on public.match_scoresheets
  for select using (public.is_club_member(club_id));
drop policy if exists match_scoresheets_write on public.match_scoresheets;
create policy match_scoresheets_write on public.match_scoresheets
  for all using (public.can_code_match(match_id))
  with check (public.can_code_match(match_id));
