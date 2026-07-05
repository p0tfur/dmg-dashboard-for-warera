-- Backfill attribution_confidence for existing battle rankings.
-- Run AFTER 004_citizenship_history_and_confidence and 005_backfill_citizenship_history.
-- Idempotent (only updates rows where attribution_confidence is still 'unknown').
--
-- Rule:
--   If the battle ended AT or AFTER the user's lastCitizenshipChangeAt
--   (or game_created_at fallback), and the user still has the same country
--   in warera_users → attribution_confidence = 'certain' and
--   attributed_country_id = users.country_id.
--
-- All other rows keep their default 'unknown'.

UPDATE warera_battle_rankings r
JOIN warera_battles b ON b.battle_id = r.battle_id
JOIN warera_users u ON u.user_id = r.entity_id
SET
  r.attribution_confidence = 'certain',
  r.attributed_country_id = u.country_id
WHERE r.entity_type = 'user'
  AND r.attribution_confidence = 'unknown'
  AND u.country_id IS NOT NULL
  AND COALESCE(b.ended_at, b.created_at) IS NOT NULL
  AND COALESCE(b.ended_at, b.created_at) >=
    COALESCE(
      STR_TO_DATE(
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(u.dates_json, '$.lastCitizenshipChangeAt')), ''),
        '%Y-%m-%dT%H:%i:%s.%fZ'
      ),
      u.game_created_at,
      '1970-01-01'
    );
