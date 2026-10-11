-- Merekonstruksi keanggotaan 90 baris dataset yang diambil 27 Juni 2026.
--
-- Ini adalah klausa seleksi dari view research_dataset yang sudah dihapus
-- (definisi lengkapnya ada di commit 1f986b2). Selama tidak ada conversation
-- baru yang lolos filter, query ini mengembalikan himpunan yang sama persis.
--
-- Diverifikasi 11 September 2026: hasilnya md5 cb3fade480b422fc52e67ff3e22bcf45,
-- identik dengan docs/dataset_90_membership.csv.
--
-- PERINGATAN: filter `rn <= 30` mengambil 30 TERBARU per condition, jadi
-- himpunan ini bergeser sendiri begitu ada data baru masuk. Setelah ronde
-- pengumpulan berikutnya, query ini TIDAK lagi mengembalikan 90 baris yang sama
-- — pakai CSV-nya sebagai catatan permanen.

WITH fam AS (
  SELECT DISTINCT ON (conversation_id) conversation_id, created_at AS ft
  FROM messages
  WHERE role = 'user'
    AND (LOWER(content) LIKE '%pemula%'
      OR LOWER(content) LIKE '%penggemar%'
      OR LOWER(content) LIKE '%kolektor%')
  ORDER BY conversation_id, created_at ASC
),
mc AS (
  SELECT m.conversation_id, count(*) AS n
  FROM messages m
  JOIN fam ON fam.conversation_id = m.conversation_id
  WHERE m.created_at > fam.ft
  GROUP BY m.conversation_id
),
valid AS (
  SELECT c.id, c.session_id, c.condition, c.created_at,
         ROW_NUMBER() OVER (PARTITION BY c.condition ORDER BY c.created_at DESC) AS rn
  FROM conversations c
  JOIN experiment_sessions es ON es.conversation_id = c.id
  LEFT JOIN mc ON mc.conversation_id = c.id
  WHERE c.condition IS NOT NULL
    AND c.session_id != 'codex-integration-test-1778630494'
    AND c.id != 'f96404df-baf9-45a7-940c-dd14d8ab01b7'
    AND COALESCE(mc.n, 0) >= 6
    AND es.familiarity IS NOT NULL
    AND EXISTS (SELECT 1 FROM feedback f WHERE f.conversation_id = c.id)
)
SELECT condition, session_id, id AS conversation_id,
       to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at
FROM valid
WHERE rn <= 30
ORDER BY condition, created_at;
