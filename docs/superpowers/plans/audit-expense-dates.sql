-- docs/superpowers/plans/audit-expense-dates.sql
-- 1) Distribución de la parte de HORA de expense.date.
--    Esperado: la gran mayoría en '06:00:00' (date-only Central) + una cola de instantes variados.
SELECT TIME(`date`) AS time_part, COUNT(*) AS n
FROM `expense`
GROUP BY TIME(`date`)
ORDER BY n DESC
LIMIT 30;

-- 2) Conteo binario: date-only (06:00:00) vs instante real.
SELECT
  SUM(TIME(`date`) = '06:00:00') AS date_only_central,
  SUM(TIME(`date`) <> '06:00:00') AS real_instants,
  COUNT(*) AS total,
  SUM(`date` IS NULL) AS nulls
FROM `expense`;

-- 3) Vista previa de la normalización propuesta (NO modifica nada).
SELECT id, `date` AS old_value, TIME(`date`) AS time_part,
  CASE WHEN TIME(`date`) = '06:00:00' THEN DATE(`date`)
       ELSE DATE(CONVERT_TZ(`date`, '+00:00', '-07:00')) END AS new_day
FROM `expense`
ORDER BY `date` DESC
LIMIT 40;
