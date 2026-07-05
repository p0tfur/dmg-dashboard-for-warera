-- Attribution confidence on battle rankings.
-- Allows consumers to filter aggregated "DMG per country per player" by
-- certainty level:
--   certain    = battle ended at/after user's lastCitizenshipChangeAt
--                (we know which country to attribute)
--   probable   = battle ended before lastCitizenshipChangeAt AND we have
--                a deduced country from the citizenship history table
--   unknown    = battle ended before lastCitizenshipChangeAt and we have
--                no reliable prior-citizenship signal (default for legacy rows)
ALTER TABLE warera_battle_rankings
  ADD COLUMN attribution_confidence ENUM('certain','probable','unknown')
    NOT NULL DEFAULT 'unknown' AFTER attributed_country_id,
  ADD KEY idx_warera_rankings_confidence (entity_type, entity_id, attribution_confidence);

-- Append-only citizenship history.
-- One row per (user, valid_from). When the profile's `country` changes,
-- the previous row is closed (valid_to = now) and a new row inserted.
-- `last_change_at` mirrors `dates.lastCitizenshipChangeAt` from the game
-- profile (the game's own marker for when the change took effect).
CREATE TABLE IF NOT EXISTS warera_user_citizenship_history (
  user_id         VARCHAR(64) NOT NULL,
  country_id      VARCHAR(64) NOT NULL,
  valid_from      DATETIME(3) NOT NULL,
  valid_to        DATETIME(3) NULL,
  source          ENUM('profile','inferred') NOT NULL DEFAULT 'profile',
  confidence      ENUM('certain','probable') NOT NULL DEFAULT 'certain',
  last_change_at  DATETIME(3) NULL,
  first_seen_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, valid_from),
  KEY idx_user_valid (user_id, valid_from, valid_to),
  KEY idx_country (country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
