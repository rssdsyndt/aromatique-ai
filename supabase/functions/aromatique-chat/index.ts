import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { EMBEDDED_PROMPTS } from "./prompt-text.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL_VERSION = "kgat_baseline_epoch69_v1";
const RECOMMENDATION_ENGINE = "kgat_baseline";
const OPENAI_CHAT_MODEL = "gpt-4o-mini";
const PROMPT_VERSION = "v1";
const CONDITIONS = ["A", "B", "C"] as const;
const FALLBACK_PUBLIC_KEYS = new Set(["sb_publishable_9uQRBemuF7gAYW4VJLaWrw_VW_NKZxW"]);

type ExplanationType = (typeof CONDITIONS)[number];
type FamiliarityLevel = "pemula" | "penggemar" | "kolektor";
type Msg = { role: "user" | "assistant" | "system"; content: string };
type SupabaseClient = ReturnType<typeof createClient>;

type ProductRow = {
  product_id: string;
  kgat_product_id: number;
  product_name: string;
  visual_note: string | null;
  revolutionize: string | null;
  main_accords: string | null;
  olfactory_family: string | null;
  meaning: string | null;
  data_quality: string | null;
  accords: string[] | null;
  visual_notes: string[] | null;
};

type KgEdge = {
  head_entity_id: number;
  head_entity_type: string;
  head_name: string;
  relation_name: string;
  tail_entity_id: number;
  tail_entity_type: string;
  tail_name: string;
  head_product_id: string | null;
};

type PreferenceProfile = {
  terms: Set<string>;
  negativeTerms: Set<string>;
  labels: string[];
  summary: string;
  nlu: NluProfile | null;
};

type ScoredProduct = {
  product: ProductRow;
  score: number;
  matchScore: number;
  matchedTerms: Set<string>;
};

type PromptMetadata = {
  condition: ExplanationType;
  promptName: string;
  promptVersion: string;
  llmModel: string;
};

type ExperimentAssignment = PromptMetadata & {
  conversationId: string | null;
  sessionId: string | null;
};

type NluProfile = {
  liked_terms: string[];
  disliked_terms: string[];
  occasion: string[];
  style: string[];
  intensity: "light" | "moderate" | "strong" | "unknown";
  time_of_use: string[];
  summary: string;
};

type RecommendationOutput = {
  rank: number;
  product_id: string;
  product_name: string;
  olfactory_family: string;
  main_accords: string;
  visual_note: string;
  revolutionize: string | null;
  match_score: number;
  reason: string;
  kg_path: ReturnType<typeof buildKgPath>;
  id: string;
  name: string;
  family: string;
  notes: string[];
  description: string;
  match: number;
};

type GptExplanationResult = {
  summary: string | null;
  reasons: Map<string, string>;
  payload: Record<string, unknown>;
};

const PROMPT_CONFIG: Record<ExplanationType, { promptName: string; fallbackStyle: string; greeting: string }> = {
  A: {
    promptName: "system_prompt_feature_based_explanation.md",
    fallbackStyle: "Gunakan gaya feature-based: sebutkan atribut aroma seperti family, accords, karakter segar/manis/floral/woody, dan kaitkan secara jelas ke preferensi user.",
    greeting: "Halo! Aku Aromatique AI. Aku akan bantu memetakan preferensi aromamu lewat karakter yang konkret seperti fresh, floral, sweet, woody, dan intensity. Sebelum kita mulai, boleh aku tahu dulu — seberapa familiar kamu dengan dunia parfum?",
  },
  B: {
    promptName: "system_prompt_narrative_based_explanation.md",
    fallbackStyle: "Gunakan gaya narrative-based: jelaskan lewat suasana, emosi, momen, dan gambaran sensoris; hindari istilah teknis berlebihan.",
    greeting: "Halo! Aku Aromatique AI. Aku akan bantu menemukan parfum yang terasa pas dengan suasana, mood, dan kesan yang ingin kamu bawa. Sebelum kita mulai, boleh aku tahu dulu — seberapa familiar kamu dengan dunia parfum?",
  },
  C: {
    promptName: "system_prompt_comparative_based_explanation.md",
    fallbackStyle: "Gunakan gaya comparative-based: bantu user memilih lewat perbandingan, trade-off, dan spektrum antar opsi aroma.",
    greeting: "Halo! Aku Aromatique AI. Aku akan bantu membandingkan pilihan aroma supaya kamu bisa melihat mana yang paling dekat dengan preferensimu. Sebelum kita mulai, boleh aku tahu dulu — seberapa familiar kamu dengan dunia parfum?",
  },
};

const PROMPT_CACHE = new Map<string, string>();

