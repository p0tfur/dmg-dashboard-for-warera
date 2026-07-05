ALTER TABLE warera_battle_rankings
  ADD COLUMN attributed_country_id VARCHAR(64) NULL AFTER entity_id,
  ADD KEY idx_warera_rankings_attributed_country (entity_type, attributed_country_id);
