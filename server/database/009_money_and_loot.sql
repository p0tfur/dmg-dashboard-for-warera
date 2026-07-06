-- 009: Money rankings + battle loot summaries (bounty vs contract breakdown)
--
-- Adds a parallel "money" stream alongside existing "damage" in battle
-- rankings, plus a dedicated table for per-user loot summaries that split
-- earnings into bounty vs mercenary-contract components.

-- 1. Store the money value from battleRanking.getRanking(dataType:'money')
--    alongside the existing damage value. Same row (same battle/entity/side).
ALTER TABLE warera_battle_rankings
  ADD COLUMN money BIGINT NOT NULL DEFAULT 0;

-- 2. Track which battles have had their money rankings synced. NULL = needs
--    backfill (existing battles get enriched gradually by the sync loop).
ALTER TABLE warera_battles
  ADD COLUMN money_synced_at DATETIME(3) NULL;

-- 3. Per-user-per-battle loot summary (bounty vs contract breakdown).
--    Populated only for tracked users (Justice members) via
--    battleLootSummary.getByBattleAndUser.
CREATE TABLE IF NOT EXISTS warera_battle_loot (
  battle_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  money_from_bounty BIGINT NOT NULL DEFAULT 0,
  money_from_contract BIGINT NOT NULL DEFAULT 0,
  total_dmg BIGINT NOT NULL DEFAULT 0,
  hits INT NOT NULL DEFAULT 0,
  raw_json JSON NULL,
  synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (battle_id, user_id),
  KEY idx_warera_battle_loot_user (user_id),
  CONSTRAINT fk_warera_battle_loot_battle FOREIGN KEY (battle_id)
    REFERENCES warera_battles (battle_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
