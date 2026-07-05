 -- Alliance membership history — append-only, same pattern as citizenship.
-- Tracks when countries joined / left The Federation so the dashboard can
-- exclude pre-membership damage from aggregations.
CREATE TABLE IF NOT EXISTS warera_alliance_membership_history (
  alliance_id    VARCHAR(64) NOT NULL,
  country_id     VARCHAR(64) NOT NULL,
  joined_at      DATETIME(3) NOT NULL,
  left_at        DATETIME(3) NULL,
  first_seen_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (alliance_id, country_id, joined_at),
  KEY idx_alliance (alliance_id),
  KEY idx_country (country_id),
  KEY idx_active (alliance_id, country_id, left_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
