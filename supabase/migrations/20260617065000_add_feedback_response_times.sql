ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS response_times JSONB;
