CREATE INDEX IF NOT EXISTS idx_feedback_conversation_id ON public.feedback(conversation_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_tail_product ON public.kg_edges(tail_product_id);
