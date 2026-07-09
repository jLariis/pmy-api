-- docs/superpowers/plans/audit-expense-categories.sql
-- Confirm every DISTINCT legacy category value is one of the 11 mapped strings.
-- Any row here NOT in the map => reconcile before running the migration.
SELECT `category` AS legacy_value, COUNT(*) AS n
FROM `expense`
GROUP BY `category`
ORDER BY n DESC;

-- Guard: is there already a physical `expense_category` table? (orphan entity never had a migration)
SHOW TABLES LIKE 'expense_category';
-- If it exists and is non-empty, stop and decide; the migration below assumes it does not exist.
