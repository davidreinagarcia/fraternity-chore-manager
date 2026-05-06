-- ============================================================
-- bigquery_setup.sql — BigQuery schema and sample queries
-- Frat Chore Management System
-- ============================================================
-- Run these in BigQuery Console or via `bq` CLI.
-- Replace YOUR_PROJECT_ID and YOUR_DATASET with your values.
-- ============================================================

-- ---- Create dataset ----------------------------------------
CREATE SCHEMA IF NOT EXISTS `YOUR_PROJECT_ID.frat_chores`
OPTIONS (location = 'US');

-- ---- Table: chore_submissions ------------------------------
CREATE TABLE IF NOT EXISTS `YOUR_PROJECT_ID.frat_chores.chore_submissions` (
  submission_id  STRING  NOT NULL,
  member_id      STRING  NOT NULL,
  chore_name     STRING  NOT NULL,
  week_start     STRING,
  submitted_at   STRING,
  photo_url      STRING,
  photo_hash     STRING,
  exif_date      STRING,
  auto_status    STRING,   -- passed | flagged | rejected
  human_status   STRING,   -- pending | verified | failed
  verified_by    STRING,
  notes          STRING,
  semester       STRING,
  synced_at      STRING
);

-- ---- Table: chore_fines ------------------------------------
CREATE TABLE IF NOT EXISTS `YOUR_PROJECT_ID.frat_chores.chore_fines` (
  fine_id    STRING  NOT NULL,
  member_id  STRING  NOT NULL,
  chore_name STRING  NOT NULL,
  week_start STRING,
  reason     STRING,
  issued_at  STRING,
  issued_by  STRING,
  semester   STRING,
  synced_at  STRING
);

-- ---- Table: chore_assignments ------------------------------
CREATE TABLE IF NOT EXISTS `YOUR_PROJECT_ID.frat_chores.chore_assignments` (
  assignment_id STRING NOT NULL,
  member_id     STRING NOT NULL,
  chore_name    STRING NOT NULL,
  group_id      STRING,
  semester      STRING,
  assigned_date STRING,
  synced_at     STRING
);

-- ============================================================
-- SAMPLE QUERIES
-- ============================================================

-- ---- Weekly compliance rate (by week) ----------------------
SELECT
  week_start,
  semester,
  COUNT(DISTINCT sub.member_id)                                        AS members_submitted,
  COUNT(DISTINCT asg.member_id)                                        AS members_assigned,
  ROUND(
    COUNT(DISTINCT sub.member_id) * 100.0 / NULLIF(COUNT(DISTINCT asg.member_id), 0),
    1
  )                                                                    AS compliance_pct
FROM `YOUR_PROJECT_ID.frat_chores.chore_assignments` asg
LEFT JOIN (
  SELECT DISTINCT member_id, week_start
  FROM `YOUR_PROJECT_ID.frat_chores.chore_submissions`
  WHERE auto_status = 'passed' OR human_status = 'verified'
) sub USING (member_id)
GROUP BY week_start, semester
ORDER BY semester, week_start;

-- ---- All-time fine leaderboard -----------------------------
SELECT
  member_id,
  COUNT(*)               AS total_fines,
  MIN(issued_at)         AS first_fine,
  MAX(issued_at)         AS last_fine,
  COUNT(DISTINCT semester) AS semesters_with_fines
FROM `YOUR_PROJECT_ID.frat_chores.chore_fines`
GROUP BY member_id
ORDER BY total_fines DESC
LIMIT 20;

-- ---- Chore skip rate ranking -------------------------------
WITH assigned AS (
  SELECT chore_name, COUNT(*) AS total_slots
  FROM `YOUR_PROJECT_ID.frat_chores.chore_assignments`
  GROUP BY chore_name
),
submitted AS (
  SELECT chore_name, COUNT(*) AS total_subs
  FROM `YOUR_PROJECT_ID.frat_chores.chore_submissions`
  WHERE auto_status = 'passed' OR human_status = 'verified'
  GROUP BY chore_name
)
SELECT
  asg.chore_name,
  asg.total_slots,
  COALESCE(sub.total_subs, 0)                                          AS total_verified_subs,
  ROUND(COALESCE(sub.total_subs, 0) * 100.0 / NULLIF(asg.total_slots, 0), 1) AS compliance_pct,
  ROUND(100 - COALESCE(sub.total_subs, 0) * 100.0 / NULLIF(asg.total_slots, 0), 1) AS skip_rate_pct
FROM assigned asg
LEFT JOIN submitted sub USING (chore_name)
ORDER BY skip_rate_pct DESC;

-- ---- Member reliability score (all time) -------------------
WITH stats AS (
  SELECT
    asg.member_id,
    COUNT(DISTINCT asg.assignment_id)                                  AS total_assignments,
    COUNT(DISTINCT CASE WHEN sub.auto_status = 'passed'
                          OR sub.human_status = 'verified'
                        THEN sub.submission_id END)                    AS verified_subs,
    COUNT(DISTINCT f.fine_id)                                          AS total_fines
  FROM `YOUR_PROJECT_ID.frat_chores.chore_assignments` asg
  LEFT JOIN `YOUR_PROJECT_ID.frat_chores.chore_submissions` sub
    ON asg.member_id = sub.member_id AND asg.chore_name = sub.chore_name
  LEFT JOIN `YOUR_PROJECT_ID.frat_chores.chore_fines` f
    ON asg.member_id = f.member_id
  GROUP BY asg.member_id
)
SELECT
  member_id,
  total_assignments,
  verified_subs,
  total_fines,
  ROUND(verified_subs * 100.0 / NULLIF(total_assignments, 0), 1) AS compliance_pct,
  ROUND(
    (verified_subs * 100.0 / NULLIF(total_assignments, 0)) - (total_fines * 5),
    1
  ) AS reliability_score
FROM stats
ORDER BY reliability_score DESC;

-- ---- Semester summary --------------------------------------
SELECT
  semester,
  COUNT(DISTINCT member_id)  AS members_active,
  COUNT(DISTINCT assignment_id) AS total_assignments
FROM `YOUR_PROJECT_ID.frat_chores.chore_assignments`
GROUP BY semester
ORDER BY semester;

-- ---- Duplicate photo attempts (flagged/rejected) -----------
SELECT
  submission_id, member_id, chore_name, week_start,
  auto_status, notes, submitted_at
FROM `YOUR_PROJECT_ID.frat_chores.chore_submissions`
WHERE auto_status IN ('flagged', 'rejected')
ORDER BY submitted_at DESC
LIMIT 100;