const PREFERENCE_LEXICON: { label: string; aliases: string[]; terms: string[] }[] = [
  { label: "segar", aliases: ["segar", "fresh", "freshy", "bersih", "clean", "ringan", "adem"], terms: ["fresh", "citrus", "aquatic", "green", "aromatic", "ozonic", "marine"] },
  { label: "manis", aliases: ["manis", "sweet", "gourmand", "vanila", "vanilla", "caramel", "karamel"], terms: ["sweet", "vanilla", "caramel", "cacao", "honey", "fruity"] },
  { label: "floral", aliases: ["floral", "bunga", "melati", "mawar", "rose", "jasmine", "feminim"], terms: ["floral", "white floral", "rose", "jasmine", "violet", "iris", "powdery"] },
  { label: "woody", aliases: ["woody", "kayu", "wood", "sandalwood", "cedar", "oud"], terms: ["woody", "sandalwood", "cedar", "oud", "patchouli", "earthy"] },
  { label: "hangat", aliases: ["hangat", "warm", "spicy", "rempah", "malam", "date", "kencan"], terms: ["amber", "warm spicy", "fresh spicy", "balsamic", "musky", "smoky"] },
  { label: "elegan", aliases: ["elegan", "mewah", "luxury", "formal", "premium"], terms: ["amber", "woody", "musky", "powdery", "iris", "oud"] },
  { label: "kasual", aliases: ["kasual", "harian", "daily", "kampus", "kantor", "kerja"], terms: ["fresh", "citrus", "aromatic", "musky", "clean", "green"] },
  { label: "sporty", aliases: ["sport", "sporty", "olahraga", "outdoor", "aktif"], terms: ["fresh", "aquatic", "citrus", "green", "aromatic"] },
  { label: "lembut", aliases: ["lembut", "soft", "calm", "tenang", "nyaman"], terms: ["musky", "powdery", "white floral", "vanilla", "fresh", "floral"] },
];

const RELATION_LABEL: Record<string, string> = {
  has_accord: "memiliki accord",
  has_visual_note: "memiliki visual note",
  belongs_to_family: "berada di family",
  inspired_by: "terinspirasi dari",
  has_global_accord: "punya global accord",
  belongs_to_global_family: "berada di global family",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!isAuthorizedRequest(req)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const payload = await req.json();
    const messages = sanitizeMessages(Array.isArray(payload.messages) ? payload.messages : []);

    if (payload.mode === "init") {
      return await initSession(req, payload);
    }

    if (payload.mode === "familiarity") {
      return await recordFamiliarity(req, payload);
    }

    if (payload.mode === "recommend") {
      return await recommend(req, messages, payload);
    }

    return await chat(req, messages, payload);
  } catch (e) {
    console.error(e);
    return jsonResponse({ error: e instanceof Error ? e.message : "error" }, 500);
  }
});

function isAuthorizedRequest(req: Request) {
  const apiKey = req.headers.get("apikey") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const allowed = new Set(
    [
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),
      Deno.env.get("SUPABASE_ANON_KEY"),
      ...FALLBACK_PUBLIC_KEYS,
    ].filter((value): value is string => Boolean(value)),
  );
  return allowed.has(apiKey) || allowed.has(bearer);
}

async function initSession(req: Request, payload: Record<string, unknown>) {
  const supabase = createSupabaseClientForRequest(req);
  const assignment = await resolveSessionCondition(supabase, payload);
  return jsonResponse({
    condition: assignment.condition,
    explanation_type: assignment.condition,
    prompt_name: assignment.promptName,
    prompt_version: assignment.promptVersion,
    llm_model: assignment.llmModel,
    recommendation_engine: RECOMMENDATION_ENGINE,
    model_version: MODEL_VERSION,
    greeting: PROMPT_CONFIG[assignment.condition].greeting,
    familiarity_options: [
      { value: "pemula", label: "🌱 Pemula" },
      { value: "penggemar", label: "🌸 Penggemar" },
      { value: "kolektor", label: "💎 Kolektor" },
    ],
  });
}

async function recordFamiliarity(req: Request, payload: Record<string, unknown>) {
  const supabase = createSupabaseClientForRequest(req);
  const assignment = await resolveSessionCondition(supabase, payload);
  const familiarity = normalizeFamiliarity(payload.familiarity);

  if (!familiarity) {
    return jsonResponse({ error: "Invalid familiarity" }, 400);
  }

  await persistFamiliarity(supabase, assignment, familiarity);

  return jsonResponse({
    condition: assignment.condition,
    explanation_type: assignment.condition,
    familiarity,
  });
}

async function chat(req: Request, messages: Msg[], payload: Record<string, unknown>) {
  const supabase = createSupabaseClientForRequest(req);
  const assignment = await resolveSessionCondition(supabase, payload);
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return fallbackChat(messages, assignment.condition);

  const model = Deno.env.get("OPENAI_MODEL") ?? OPENAI_CHAT_MODEL;
  const systemPrompt = await buildChatSystemPrompt(assignment);
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      stream: true,
      temperature: 0.7,
    }),
  });

  if (!resp.ok) {
    if (resp.status === 429) return jsonResponse({ error: "Terlalu banyak permintaan. Coba lagi sebentar." }, 429);
    if (resp.status === 401) return jsonResponse({ error: "Konfigurasi OpenAI belum valid." }, 500);
    const text = await resp.text();
    console.error("OpenAI error", resp.status, text);
    return jsonResponse({ error: "OpenAI API error" }, 500);
  }

  return new Response(resp.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
}

