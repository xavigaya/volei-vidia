-- =====================================================================
-- Volei VidIA — Dorsals
--
--  * Dins d'un equip, dos jugadors poden tenir el mateix dorsal (p. ex.
--    jugadors que no coincideixen mai en un partit), però no es poden
--    convocar tots dos al mateix partit fins que un dels dos el canviï.
--  * Els dorsals de cada equip són independents: el local i el visitant
--    poden tenir el mateix número al mateix partit.
-- =====================================================================

drop index if exists public.team_players_number_uq;

-- A la convocatòria, el dorsal és únic per partit i equip (local / visitant)
drop index if exists public.match_players_number_uq;
alter table public.match_players drop constraint if exists match_players_match_id_shirt_number_key;
create unique index match_players_number_uq on public.match_players (match_id, side, shirt_number);
