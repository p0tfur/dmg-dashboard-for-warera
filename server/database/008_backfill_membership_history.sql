-- Backfill alliance membership history from known join dates.
-- Run AFTER 007_alliance_membership_history and after the first sync has
-- populated warera_countries + warera_alliances.
-- Uses country names (joined with warera_countries) so it's portable.
-- Idempotent (ON DUPLICATE KEY does nothing).

-- Resolve alliance ID from the tracked entity.
SET @fed_id = (SELECT entity_id FROM warera_tracked_entities WHERE entity_key = 'federation' LIMIT 1);

-- Founding countries (2026-04-28)
INSERT IGNORE INTO warera_alliance_membership_history
  (alliance_id, country_id, joined_at)
SELECT @fed_id, c.country_id, '2026-04-28 00:00:00'
FROM warera_countries c
WHERE c.name IN (
  'China', 'East Timor', 'Fiji', 'India', 'Iraq', 'Palestine',
  'Papua New Guinea', 'Philippines', 'United Korea', 'Vietnam'
);

-- Eritrea (2026-05-29)
INSERT IGNORE INTO warera_alliance_membership_history
  (alliance_id, country_id, joined_at)
SELECT @fed_id, c.country_id, '2026-05-29 00:00:00'
FROM warera_countries c WHERE c.name = 'Eritrea';

-- Czechia (2026-06-17)
INSERT IGNORE INTO warera_alliance_membership_history
  (alliance_id, country_id, joined_at)
SELECT @fed_id, c.country_id, '2026-06-17 00:00:00'
FROM warera_countries c WHERE c.name = 'Czechia';

-- Slovakia (2026-06-17)
INSERT IGNORE INTO warera_alliance_membership_history
  (alliance_id, country_id, joined_at)
SELECT @fed_id, c.country_id, '2026-06-17 00:00:00'
FROM warera_countries c WHERE c.name = 'Slovakia';

-- Oman (2026-06-30)
INSERT IGNORE INTO warera_alliance_membership_history
  (alliance_id, country_id, joined_at)
SELECT @fed_id, c.country_id, '2026-06-30 00:00:00'
FROM warera_countries c WHERE c.name = 'Oman';

-- United Arab Emirates (2026-06-30)
INSERT IGNORE INTO warera_alliance_membership_history
  (alliance_id, country_id, joined_at)
SELECT @fed_id, c.country_id, '2026-06-30 00:00:00'
FROM warera_countries c WHERE c.name = 'United Arab Emirates';