function fallbackChat(messages: Msg[], condition: ExplanationType) {
  const userTurns = messages.filter((message) => message.role === "user").length;
  let content: string;
  if (userTurns <= 1) {
    content = PROMPT_CONFIG[condition].greeting;
  } else if (condition === "A") {
    content = "Aku sudah punya gambaran atribut aromamu. Kalau kamu siap, tekan tombol rekomendasi supaya aku cocokkan preferensimu dengan Top-3 dari knowledge graph Aromatique.";
  } else if (condition === "B") {
    content = "Aku sudah menangkap suasana yang ingin kamu bawa lewat parfum ini. Kalau kamu siap, tekan tombol rekomendasi supaya aku pilihkan tiga aroma yang paling terasa dekat dengan ceritamu.";
  } else {
    content = "Aku sudah punya titik banding yang cukup untuk membedakan opsi aromanya. Kalau kamu siap, tekan tombol rekomendasi supaya aku ambil tiga pilihan yang bisa kamu bandingkan.";
  }
  const chunk = JSON.stringify({ choices: [{ delta: { content } }] });
  return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
  });
}

async function recommend(req: Request, messages: Msg[], payload: Record<string, unknown>) {
  const supabase = createSupabaseClientForRequest(req);
  const assignment = await resolveSessionCondition(supabase, payload);

  const { data: products, error: productError } = await supabase
    .from("products")
    .select("product_id,kgat_product_id,product_name,visual_note,revolutionize,main_accords,olfactory_family,meaning,data_quality,accords,visual_notes")
    .order("kgat_product_id", { ascending: true })
    .limit(1000);

  if (productError) throw productError;
  if (!products?.length) throw new Error("Product catalog is empty");

  const profile = await extractPreferencesHybrid(messages, products as ProductRow[]);
  const excludedProductIds = await resolveExcludedProductIds(supabase, assignment.conversationId, payload);
  const ranked = selectRecommendationBatch(rankProducts(products as ProductRow[], profile), excludedProductIds, 3);
  const topProductIds = ranked.map((item) => item.product.product_id);

  const { data: kgEdges, error: edgeError } = await supabase
    .from("kg_edges")
    .select("head_entity_id,head_entity_type,head_name,relation_name,tail_entity_id,tail_entity_type,tail_name,head_product_id")
    .eq("model_version", MODEL_VERSION)
    .in("head_product_id", topProductIds);

  if (edgeError) throw edgeError;

  let recommendations: RecommendationOutput[] = ranked.map((item, index) => {
    const kgPath = buildKgPath(item, (kgEdges ?? []) as KgEdge[]);
    const reason = buildReason(item, kgPath, assignment.condition);
    return {
      rank: index + 1,
      product_id: item.product.product_id,
      product_name: item.product.product_name,
      olfactory_family: item.product.olfactory_family ?? "",
      main_accords: item.product.main_accords ?? (item.product.accords ?? []).join(", "),
      visual_note: item.product.visual_note ?? (item.product.visual_notes ?? []).join(" / "),
      revolutionize: item.product.revolutionize,
      match_score: item.matchScore,
      reason,
      kg_path: kgPath,
      id: item.product.product_id,
      name: item.product.product_name,
      family: item.product.olfactory_family ?? "",
      notes: (item.product.accords ?? []).slice(0, 6),
      description: item.product.meaning ?? item.product.visual_note ?? "",
      match: item.matchScore,
    };
  });

  const gptExplanation = await explainRecommendationsWithGPT(assignment, profile, recommendations);
  if (gptExplanation.reasons.size > 0) {
    recommendations = recommendations.map((recommendation) => ({
      ...recommendation,
      reason: gptExplanation.reasons.get(recommendation.product_id) ?? gptExplanation.reasons.get(String(recommendation.rank)) ?? recommendation.reason,
    }));
  }

  const summary = gptExplanation.summary ?? profile.summary;
  const recommendationId = await persistRecommendationBatch(supabase, payload, assignment, recommendations, summary, gptExplanation.payload);

  return jsonResponse({
    recommendations,
    products: recommendations,
    summary,
    recommendation_engine: RECOMMENDATION_ENGINE,
    model_version: MODEL_VERSION,
    condition: assignment.condition,
    explanation_type: assignment.condition,
    prompt_name: assignment.promptName,
    prompt_version: assignment.promptVersion,
    llm_model: assignment.llmModel,
    explanation_payload: gptExplanation.payload,
    recommendation_id: recommendationId,
    excluded_product_ids: Array.from(excludedProductIds),
  });
}

