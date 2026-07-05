-- Backfill citizenship history from existing warera_users.
-- Run AFTER migration 004 is applied. Idempotent (skips users that already
-- have an open citizenship entry).
--
-- Logic:
--   For each user with a known country_id, insert a single OPEN row with:
--     valid_from = COALESCE(last_change_at parsed from dates_json, game_created_at)
--     source   = 'profile'
--     confidence = 'certain'
--
-- Caveats:
--   • Users whose country changed before we started tracking will only have
--     the CURRENT citizenship in the history. This is intentional — we cannot
--     reconstruct the past without snapshots.
--   • The `last_change_at` field in dates_json tells us WHEN the current
--     country became effective, so we backdate valid_from to that moment.

INSERT IGNORE INTO warera_user_citizenship_history
  (user_id, country_id, valid_from, valid_to, source, confidence, last_change_at)
SELECT
  u.user_id,
  u.country_id,
  COALESCE(
    STR_TO_DATE(
      NULLIF(
        JSON_UNQUOTE(JSON_EXTRACT(u.dates_json, '$.lastCitizenshipChangeAt')),
        ''
      ),
      '%Y-%m-%dT%H:%i:%s.%fZ'
    ),
    u.game_created_at,
    UTC_TIMESTAMP(3)
  ),
  NULL,
  'profile',
  'certain',
  STR_TO_DATE(
    NULLIF(
      JSON_UNQUOTE(JSON_EXTRACT(u.dates_json, '$.lastCitizenshipChangeAt')),
      ''
    ),
    '%Y-%m-%dT%H:%i:%s.%fZ'
  )
FROM warera_users u
WHERE u.country_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM warera_user_citizenship_history h
    WHERE h.user_id = u.user_id AND h.valid_to IS NULL
  );

-- Reset sync checkpoints so the next full sync re-scans and populates
-- attribution_confidence for all battle rankings.
-- Uncomment if you want a full resync after backfill:
-- UPDATE warera_sync_state SET checkpoint_value = NULL WHERE job_name = 'federation-battles';
-- UPDATE warera_sync_state SET checkpoint_value = NULL WHERE job_name = 'justice-user-battles';
