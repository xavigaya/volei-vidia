-- =====================================================================
-- Volei VidIA — Calibració del vídeo (reconeixement de jugades, etapa 1.1)
--
-- Per a cada partit, una o més calibracions de la càmera (una per tram de
-- vídeo, per si la càmera es mou): punts marcats sobre un fotograma
-- (cantonades, cinta superior de la xarxa i antenes, normalitzats 0..1),
-- mida del fotograma, alçada de la xarxa i equip al costat de la càmera a
-- cada set. El vídeo no es puja: només aquests punts.
-- =====================================================================

create table if not exists public.video_calibrations (
  match_id    uuid not null references public.matches (id) on delete cascade,
  club_id     uuid not null references public.clubs (id) on delete cascade,
  from_time   double precision not null default 0 check (from_time >= 0),
  -- {"width":1920,"height":1080,"netHeight":2.43,"points":{"nl":{"x":0.1,"y":0.9},...},"nearSide":{"1":"H","2":"A"}}
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  primary key (match_id, from_time)
);

create index if not exists video_calibrations_club_idx on public.video_calibrations (club_id);

drop trigger if exists video_calibrations_club on public.video_calibrations;
create trigger video_calibrations_club before insert or update on public.video_calibrations
  for each row execute function public.check_recognition_club();

alter table public.video_calibrations enable row level security;

drop policy if exists video_calibrations_select on public.video_calibrations;
create policy video_calibrations_select on public.video_calibrations
  for select using (public.is_club_member(club_id));
drop policy if exists video_calibrations_write on public.video_calibrations;
create policy video_calibrations_write on public.video_calibrations
  for all using (public.can_code_match(match_id))
  with check (public.can_code_match(match_id));