async function extractPreferencesHybrid(messages: Msg[], products: ProductRow[]): Promise<PreferenceProfile> {
  const deterministic = extractPreferencesDeterministic(messages, products);
  const nlu = await extractPreferencesWithGPT(messages, products);
  if (!nlu) return deterministic;

  const vocabulary = buildCatalogVocabulary(products);
  const likedTerms = normalizeTermsToVocabulary(
    [...nlu.liked_terms, ...nlu.occasion, ...nlu.style, ...nlu.time_of_use],
    vocabulary,
  );
  const dislikedTerms = normalizeTermsToVocabulary(nlu.disliked_terms, vocabulary);

  likedTerms.forEach((term) => deterministic.terms.add(term));
  dislikedTerms.forEach((term) => {
    deterministic.negativeTerms.add(term);
    deterministic.terms.delete(term);
  });

  const labels = unique([
    ...deterministic.labels,
    ...nlu.liked_terms,
    ...nlu.occasion,
    ...nlu.style,
  ].map((label) => label.trim()).filter(Boolean)).slice(0, 8);

  return {
    terms: deterministic.terms,
    negativeTerms: deterministic.negativeTerms,
    labels: labels.length ? labels : deterministic.labels,
    summary: nlu.summary || deterministic.summary,
    nlu,
  };
}

function extractPreferencesDeterministic(messages: Msg[], products: ProductRow[]): PreferenceProfile {
  const text = normalize(messages.filter((msg) => msg.role === "user").map((msg) => msg.content).join(" "));
  const terms = new Set<string>();
  const negativeTerms = new Set<string>();
  const labels: string[] = [];

  for (const entry of PREFERENCE_LEXICON) {
    const matchedAliases = entry.aliases.filter((alias) => text.includes(normalize(alias)));
    if (matchedAliases.length > 0) {
      const hasNegativeMention = matchedAliases.some((alias) => isNegativeMention(text, normalize(alias)));
      if (hasNegativeMention) {
        entry.terms.forEach((term) => negativeTerms.add(normalize(term)));
        continue;
      }
      labels.push(entry.label);
      entry.terms.forEach((term) => terms.add(normalize(term)));
    }
  }

  const catalogTerms = new Set<string>();
  for (const product of products) {
    productTerms(product).forEach((term) => catalogTerms.add(term));
  }

  for (const term of catalogTerms) {
    if (term.length > 2 && text.includes(term)) terms.add(term);
  }

  const displayLabels = labels.length ? unique(labels) : Array.from(terms).slice(0, 4);
  const summary = displayLabels.length
    ? `Preferensi utama yang terbaca: ${displayLabels.join(", ")}.`
    : "Preferensi pengguna belum spesifik, jadi rekomendasi dipilih dari profil aroma yang lengkap dan mudah dipakai.";

  return { terms, negativeTerms, labels: displayLabels, summary, nlu: null };
}

async function extractPreferencesWithGPT(messages: Msg[], products: ProductRow[]): Promise<NluProfile | null> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;

  const userText = messages.filter((msg) => msg.role === "user").map((msg) => msg.content).join("\n").trim();
  if (!userText) return null;

  const vocabulary = Array.from(buildCatalogVocabulary(products)).slice(0, 260);
  const model = Deno.env.get("OPENAI_MODEL") ?? OPENAI_CHAT_MODEL;
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You extract fragrance preferences from Indonesian user messages. Return only valid JSON. Use concise fragrance terms. Do not invent product recommendations. Capture liked_terms, disliked_terms, occasion, style, intensity, time_of_use, and summary. Prefer terms from the provided Aromatique vocabulary.",
        },
        {
          role: "user",
          content: JSON.stringify({
            schema: {
              liked_terms: ["fresh", "floral"],
              disliked_terms: ["too sweet"],
              occasion: ["work"],
              style: ["soft", "clean"],
              intensity: "light | moderate | strong | unknown",
              time_of_use: ["day"],
              summary: "string",
            },
            aromatique_vocabulary: vocabulary,
            messages: userText,
          }),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 500,
    }),
  });

  if (!resp.ok) {
    console.error("OpenAI NLU error", resp.status, await resp.text());
    return null;
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  const parsed = parseJsonObject(content);
  if (!parsed || typeof parsed !== "object") return null;

  return {
    liked_terms: stringArray((parsed as Record<string, unknown>).liked_terms),
    disliked_terms: stringArray((parsed as Record<string, unknown>).disliked_terms),
    occasion: stringArray((parsed as Record<string, unknown>).occasion),
    style: stringArray((parsed as Record<string, unknown>).style),
    intensity: normalizeIntensity((parsed as Record<string, unknown>).intensity),
    time_of_use: stringArray((parsed as Record<string, unknown>).time_of_use),
    summary: typeof (parsed as Record<string, unknown>).summary === "string" ? ((parsed as Record<string, unknown>).summary as string) : "",
  };
}

