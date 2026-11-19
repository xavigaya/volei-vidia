-- =====================================================================
-- Volei VidIA — Revisió de les jugades detectades (reconeixement, etapa 1.4)
--
-- Per a cada partit: les jugades detectades per l'eina local vidia-vision
-- (només jugades i contactes, ~250 KB per partit; no les posicions de la
-- pilota ni dels jugadors) i l'estat de la revisió de l'analista
-- (confirmades, descartades, ajustades i afegides).
-- =====================================================================

create table if not exists public.vision_reviews (
  match_id    uuid primary key references public.matches (id) on delete cascade,
  club_id     uuid not null references public.clubs (id) on delete cascade,
  detections  jsonb not null,
  review      jsonb not null default '{"rallies": {}, "added": []}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

create index if not exists vision_reviews_club_idx on public.vision_reviews (club_id);

drop trigger if exists vision_reviews_club on public.vision_reviews;
create trigger vision_reviews_club before insert or update on public.vision_reviews
  for each row execute function public.check_recognition_club();

alter table public.vision_reviews enable row level security;

drop policy if exists vision_reviews_select on public.vision_reviews;
create policy vision_reviews_select on public.vision_reviews
  for select using (public.is_club_member(club_id));
drop policy if exists vision_reviews_write on public.vision_reviews;
create policy vision_reviews_write on public.vision_reviews
  for all using (public.can_code_match(match_id))
  with check (public.can_code_match(match_id));
