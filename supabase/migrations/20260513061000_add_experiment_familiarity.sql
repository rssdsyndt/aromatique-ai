ALTER TABLE public.experiment_sessions
  ADD COLUMN IF NOT EXISTS familiarity TEXT
  CHECK (familiarity IS NULL OR familiarity IN ('pemula', 'penggemar', 'kolektor'));

CREATE INDEX IF NOT EXISTS idx_experiment_sessions_familiarity
  ON public.experiment_sessions(familiarity, condition, assigned_at DESC);