function rankProducts(products: ProductRow[], profile: PreferenceProfile): ScoredProduct[] {
  const scored = products.map((product) => {
    const exactTerms = new Set(productTerms(product));
    const searchable = normalize([
      product.product_name,
      product.visual_note,
      product.revolutionize,
      product.main_accords,
      product.olfactory_family,
      product.meaning,
      ...(product.accords ?? []),
      ...(product.visual_notes ?? []),
    ].filter(Boolean).join(" "));

    let score = product.data_quality === "COMPLETE" ? 2 : 0;
    const matchedTerms = new Set<string>();

    for (const term of profile.terms) {
      if (exactTerms.has(term)) {
        score += 12;
        matchedTerms.add(term);
      } else if (searchable.includes(term)) {
        score += 5;
        matchedTerms.add(term);
      }
    }

    for (const term of profile.negativeTerms) {
      if (exactTerms.has(term)) {
        score -= 10;
      } else if (searchable.includes(term)) {
        score -= 5;
      }
    }

    if (profile.terms.size === 0) {
      score += (product.accords?.length ?? 0) * 0.5;
      if (product.revolutionize) score += 1;
    }

    return {
      product,
      score,
      matchScore: Math.max(62, Math.min(98, Math.round(62 + score * 2.4))),
      matchedTerms,
    };
  });

  return scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aComplete = a.product.data_quality === "COMPLETE" ? 1 : 0;
    const bComplete = b.product.data_quality === "COMPLETE" ? 1 : 0;
    if (bComplete !== aComplete) return bComplete - aComplete;
    return a.product.kgat_product_id - b.product.kgat_product_id;
  });
}

function selectRecommendationBatch(ranked: ScoredProduct[], excludedProductIds: Set<string>, size: number) {
  const fresh = ranked.filter((item) => !excludedProductIds.has(item.product.product_id)).slice(0, size);
  if (fresh.length >= size) return fresh;

  const selectedIds = new Set(fresh.map((item) => item.product.product_id));
  const fallback = ranked
    .filter((item) => !selectedIds.has(item.product.product_id))
    .slice(0, size - fresh.length);

  return [...fresh, ...fallback];
}

function buildKgPath(item: ScoredProduct, edges: KgEdge[]) {
  const productEdges = edges.filter((edge) => edge.head_product_id === item.product.product_id);
  const preferredRelations = ["has_accord", "has_visual_note", "belongs_to_family", "inspired_by"];

  const pathEdges = productEdges
    .filter((edge) => preferredRelations.includes(edge.relation_name))
    .map((edge) => {
      const normalizedTail = normalize(edge.tail_name);
      const matched = item.matchedTerms.has(normalizedTail) || Array.from(item.matchedTerms).some((term) => normalizedTail.includes(term));
      return {
        relation: edge.relation_name,
        entity: edge.tail_name,
        matched,
        reason: relationReason(edge.relation_name, edge.tail_name, matched),
      };
    })
    .sort((a, b) => Number(b.matched) - Number(a.matched));

  if (pathEdges.length > 0) return pathEdges.slice(0, 5);

  return (item.product.accords ?? []).slice(0, 3).map((accord) => ({
    relation: "has_accord",
    entity: accord,
    matched: item.matchedTerms.has(normalize(accord)),
    reason: relationReason("has_accord", accord, item.matchedTerms.has(normalize(accord))),
  }));
}

function buildReason(item: ScoredProduct, kgPath: ReturnType<typeof buildKgPath>, explanationType: ExplanationType) {
  const product = item.product;
  const matched = kgPath.filter((path) => path.matched).map((path) => path.entity).slice(0, 3);
  const leadTerms = matched.length ? matched : (product.accords ?? []).slice(0, 3);

  if (explanationType === "A") {
    return `${product.product_name} cocok karena profil aromanya ${leadTerms.join(", ") || product.olfactory_family || "seimbang"} dan tetap selaras untuk preferensi yang kamu ceritakan.`;
  }

  if (explanationType === "B") {
    return `Kecocokannya terutama datang dari ${leadTerms.join(", ") || "accord utama produk"} pada family ${product.olfactory_family ?? "Aromatique"}, sehingga rekomendasi ini punya arah aroma yang relevan dengan kebutuhanmu.`;
  }

  const pathText = kgPath.slice(0, 3).map((path) => `${RELATION_LABEL[path.relation] ?? path.relation} ${path.entity}`).join("; ");
  return `Jalur knowledge graph untuk ${product.product_name} menunjukkan: ${pathText}. Karena beberapa node ini beririsan dengan preferensimu, produk ini masuk Top-3.`;
}

function relationReason(relation: string, entity: string, matched: boolean) {
  if (matched) return `Node ${entity} cocok langsung dengan preferensi pengguna.`;
  if (relation === "has_accord") return `Accord ${entity} membentuk karakter aroma produk.`;
  if (relation === "has_visual_note") return `Visual note ${entity} membantu menjelaskan kesan aroma produk.`;
  if (relation === "belongs_to_family") return `Family ${entity} memberi konteks kategori olfaktori produk.`;
  if (relation === "inspired_by") return `Referensi ${entity} memberi konteks inspirasi produk.`;
  return `Relasi ${relation} memberi konteks tambahan untuk rekomendasi.`;
}

