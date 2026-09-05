CREATE OR REPLACE VIEW research_dataset AS
WITH
first_assistant_msg AS (
  SELECT DISTINCT ON (conversation_id)
    conversation_id, id AS first_msg_id
  FROM messages
  WHERE role = 'assistant'
  ORDER BY conversation_id, created_at ASC
),
familiarity_answer_msg AS (
  SELECT DISTINCT ON (conversation_id)
    conversation_id, id AS familiarity_msg_id, created_at AS familiarity_timestamp
  FROM messages
  WHERE role = 'user'
    AND (
      LOWER(content) LIKE '%pemula%' OR
      LOWER(content) LIKE '%penggemar%' OR
      LOWER(content) LIKE '%kolektor%'
    )
  ORDER BY conversation_id, created_at ASC
),
msg_count AS (
  SELECT m.conversation_id, COUNT(*) AS message_count
  FROM messages m
  JOIN familiarity_answer_msg fm ON fm.conversation_id = m.conversation_id
  WHERE m.created_at > fm.familiarity_timestamp
  GROUP BY m.conversation_id
),
valid_convs AS (
  SELECT
    c.id AS conversation_id,
    c.condition,
    c.session_id,
    c.created_at,
    ROW_NUMBER() OVER (PARTITION BY c.condition ORDER BY c.created_at DESC) AS rn
  FROM conversations c
  JOIN experiment_sessions es ON es.conversation_id = c.id
  LEFT JOIN msg_count mc ON mc.conversation_id = c.id
  WHERE c.condition IS NOT NULL
    AND c.session_id != 'codex-integration-test-1778630494'
    AND c.id != 'f96404df-baf9-45a7-940c-dd14d8ab01b7'
    AND COALESCE(mc.message_count, 0) >= 6
    AND es.familiarity IS NOT NULL
    AND EXISTS (SELECT 1 FROM feedback f WHERE f.conversation_id = c.id)
),
selected AS (
  SELECT conversation_id, condition
  FROM valid_convs
  WHERE rn <= 30
),
chat_history AS (
  SELECT
    m.conversation_id,
    JSON_AGG(
      JSON_BUILD_OBJECT('role', m.role, 'content', m.content)
      ORDER BY m.created_at
    ) AS chat_history
  FROM messages m
  JOIN first_assistant_msg fa ON fa.conversation_id = m.conversation_id
  JOIN familiarity_answer_msg fm ON fm.conversation_id = m.conversation_id
  WHERE m.id != fa.first_msg_id
    AND m.id != fm.familiarity_msg_id
  GROUP BY m.conversation_id
),
latest_rec AS (
  SELECT DISTINCT ON (conversation_id)
    conversation_id, products, summary
  FROM recommendations
  ORDER BY conversation_id, batch_index DESC
),
regenerated AS (
  SELECT conversation_id,
    CASE WHEN MAX(batch_index) > 1 THEN true ELSE false END AS regenerated
  FROM recommendations
  GROUP BY conversation_id
),
latest_feedback AS (
  SELECT DISTINCT ON (conversation_id)
    conversation_id, answers, created_at AS feedback_time
  FROM feedback
  ORDER BY conversation_id, created_at DESC
)
SELECT
  c.session_id,
  es.id AS condition_id,
  c.condition AS condition_type,
  es.familiarity AS familiarity_level,
  c.created_at AS conversation_start,
  lf.feedback_time AS conversation_end,
  ch.chat_history,
  lr.summary AS preference_summary,
  mc.message_count,
  (
    SELECT JSON_AGG(
      JSON_BUILD_OBJECT(
        'rank', (p->>'rank')::int,
        'product_name', p->>'product_name',
        'olfactory_family', p->>'olfactory_family',
        'main_accords', p->>'main_accords',
        'reason', p->>'reason'
      ) ORDER BY (p->>'rank')::int
    )
    FROM jsonb_array_elements(lr.products) AS p
  ) AS recommended_products,
  COALESCE(rg.regenerated, false) AS regenerated,
  (lf.answers->>'S1')::int AS feedback_S1,
  (lf.answers->>'S2')::int AS feedback_S2,
  (lf.answers->>'T1')::int AS feedback_T1,
  (lf.answers->>'T2')::int AS feedback_T2,
  (lf.answers->>'U1')::int AS feedback_U1,
  (lf.answers->>'U2')::int AS feedback_U2,
  (lf.answers->>'PI1')::int AS feedback_PI1,
  (lf.answers->>'PI2')::int AS feedback_PI2,
  NULL::text AS smelled_fragrance
FROM selected s
JOIN conversations c ON c.id = s.conversation_id
JOIN experiment_sessions es ON es.conversation_id = s.conversation_id
LEFT JOIN chat_history ch ON ch.conversation_id = s.conversation_id
LEFT JOIN latest_rec lr ON lr.conversation_id = s.conversation_id
LEFT JOIN regenerated rg ON rg.conversation_id = s.conversation_id
LEFT JOIN latest_feedback lf ON lf.conversation_id = s.conversation_id
LEFT JOIN msg_count mc ON mc.conversation_id = s.conversation_id
ORDER BY c.condition, c.created_at;
