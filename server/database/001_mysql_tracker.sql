CREATE TABLE IF NOT EXISTS warera_sync_state (
  job_name VARCHAR(80) NOT NULL PRIMARY KEY,
  checkpoint_value VARCHAR(255) NULL,
  last_success_at DATETIME(3) NULL,
  last_failure_at DATETIME(3) NULL,
  last_error TEXT NULL,
  locked_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warera_tracked_entities (
  entity_key VARCHAR(80) NOT NULL PRIMARY KEY,
  entity_type VARCHAR(40) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NULL,
  metadata_json JSON NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_warera_tracked_entity_type (entity_type),
  KEY idx_warera_tracked_entity_id (entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warera_countries (
  country_id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(16) NULL,
  weekly_damage BIGINT NOT NULL DEFAULT 0,
  total_damage BIGINT NOT NULL DEFAULT 0,
  raw_json JSON NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warera_alliances (
  alliance_id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  avatar_url TEXT NULL,
  member_country_ids JSON NULL,
  weekly_damage BIGINT NOT NULL DEFAULT 0,
  total_damage BIGINT NOT NULL DEFAULT 0,
  global_weekly_rank INT NULL,
  global_total_rank INT NULL,
  population BIGINT NULL,
  raw_json JSON NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warera_mus (
  mu_id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  country_id VARCHAR(64) NULL,
  avatar_url TEXT NULL,
  weekly_damage BIGINT NOT NULL DEFAULT 0,
  total_damage BIGINT NOT NULL DEFAULT 0,
  level INT NULL,
  global_weekly_rank INT NULL,
  global_total_rank INT NULL,
  raw_json JSON NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_warera_mus_country (country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warera_mu_members (
  mu_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  weekly_damage BIGINT NOT NULL DEFAULT 0,
  monthly_damage BIGINT NOT NULL DEFAULT 0,
  total_damage BIGINT NOT NULL DEFAULT 0,
  weekly_help BIGINT NOT NULL DEFAULT 0,
  monthly_help BIGINT NOT NULL DEFAULT 0,
  total_help BIGINT NOT NULL DEFAULT 0,
  raw_json JSON NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (mu_id, user_id),
  KEY idx_warera_mu_members_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warera_users (
  user_id VARCHAR(64) NOT NULL PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  avatar_url TEXT NULL,
  country_id VARCHAR(64) NULL,
  raw_json JSON NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_warera_users_country (country_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warera_battles (
  battle_id VARCHAR(64) NOT NULL PRIMARY KEY,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  attacker_country_id VARCHAR(64) NULL,
  defender_country_id VARCHAR(64) NULL,
  created_at DATETIME(3) NULL,
  ended_at DATETIME(3) NULL,
  raw_json JSON NULL,
  synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_warera_battles_created (created_at),
  KEY idx_warera_battles_ended (ended_at),
  KEY idx_warera_battles_attacker (attacker_country_id),
  KEY idx_warera_battles_defender (defender_country_id),
  KEY idx_warera_battles_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warera_battle_rankings (
  battle_id VARCHAR(64) NOT NULL,
  entity_type ENUM('user', 'country', 'mu') NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  side ENUM('attacker', 'defender', 'merged') NOT NULL DEFAULT 'merged',
  damage BIGINT NOT NULL DEFAULT 0,
  ranking_position INT NULL,
  raw_json JSON NULL,
  synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (battle_id, entity_type, entity_id, side),
  KEY idx_warera_rankings_entity (entity_type, entity_id),
  KEY idx_warera_rankings_damage (damage),
  CONSTRAINT fk_warera_rankings_battle FOREIGN KEY (battle_id) REFERENCES warera_battles (battle_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