function createSupabaseClientForRequest(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseKey = serviceRoleKey ?? Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase Edge Function env");

  return createClient(
    supabaseUrl,
    supabaseKey,
    serviceRoleKey ? {} : { global: { headers: { Authorization: req.headers.get("Authorization") ?? `Bearer ${supabaseKey}` } } },
  );
}

async function resolveSessionCondition(supabase: SupabaseClient, payload: Record<string, unknown>): Promise<ExperimentAssignment> {
  const payloadConversationId = stringValue(payload.conversation_id);
  const payloadSessionId = stringValue(payload.session_id);
  let conversationId = payloadConversationId;
  let sessionId = payloadSessionId;
  let condition: ExplanationType | null = null;

  if (conversationId) {
    const { data: conversation, error } = await supabase
      .from("conversations")
      .select("id,session_id,condition")
      .eq("id", conversationId)
      .maybeSingle();
    if (error) throw error;
    sessionId = sessionId ?? stringValue(conversation?.session_id);
    condition = conditionFromUnknown(conversation?.condition);
  }

  if (!condition && conversationId) {
    const { data: row, error } = await supabase
      .from("experiment_sessions")
      .select("condition")
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (error) throw error;
    condition = conditionFromUnknown(row?.condition);
  }

  if (!condition && sessionId) {
    const { data: row, error } = await supabase
      .from("experiment_sessions")
      .select("condition")
      .eq("session_id", sessionId)
      .order("assigned_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    condition = conditionFromUnknown(row?.condition);
  }

  if (!condition) {
    condition = await assignBalancedCondition(supabase);
  }

  const assignment = getPromptMetadata(condition, conversationId, sessionId);
  await persistExperimentAssignment(supabase, assignment);
  return assignment;
}

function getPromptMetadata(condition: ExplanationType, conversationId: string | null, sessionId: string | null): ExperimentAssignment {
  const config = PROMPT_CONFIG[condition];
  return {
    condition,
    conversationId,
    sessionId,
    promptName: config.promptName,
    promptVersion: PROMPT_VERSION,
    llmModel: Deno.env.get("OPENAI_MODEL") ?? OPENAI_CHAT_MODEL,
  };
}

async function assignBalancedCondition(supabase: SupabaseClient): Promise<ExplanationType> {
  const { data, error } = await supabase
    .from("experiment_sessions")
    .select("session_id")
    .limit(10000);
  if (error) throw error;

  const sessionCount = new Set((data ?? []).map((row) => stringValue(row.session_id)).filter(Boolean)).size;
  return CONDITIONS[sessionCount % CONDITIONS.length];
}

async function persistExperimentAssignment(supabase: SupabaseClient, assignment: ExperimentAssignment) {
  if (assignment.conversationId) {
    const { error: conversationError } = await supabase
      .from("conversations")
      .update({ condition: assignment.condition })
      .eq("id", assignment.conversationId);
    if (conversationError) throw conversationError;
  }

  if (!assignment.sessionId || !assignment.conversationId) return;

  const { error } = await supabase.from("experiment_sessions").upsert(
    {
      session_id: assignment.sessionId,
      conversation_id: assignment.conversationId,
      condition: assignment.condition,
      explanation_type: assignment.condition,
      recommendation_engine: RECOMMENDATION_ENGINE,
      model_version: MODEL_VERSION,
      prompt_name: assignment.promptName,
      prompt_version: assignment.promptVersion,
      llm_model: assignment.llmModel,
      metadata: { assigned_by: "aromatique-chat", prompt_version: assignment.promptVersion },
    },
    { onConflict: "conversation_id" },
  );
  if (error) throw error;
}

async function persistFamiliarity(supabase: SupabaseClient, assignment: ExperimentAssignment, familiarity: FamiliarityLevel) {
  if (!assignment.conversationId && !assignment.sessionId) return;

  let query = supabase
    .from("experiment_sessions")
    .select("metadata")
    .limit(1);

  query = assignment.conversationId
    ? query.eq("conversation_id", assignment.conversationId)
    : query.eq("session_id", assignment.sessionId);

  const { data: row, error: readError } = await query.maybeSingle();
  if (readError) throw readError;

  const existingMetadata = row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};

  let updateQuery = supabase
    .from("experiment_sessions")
    .update({
      familiarity,
      metadata: {
        ...existingMetadata,
        familiarity,
        familiarity_recorded_at: new Date().toISOString(),
      },
    });

  updateQuery = assignment.conversationId
    ? updateQuery.eq("conversation_id", assignment.conversationId)
    : updateQuery.eq("session_id", assignment.sessionId);

  const { error: updateError } = await updateQuery;
  if (updateError) throw updateError;
}

async function resolveExcludedProductIds(supabase: SupabaseClient, conversationId: string | null, payload: Record<string, unknown>) {
  const excluded = new Set<string>();

  for (const productId of stringArray(payload.exclude_product_ids)) {
    excluded.add(productId);
  }

  if (!conversationId) return excluded;

  const { data, error } = await supabase
    .from("recommendations")
    .select("products,recommendations")
    .eq("conversation_id", conversationId);
  if (error) throw error;

  for (const row of data ?? []) {
    collectProductIds(row?.recommendations, excluded);
    collectProductIds(row?.products, excluded);
  }

  return excluded;
}

