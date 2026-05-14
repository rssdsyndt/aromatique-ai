ALTER TABLE public.experiment_sessions
  ADD COLUMN IF NOT EXISTS prompt_name TEXT,
  ADD COLUMN IF NOT EXISTS prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS llm_model TEXT;

ALTER TABLE public.recommendations
  ADD COLUMN IF NOT EXISTS prompt_name TEXT,
  ADD COLUMN IF NOT EXISTS prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS llm_model TEXT,
  ADD COLUMN IF NOT EXISTS explanation_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_experiment_sessions_condition
  ON public.experiment_sessions(condition, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_recommendations_prompt_metadata
  ON public.recommendations(explanation_type, prompt_name, llm_model);
