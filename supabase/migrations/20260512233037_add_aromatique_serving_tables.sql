-- Aromatique KGAT/CR-HKGE serving schema.
-- Keeps the edge function lightweight: product metadata and KG paths are served
-- from Supabase instead of running TensorFlow/KGAT inside Deno.

CREATE TABLE IF NOT EXISTS public.products (
  product_id TEXT PRIMARY KEY,
  kgat_product_id INTEGER NOT NULL UNIQUE CHECK (kgat_product_id >= 0),
  old_entity_id INTEGER NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  visual_note TEXT,
  visual_note_alt TEXT,
  revolutionize TEXT,
  main_accords TEXT,
  olfactory_family TEXT,
  meaning TEXT,
  data_quality TEXT,
  accords TEXT[] NOT NULL DEFAULT '{}',
  visual_notes TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_kgat_product_id ON public.products(kgat_product_id);
CREATE INDEX IF NOT EXISTS idx_products_family ON public.products(olfactory_family);
CREATE INDEX IF NOT EXISTS idx_products_accords ON public.products USING gin(accords);
CREATE INDEX IF NOT EXISTS idx_products_visual_notes ON public.products USING gin(visual_notes);

CREATE TABLE IF NOT EXISTS public.kg_edges (
  id BIGSERIAL PRIMARY KEY,
  head_entity_id INTEGER NOT NULL,
  head_entity_type TEXT NOT NULL,
  head_name TEXT NOT NULL,
  relation_id INTEGER NOT NULL,
  relation_name TEXT NOT NULL,
  tail_entity_id INTEGER NOT NULL,
  tail_entity_type TEXT NOT NULL,
  tail_name TEXT NOT NULL,
  head_product_id TEXT REFERENCES public.products(product_id) ON DELETE CASCADE,
  tail_product_id TEXT REFERENCES public.products(product_id) ON DELETE CASCADE,
  source_dataset TEXT NOT NULL DEFAULT 'dataset-aromatique-kgat-ready',
  model_version TEXT NOT NULL DEFAULT 'kgat_baseline_epoch69_v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (head_entity_id, relation_id, tail_entity_id, model_version)
);

CREATE INDEX IF NOT EXISTS idx_kg_edges_head ON public.kg_edges(head_entity_id, relation_name);
CREATE INDEX IF NOT EXISTS idx_kg_edges_tail ON public.kg_edges(tail_entity_id, relation_name);
CREATE INDEX IF NOT EXISTS idx_kg_edges_head_product ON public.kg_edges(head_product_id, relation_name);
CREATE INDEX IF NOT EXISTS idx_kg_edges_relation_tail ON public.kg_edges(relation_name, tail_name);

CREATE TABLE IF NOT EXISTS public.product_embeddings (
  id BIGSERIAL PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES public.products(product_id) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  embedding DOUBLE PRECISION[],
  feature_terms TEXT[] NOT NULL DEFAULT '{}',
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, model_version)
);

CREATE INDEX IF NOT EXISTS idx_product_embeddings_product ON public.product_embeddings(product_id);
CREATE INDEX IF NOT EXISTS idx_product_embeddings_terms ON public.product_embeddings USING gin(feature_terms);

CREATE TABLE IF NOT EXISTS public.experiment_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  condition TEXT NOT NULL CHECK (condition IN ('A', 'B', 'C')),
  explanation_type TEXT NOT NULL CHECK (explanation_type IN ('A', 'B', 'C')),
  recommendation_engine TEXT NOT NULL DEFAULT 'kgat_baseline',
  model_version TEXT NOT NULL DEFAULT 'kgat_baseline_epoch69_v1',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_experiment_sessions_session ON public.experiment_sessions(session_id, assigned_at DESC);

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS condition TEXT CHECK (condition IS NULL OR condition IN ('A', 'B', 'C'));

ALTER TABLE public.recommendations
  ADD COLUMN IF NOT EXISTS recommendations JSONB,
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS kg_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS explanation_type TEXT CHECK (explanation_type IS NULL OR explanation_type IN ('A', 'B', 'C')),
  ADD COLUMN IF NOT EXISTS recommendation_engine TEXT,
  ADD COLUMN IF NOT EXISTS model_version TEXT;

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS explanation_type TEXT CHECK (explanation_type IS NULL OR explanation_type IN ('A', 'B', 'C')),
  ADD COLUMN IF NOT EXISTS model_version TEXT;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kg_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read products" ON public.products;
CREATE POLICY "public read products" ON public.products FOR SELECT USING (true);

DROP POLICY IF EXISTS "public read kg_edges" ON public.kg_edges;
CREATE POLICY "public read kg_edges" ON public.kg_edges FOR SELECT USING (true);

DROP POLICY IF EXISTS "public read product_embeddings" ON public.product_embeddings;
CREATE POLICY "public read product_embeddings" ON public.product_embeddings FOR SELECT USING (true);

DROP POLICY IF EXISTS "public all experiment_sessions" ON public.experiment_sessions;
CREATE POLICY "public all experiment_sessions" ON public.experiment_sessions FOR ALL USING (true) WITH CHECK (true);