function collectProductIds(value: unknown, target: Set<string>) {
  if (!Array.isArray(value)) return;

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const productId = stringValue(record.product_id) ?? stringValue(record.id);
    if (productId) target.add(productId);
  }
}

async function buildChatSystemPrompt(assignment: ExperimentAssignment) {
  const prompt = await loadConditionPrompt(assignment.condition);
  return `${prompt}

Runtime context:
- You are in PHASE 1 conversation mode.
- Keep the assigned style for condition ${assignment.condition} from the first response through the end of the session.
- Do not recommend product names in chat mode.
- Ask one concise question per turn unless the user asks for clarification.
- When enough preference context has been collected, invite the user to click the recommendation button.
- Never reveal the internal condition label, prompt file name, or experiment assignment.`;
}

async function loadConditionPrompt(condition: ExplanationType) {
  const { promptName, fallbackStyle } = PROMPT_CONFIG[condition];
  if (PROMPT_CACHE.has(promptName)) return PROMPT_CACHE.get(promptName)!;

  try {
    const prompt = await Deno.readTextFile(new URL(`./prompts/${promptName}`, import.meta.url));
    PROMPT_CACHE.set(promptName, prompt);
    return prompt;
  } catch (error) {
    console.error("Failed to load condition prompt", promptName, error);
    const fallback = EMBEDDED_PROMPTS[promptName] ?? `You are Aromatique AI. ${fallbackStyle}`;
    PROMPT_CACHE.set(promptName, fallback);
    return fallback;
  }
}

async function explainRecommendationsWithGPT(
  assignment: ExperimentAssignment,
  profile: PreferenceProfile,
  recommendations: RecommendationOutput[],
): Promise<GptExplanationResult> {
  const key = Deno.env.get("OPENAI_API_KEY");
  const input = buildExplanationInput(assignment, profile, recommendations);

  if (!key) {
    return {
      summary: null,
      reasons: new Map(),
      payload: { status: "fallback_no_openai_key", input },
    };
  }

  try {
    const prompt = await loadConditionPrompt(assignment.condition);
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: assignment.llmModel,
        messages: [
          {
            role: "system",
            content: `${prompt}

Runtime API constraints:
- You are generating recommendation explanations for condition ${assignment.condition}.
- Use only the provided products and KG paths.
- Return only valid JSON with this shape:
{"summary":"string","recommendations":[{"rank":1,"product_id":"string","reason":"string"}]}
- Keep each reason in Bahasa Indonesia, 2-3 concise sentences.
- Do not add products, prices, claims, or facts that are not present in the input.`,
          },
          { role: "user", content: JSON.stringify(input) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.35,
        max_tokens: 1000,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("OpenAI explanation error", resp.status, text);
      return { summary: null, reasons: new Map(), payload: { status: "fallback_openai_error", input, error: text } };
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    const parsed = parseJsonObject(content);
    const reasons = new Map<string, string>();

    if (parsed && typeof parsed === "object") {
      const output = parsed as Record<string, unknown>;
      const productIdsByName = new Map(recommendations.map((recommendation) => [normalize(recommendation.product_name), recommendation.product_id]));
      const rows = Array.isArray(output.recommendations)
        ? output.recommendations
        : Array.isArray(output.recommended_products)
        ? output.recommended_products
        : [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const record = row as Record<string, unknown>;
        const reason = typeof record.reason === "string"
          ? record.reason.trim()
          : typeof record.explanation === "string"
          ? record.explanation.trim()
          : "";
        if (!reason) continue;
        const productId = stringValue(record.product_id) ?? productIdsByName.get(normalize(stringValue(record.product_name) ?? ""));
        const rank = typeof record.rank === "number" ? String(record.rank) : stringValue(record.rank);
        if (productId) reasons.set(productId, reason);
        if (rank) reasons.set(rank, reason);
      }

      return {
        summary: typeof output.summary === "string" && output.summary.trim() ? output.summary.trim() : null,
        reasons,
        payload: { status: reasons.size > 0 ? "gpt" : "fallback_invalid_gpt_output", input, output },
      };
    }

    return { summary: null, reasons, payload: { status: "fallback_parse_error", input, raw: content } };
  } catch (error) {
    console.error("Explanation generation failed", error);
    return {
      summary: null,
      reasons: new Map(),
      payload: { status: "fallback_exception", input, error: error instanceof Error ? error.message : String(error) },
    };
  }
}

function buildExplanationInput(
  assignment: ExperimentAssignment,
  profile: PreferenceProfile,
  recommendations: RecommendationOutput[],
) {
  return {
    condition: assignment.condition,
    user_preference_summary: profile.summary,
    extracted_preferences: profile.nlu,
    prompt_name: assignment.promptName,
    recommendation_engine: RECOMMENDATION_ENGINE,
    model_version: MODEL_VERSION,
    recommendations: recommendations.map((recommendation) => ({
      rank: recommendation.rank,
      product_id: recommendation.product_id,
      product_name: recommendation.product_name,
      olfactory_family: recommendation.olfactory_family,
      main_accords: recommendation.main_accords,
      visual_note: recommendation.visual_note,
      revolutionize: recommendation.revolutionize,
      match_score: recommendation.match_score,
      kg_path: recommendation.kg_path,
    })),
  };
}

async function persistRecommendationBatch(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  assignment: ExperimentAssignment,
  recommendations: RecommendationOutput[],
  summary: string,
  explanationPayload: Record<string, unknown>,
) {
  if (!assignment.conversationId) return null;

  const batchIndex = await resolveBatchIndex(supabase, assignment.conversationId, payload.batch_index);
  const kgPaths = recommendations.map((recommendation) => ({
    product_id: recommendation.product_id,
    kg_path: recommendation.kg_path,
  }));

  const { data, error } = await supabase
    .from("recommendations")
    .insert({
      conversation_id: assignment.conversationId,
      batch_index: batchIndex,
      products: recommendations,
      recommendations,
      summary,
      kg_paths: kgPaths,
      explanation_type: assignment.condition,
      recommendation_engine: RECOMMENDATION_ENGINE,
      model_version: MODEL_VERSION,
      prompt_name: assignment.promptName,
      prompt_version: assignment.promptVersion,
      llm_model: assignment.llmModel,
      explanation_payload: explanationPayload,
    })
    .select("id")
    .single();

  if (error) throw error;
  return stringValue(data?.id);
}

async function resolveBatchIndex(supabase: SupabaseClient, conversationId: string, value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;

  const { data, error } = await supabase
    .from("recommendations")
    .select("batch_index")
    .eq("conversation_id", conversationId)
    .order("batch_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (typeof data?.batch_index === "number" ? data.batch_index : 0) + 1;
}

function productTerms(product: ProductRow) {
  return unique([
    ...(product.accords ?? []),
    ...(product.visual_notes ?? []),
    product.main_accords ?? "",
    product.visual_note ?? "",
    product.olfactory_family ?? "",
  ].flatMap((value) => splitTerms(value)).map(normalize).filter(Boolean));
}

function splitTerms(value: string) {
  return value.split(/,|\/|;/g).map((term) => term.trim()).filter(Boolean);
}

function buildCatalogVocabulary(products: ProductRow[]) {
  const terms = new Set<string>();
  for (const product of products) {
    productTerms(product).forEach((term) => terms.add(term));
  }
  return terms;
}

function normalizeTermsToVocabulary(values: string[], vocabulary: Set<string>) {
  const normalized = new Set<string>();
  const vocab = Array.from(vocabulary);

  for (const value of values) {
    const term = normalize(value);
    if (!term) continue;
    if (vocabulary.has(term)) {
      normalized.add(term);
      continue;
    }

    const close = vocab.find((candidate) => candidate.includes(term) || term.includes(candidate));
    if (close) normalized.add(close);
  }

  return Array.from(normalized);
}

function isNegativeMention(text: string, alias: string) {
  const index = text.indexOf(alias);
  if (index < 0) return false;
  const context = text.slice(Math.max(0, index - 36), Math.min(text.length, index + alias.length + 16));
  return /\b(tidak|jangan|hindari|avoid|nggak|ngga|gak|ga|kurang suka|terlalu)\b/.test(context);
}

function parseJsonObject(content: unknown): unknown | null {
  if (typeof content !== "string") return null;
  const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function normalizeIntensity(value: unknown): NluProfile["intensity"] {
  const normalized = typeof value === "string" ? normalize(value) : "";
  if (["light", "ringan", "soft", "subtle"].includes(normalized)) return "light";
  if (["moderate", "sedang", "medium", "natural"].includes(normalized)) return "moderate";
  if (["strong", "kuat", "intense", "bold"].includes(normalized)) return "strong";
  return "unknown";
}

function normalizeFamiliarity(value: unknown): FamiliarityLevel | null {
  const normalized = typeof value === "string" ? normalize(value) : "";
  if (["pemula", "beginner", "awam"].includes(normalized)) return "pemula";
  if (["penggemar", "enthusiast", "intermediate"].includes(normalized)) return "penggemar";
  if (["kolektor", "collector", "expert"].includes(normalized)) return "kolektor";
  return null;
}

function conditionFromUnknown(value: unknown): ExplanationType | null {
  return typeof value === "string" && CONDITIONS.includes(value as ExplanationType) ? value as ExplanationType : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeMessages(messages: unknown[]): Msg[] {
  return messages
    .filter((message): message is Msg => {
      if (!message || typeof message !== "object") return false;
      const record = message as Record<string, unknown>;
      return (record.role === "user" || record.role === "assistant") && typeof record.content === "string";
    })
    .map((message) => ({ role: message.role, content: message.content }));
}

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
