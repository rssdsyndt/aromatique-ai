import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Annoyed,
  Beaker,
  CheckCircle2,
  Frown,
  GraduationCap,
  HeartHandshake,
  History,
  Laugh,
  Lock,
  Meh,
  Menu,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Smile,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import logoAromatique from "@/assets/logo-aromatique.png";

type Msg = { role: "user" | "assistant"; content: string };
type Condition = "A" | "B" | "C";
type Familiarity = "pemula" | "penggemar" | "kolektor";
type KgPathItem = { relation: string; entity: string; matched: boolean; reason: string };
type Product = {
  id: string;
  product_id?: string;
  name: string;
  product_name?: string;
  family: string;
  olfactory_family?: string;
  notes: string[];
  main_accords?: string;
  visual_note?: string;
  revolutionize?: string | null;
  description: string;
  reason: string;
  match?: number;
  match_score?: number;
  kg_path?: KgPathItem[];
};
type RecBatch = {
  batch_index: number;
  products: Product[];
  summary?: string;
  explanation_type?: Condition;
  recommendation_engine?: string;
  model_version?: string;
  prompt_name?: string;
  prompt_version?: string;
  llm_model?: string;
  explanation_payload?: unknown;
};
type View = "welcome" | "chat" | "recs" | "feedback" | "thanks";

/**
 * Satu klik jawaban pada kuesioner.
 *
 * `at_ms` adalah jam dinding sejak halaman feedback dibuka, `active_ms` adalah
 * jam yang sama dikurangi seluruh jeda (tab disembunyikan / pindah layar).
 * Keduanya disimpan mentah supaya metrik apa pun bisa diturunkan belakangan
 * tanpa mengulang pengumpulan data.
 *
 * `since_prev_ms` sengaja `null` untuk klik pertama. Klik pertama tidak
 * mengukur deliberasi melainkan orientasi awal — membaca header, memindai
 * kedelapan pertanyaan, memutuskan mulai dari mana — jadi nilainya tidak
 * sebanding dengan klik berikutnya. `null` membuat keputusan metodologis itu
 * ikut tersimpan di datanya: AVG() di SQL melewatkannya dengan sendirinya,
 * sehingga waktu orientasi tidak bisa tidak sengaja tercampur ke rata-rata
 * deliberasi. Angka mentahnya tetap ada di `at_ms` dan di `onset_ms`.
 */
type FeedbackEvent = {
  order: number;
  code: string;
  value: number;
  at_ms: number;
  active_ms: number;
  since_prev_ms: number | null;
  is_change: boolean;
};

const SESSION_KEY = "aromatique_session_id";
const CONSENT_KEY = "aromatique_consent_v1";
const MODEL_VERSION = "kgat_baseline_epoch69_v1";
const RECOMMENDATION_ENGINE = "kgat_baseline";
const FAMILIARITY_QUESTION = "Sebelum kita mulai, boleh aku tahu dulu — seberapa familiar\nkamu dengan dunia parfum?";
const DEFAULT_GREETINGS: Record<Condition, string> = {
  A: `Halo! Aku Aromatique AI. Aku akan bantu memetakan preferensi aromamu lewat karakter yang konkret seperti fresh, floral, sweet, woody, dan intensity. ${FAMILIARITY_QUESTION}`,
  B: `Halo! Aku Aromatique AI. Aku akan bantu menemukan parfum yang terasa pas dengan suasana, mood, dan kesan yang ingin kamu bawa. ${FAMILIARITY_QUESTION}`,
  C: `Halo! Aku Aromatique AI. Aku akan bantu membandingkan pilihan aroma supaya kamu bisa melihat mana yang paling dekat dengan preferensimu. ${FAMILIARITY_QUESTION}`,
};
const RecsScreen = lazy(() => import("./AromatiqueRecs"));
const FAMILIARITY_OPTIONS: { value: Familiarity; label: string; message: string }[] = [
  { value: "pemula", label: "🌱 Pemula", message: "Saya pemula dalam dunia parfum." },
  { value: "penggemar", label: "🌸 Penggemar", message: "Saya penggemar parfum." },
  { value: "kolektor", label: "💎 Kolektor", message: "Saya kolektor parfum." },
];

const sessionStorageFallback = new Map<string, string>();

function getBrowserStorageItem(key: string) {
  try {
    return window.localStorage.getItem(key) ?? sessionStorageFallback.get(key) ?? null;
  } catch {
    return sessionStorageFallback.get(key) ?? null;
  }
}

function setBrowserStorageItem(key: string, value: string) {
  sessionStorageFallback.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Some Safari/privacy contexts disable localStorage. Keep this tab working in memory.
  }
}

function createSessionId() {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();

  if (typeof webCrypto?.getRandomValues === "function") {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `aromatique-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getSessionId() {
  if (typeof window === "undefined") return "";
  let s = getBrowserStorageItem(SESSION_KEY);
  if (!s) {
    s = createSessionId();
    setBrowserStorageItem(SESSION_KEY, s);
  }
  return s;
}

function splitDisplayTerms(value?: string | null) {
  return (value ?? "").split(/,|\/|;/g).map(v => v.trim()).filter(Boolean);
}

function normalizeRecommendation(raw: any, index: number): Product {
  const notes = Array.isArray(raw.notes) && raw.notes.length
    ? raw.notes
    : splitDisplayTerms(raw.main_accords ?? raw.visual_note);
  const match = raw.match_score ?? raw.match ?? [98, 92, 88][index] ?? 80;
  return {
    ...raw,
    id: String(raw.product_id ?? raw.id),
    product_id: String(raw.product_id ?? raw.id),
    name: raw.product_name ?? raw.name,
    product_name: raw.product_name ?? raw.name,
    family: raw.olfactory_family ?? raw.family ?? "",
    olfactory_family: raw.olfactory_family ?? raw.family ?? "",
    notes,
    description: raw.description ?? raw.visual_note ?? "",
    reason: raw.reason ?? "Produk ini cocok dengan preferensi aroma yang kamu ceritakan.",
    match,
    match_score: match,
    kg_path: Array.isArray(raw.kg_path) ? raw.kg_path : [],
  };
}

function normalizeGreeting(condition: Condition, serverGreeting?: string | null) {
  const greeting = (serverGreeting ?? "").trim();
  const hasFamiliarityQuestion = /seberapa familiar\s+kamu dengan dunia parfum/i.test(greeting.replace(/\s+/g, " "));
  return hasFamiliarityQuestion ? greeting : DEFAULT_GREETINGS[condition];
}

function renderInlineMarkdown(content: string) {
  const nodes = [];
  const pattern = /\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) nodes.push(content.slice(lastIndex, match.index));
    nodes.push(<strong key={`md-${match.index}`} className="font-bold">{match[1] ?? match[2]}</strong>);
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < content.length) nodes.push(content.slice(lastIndex));
  return nodes;
}

function MarkdownText({ content }: { content: string }) {
  return <>{renderInlineMarkdown(content)}</>;
}

function getFamiliarityFromText(content: string): Familiarity | null {
  const text = content.toLowerCase();
  if (text.includes("pemula")) return "pemula";
  if (text.includes("penggemar")) return "penggemar";
  if (text.includes("kolektor")) return "kolektor";
  return null;
}

function detectFamiliarity(messages: Msg[]): Familiarity | null {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const familiarity = getFamiliarityFromText(message.content);
    if (familiarity) return familiarity;
  }
  return null;
}

function isFamiliarityOnlyMessage(content: string) {
  const normalized = content.trim().toLowerCase();
  return FAMILIARITY_OPTIONS.some(option =>
    normalized === option.value ||
    normalized === option.message.toLowerCase() ||
    normalized === option.label.toLowerCase()
  );
}

const FEEDBACK_GROUPS: { title: string; icon: string; items: { code: string; text: string }[] }[] = [
  {
    title: "Kepercayaan terhadap AI", icon: "psychology",
    items: [
      { code: "T1", text: "Saya percaya ketiga parfum yang direkomendasikan sesuai dengan preferensi saya secara keseluruhan." },
      { code: "T2", text: "Penjelasan chatbot membuat saya yakin sistem ini memahami kebutuhan saya." },
    ],
  },
  {
    title: "Niat Pembelian", icon: "trending_up",
    items: [
      { code: "PI1", text: "Setelah membaca penjelasan dari chatbot, saya tertarik untuk membeli salah satu parfum yang direkomendasikan." },
      { code: "PI2", text: "Saya kemungkinan besar akan mempertimbangkan membeli parfum ini setelah sesi ini." },
    ],
  },
  {
    title: "Kegunaan & Kepuasan", icon: "auto_awesome",
    items: [
      { code: "U1", text: "Penjelasan chatbot membantu saya memahami mengapa parfum ini cocok untuk saya." },
      { code: "U2", text: "Penjelasan chatbot berguna untuk mendukung keputusan pembelian saya." },
      { code: "S1", text: "Secara keseluruhan, saya puas dengan pengalaman menggunakan chatbot ini." },
      { code: "S2", text: "Saya akan merekomendasikan chatbot ini kepada orang lain yang ingin memilih parfum." },
    ],
  },
];

const SCALE = [
  { v: 1, icon: "sentiment_very_dissatisfied", label: "Sangat Tidak Setuju" },
  { v: 2, icon: "sentiment_dissatisfied", label: "Tidak Setuju" },
  { v: 3, icon: "sentiment_neutral", label: "Netral" },
  { v: 4, icon: "sentiment_satisfied", label: "Setuju" },
  { v: 5, icon: "sentiment_very_satisfied", label: "Sangat Setuju" },
];

const ICONS: Record<string, LucideIcon> = {
  add: Plus,
  biotech: Beaker,
  chat: MessageCircle,
  history: History,
  lock: Lock,
  menu: Menu,
  refresh: RefreshCw,
  school: GraduationCap,
  send: Send,
  sentiment_dissatisfied: Annoyed,
  sentiment_neutral: Meh,
  sentiment_satisfied: Smile,
  sentiment_very_dissatisfied: Frown,
  sentiment_very_satisfied: Laugh,
  task_alt: CheckCircle2,
  verified_user: ShieldCheck,
  volunteer_activism: HeartHandshake,
};

const MI = ({ name, className = "", filled = false, size = 22 }: { name: string; className?: string; filled?: boolean; size?: number }) => {
  const Icon = ICONS[name] ?? Sparkles;
  return (
    <Icon
      aria-hidden="true"
      className={className}
      size={size}
      strokeWidth={filled ? 2.6 : 2}
      fill={filled ? "currentColor" : "none"}
    />
  );
};

export default function AromatiqueApp() {
  const [view, setView] = useState<View>("welcome");
  const [showConsent, setShowConsent] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [showSatisfied, setShowSatisfied] = useState(false);
  const [activeNav, setActiveNav] = useState<"chat" | "history">("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [convId, setConvId] = useState<string | null>(null);
  const [condition, setCondition] = useState<Condition>("A");
  const [familiarity, setFamiliarity] = useState<Familiarity | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [startingConversation, setStartingConversation] = useState(false);
  const [generatingRecs, setGeneratingRecs] = useState(false);
  const [recs, setRecs] = useState<RecBatch[]>([]);
  const [history, setHistory] = useState<{ id: string; title: string; created_at: string }[]>([]);
  const [feedback, setFeedback] = useState<Record<string, number>>({});
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Paradata kuesioner. Semua di ref, bukan state: nilainya tidak pernah
  // dirender, jadi mencatatnya tidak perlu memicu re-render. Ditaruh di parent
  // supaya jamnya selamat saat FeedbackScreen unmount (partisipan bisa pindah
  // ke layar chat lewat sidebar lalu kembali lagi).
  const fbOpenedAtRef = useRef<number | null>(null);
  const fbEventsRef = useRef<FeedbackEvent[]>([]);
  const fbPausedMsRef = useRef(0);
  const fbPausedSinceRef = useRef<number | null>(null);
  const fbPauseReasonRef = useRef<"hidden" | "away" | null>(null);
  const fbHiddenMsRef = useRef(0);
  const fbAwayMsRef = useRef(0);

  function fbResetTiming() {
    fbOpenedAtRef.current = null;
    fbEventsRef.current = [];
    fbPausedMsRef.current = 0;
    fbPausedSinceRef.current = null;
    fbPauseReasonRef.current = null;
    fbHiddenMsRef.current = 0;
    fbAwayMsRef.current = 0;
  }

  // Jeda dimulai saat partisipan tidak sedang menatap kuesioner: tab
  // disembunyikan, atau pindah ke layar lain. Tanpa ini, detour tiga menit ke
  // layar chat akan terbaca sebagai "berpikir lama" di pertanyaan berikutnya.
  function fbPauseStart(reason: "hidden" | "away") {
    if (fbOpenedAtRef.current === null || fbPausedSinceRef.current !== null) return;
    fbPausedSinceRef.current = Date.now();
    fbPauseReasonRef.current = reason;
  }

  function fbPauseEnd() {
    if (fbPausedSinceRef.current === null) return;
    const delta = Date.now() - fbPausedSinceRef.current;
    fbPausedMsRef.current += delta;
    if (fbPauseReasonRef.current === "hidden") fbHiddenMsRef.current += delta;
    else fbAwayMsRef.current += delta;
    fbPausedSinceRef.current = null;
    fbPauseReasonRef.current = null;
  }

  useEffect(() => {
    const s = getSessionId();
    setSessionId(s);
    const id = window.setTimeout(() => { void loadHistory(s); }, 300);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "auto" }); }, [view]);

  // Jam kuesioner: dimulai sekali saat layar feedback pertama dibuka, lalu
  // dijeda tiap partisipan meninggalkannya dan dilanjutkan saat kembali.
  useEffect(() => {
    if (view !== "feedback") {
      fbPauseStart("away");
      return;
    }
    if (fbOpenedAtRef.current === null) fbOpenedAtRef.current = Date.now();
    else fbPauseEnd();

    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.hidden) fbPauseStart("hidden");
      else fbPauseEnd();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [view]);

  async function loadHistory(s: string) {
    const { data } = await supabase.from("conversations").select("id,title,created_at").eq("session_id", s).order("created_at", { ascending: false });
    if (data) setHistory(data);
  }

  async function initializeExperimentSession(conversationId: string, activeSessionId: string) {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/aromatique-chat`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ mode: "init", conversation_id: conversationId, session_id: activeSessionId }),
      });
      if (!resp.ok) throw new Error(`init failed: ${resp.status}`);
      const data = await resp.json();
      const rawCondition = data.condition ?? data.explanation_type;
      const serverCondition = rawCondition === "B" || rawCondition === "C" ? rawCondition : "A";
      return {
        condition: serverCondition as Condition,
        greeting: normalizeGreeting(serverCondition as Condition, data.greeting as string | undefined),
      };
    } catch (error) {
      console.error(error);
      return {
        condition: "A" as Condition,
        greeting: DEFAULT_GREETINGS.A,
      };
    }
  }

  function handleStart() {
    setShowConsent(true);
  }

  async function beginConversation() {
    if (startingConversation) return;
    setBrowserStorageItem(CONSENT_KEY, "1");
    setShowConsent(false);
    const activeSessionId = sessionId || getSessionId();
    setSessionId(activeSessionId);
    setStartingConversation(true);
    setCondition("A");
    setFamiliarity(null);
    setConvId(null);
    setMessages([]);
    setRecs([]);
    // Jawaban kuesioner sebelumnya ikut dibuang. Tanpa ini, percakapan baru
    // mewarisi kedelapan jawaban lama dalam keadaan sudah lengkap, sehingga
    // partisipan bisa mengirim ulang jawaban basi untuk percakapan yang berbeda.
    setFeedback({});
    setSubmittingFeedback(false);
    fbResetTiming();
    setView("chat");
    setActiveNav("chat");

    try {
      const { data, error } = await supabase.from("conversations").insert({ session_id: activeSessionId, title: "Percakapan Baru" }).select().single();
      if (error) throw error;

      setConvId(data.id);
      const assignment = await initializeExperimentSession(data.id, activeSessionId);
      const greeting: Msg = { role: "assistant", content: normalizeGreeting(assignment.condition, assignment.greeting) };
      setCondition(assignment.condition);
      setMessages([greeting]);

      void supabase
        .from("messages")
        .insert({ conversation_id: data.id, role: "assistant", content: greeting.content })
        .then(({ error }) => { if (error) console.error(error); });
      void loadHistory(activeSessionId);
    } catch (error) {
      console.error(error);
      toast.error("Gagal memulai percakapan");
      setView("welcome");
      setMessages([]);
      setConvId(null);
    } finally {
      setStartingConversation(false);
    }
  }

  async function loadConversation(id: string) {
    setConvId(id);
    const [{ data: conv }, { data: msgs }, { data: rs }] = await Promise.all([
      supabase.from("conversations").select("condition").eq("id", id).single(),
      supabase.from("messages").select("role,content,created_at").eq("conversation_id", id).order("created_at"),
      supabase.from("recommendations").select("batch_index,products,recommendations,summary,explanation_type,recommendation_engine,model_version,prompt_name,prompt_version,llm_model,explanation_payload").eq("conversation_id", id).order("batch_index"),
    ]);
    const loadedMessages = (msgs ?? []).map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
    setMessages(loadedMessages);
    setFamiliarity(detectFamiliarity(loadedMessages));
    setCondition((conv?.condition as Condition | null) ?? "A");
    setRecs((rs ?? []).map(r => ({
      batch_index: r.batch_index,
      products: (((r.recommendations ?? r.products) as any[]) ?? []).map(normalizeRecommendation),
      summary: r.summary ?? undefined,
      explanation_type: (r.explanation_type as Condition | null) ?? undefined,
      recommendation_engine: r.recommendation_engine ?? undefined,
      model_version: r.model_version ?? undefined,
      prompt_name: r.prompt_name ?? undefined,
      prompt_version: r.prompt_version ?? undefined,
      llm_model: r.llm_model ?? undefined,
      explanation_payload: r.explanation_payload ?? undefined,
    })));
    setView("chat");
    setActiveNav("chat");
  }

  async function streamAssistantReply(next: Msg[], extraPayload: Record<string, unknown> = {}) {
    if (!convId) return;

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/aromatique-chat`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
      body: JSON.stringify({ mode: "chat", messages: next, conversation_id: convId, session_id: sessionId, ...extraPayload }),
    });
    if (!resp.ok || !resp.body) {
      if (resp.status === 429) toast.error("Terlalu banyak permintaan.");
      else if (resp.status === 402) toast.error("Kuota AI habis.");
      else toast.error("Gagal mengirim pesan");
      return;
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "", acc = "", first = true;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        let line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ")) continue;
        const j = line.slice(6).trim();
        if (j === "[DONE]") continue;
        try {
          const p = JSON.parse(j);
          const c = p.choices?.[0]?.delta?.content;
          if (c) {
            acc += c;
            if (first) { setMessages(prev => [...prev, { role: "assistant", content: acc }]); first = false; }
            else setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: acc } : m));
          }
        } catch { buf = line + "\n" + buf; break; }
      }
    }
    if (acc) await supabase.from("messages").insert({ conversation_id: convId, role: "assistant", content: acc });
  }

  async function recordFamiliarityChoice(value: Familiarity) {
    if (!convId) return;
    const { error: directError } = await (supabase as any)
      .from("experiment_sessions")
      .update({ familiarity: value })
      .eq("conversation_id", convId);
    if (!directError) return;

    console.error(directError);
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/aromatique-chat`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ mode: "familiarity", conversation_id: convId, session_id: sessionId, familiarity: value }),
      });
      if (resp.ok && (resp.headers.get("content-type") ?? "").includes("application/json")) {
        const data = await resp.json().catch(() => null);
        if (data?.familiarity === value) return;
      }
    } catch (error) {
      console.error(error);
    }
    throw directError;
  }

  async function selectFamiliarity(value: Familiarity) {
    if (loading || !convId) return;
    const option = FAMILIARITY_OPTIONS.find(item => item.value === value);
    if (!option) return;

    const userMsg: Msg = { role: "user", content: option.message };
    const next = [...messages, userMsg];
    setFamiliarity(value);
    setMessages(next);
    setLoading(true);
    void supabase
      .from("messages")
      .insert({ conversation_id: convId, role: "user", content: option.message })
      .then(({ error }) => { if (error) console.error(error); });

    try {
      void recordFamiliarityChoice(value).catch((error) => {
        console.error(error);
        toast.error("Pilihan familiarity tersimpan di chat, tetapi metadata belum tersimpan.");
      });
      await streamAssistantReply(next, { familiarity: value });
    } catch {
      toast.error("Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading || !convId) return;
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    const userMsg: Msg = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setLoading(true);
    void supabase
      .from("messages")
      .insert({ conversation_id: convId, role: "user", content: text })
      .then(({ error }) => { if (error) console.error(error); });

    const currentPreferenceMessages = messages.filter(m => m.role === "user" && !isFamiliarityOnlyMessage(m.content));
    const detectedFamiliarity = familiarity ? null : getFamiliarityFromText(text);
    if (detectedFamiliarity) setFamiliarity(detectedFamiliarity);

    if (currentPreferenceMessages.length === 0 && !isFamiliarityOnlyMessage(text)) {
      const title = text.slice(0, 40);
      void supabase
        .from("conversations")
        .update({ title })
        .eq("id", convId)
        .then(({ error }) => {
          if (error) console.error(error);
          else void loadHistory(sessionId);
        });
    }

    try {
      if (detectedFamiliarity) {
        void recordFamiliarityChoice(detectedFamiliarity).catch((error) => {
          console.error(error);
          toast.error("Pilihan familiarity tersimpan di chat, tetapi metadata belum tersimpan.");
        });
      }
      await streamAssistantReply(next, detectedFamiliarity ? { familiarity: detectedFamiliarity } : {});
    } catch {
      toast.error("Terjadi kesalahan");
    } finally { setLoading(false); }
  }

  async function showRecommendations() {
    if (!convId) return;
    const userMsgs = messages.filter(m => m.role === "user" && !isFamiliarityOnlyMessage(m.content));
    if (userMsgs.length === 0) {
      setShowHint(true);
      toast("Yuk lakukan percakapan terlebih dahulu agar kami bisa merekomendasikan parfum yang paling cocok untukmu ✨");
      return;
    }
    setLoading(true);
    setGeneratingRecs(true);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/aromatique-chat`;
      const newBatch = (recs[recs.length - 1]?.batch_index ?? 0) + 1;
      const excludeProductIds = recs.flatMap(batch => batch.products.map(product => product.product_id ?? product.id));
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ messages, mode: "recommend", conversation_id: convId, session_id: sessionId, batch_index: newBatch, exclude_product_ids: excludeProductIds }),
      });
      if (!resp.ok) {
        if (resp.status === 429) toast.error("Terlalu banyak permintaan.");
        else if (resp.status === 402) toast.error("Kuota AI habis.");
        else toast.error("Gagal membuat rekomendasi");
        return;
      }
      const data = await resp.json();
      const products: Product[] = (data.recommendations ?? data.products ?? []).map(normalizeRecommendation);
      if (products.length === 0) { toast.error("Belum bisa membuat rekomendasi"); return; }
      const explanationType = (data.condition ?? data.explanation_type ?? condition) as Condition;
      const modelVersion = data.model_version ?? MODEL_VERSION;
      const recommendationEngine = data.recommendation_engine ?? RECOMMENDATION_ENGINE;
      const batch: RecBatch = {
        batch_index: newBatch,
        products,
        summary: data.summary,
        explanation_type: explanationType,
        recommendation_engine: recommendationEngine,
        model_version: modelVersion,
        prompt_name: data.prompt_name,
        prompt_version: data.prompt_version,
        llm_model: data.llm_model,
        explanation_payload: data.explanation_payload,
      };
      const newRecs = [...recs, batch];
      setRecs(newRecs);
      setCondition(explanationType);
      setView("recs");
      setShowSatisfied(false);
    } finally { setLoading(false); setGeneratingRecs(false); }
  }

  const totalFb = FEEDBACK_GROUPS.reduce((a, g) => a + g.items.length, 0);

  function recordFeedbackAnswer(code: string, value: number) {
    const now = Date.now();
    if (fbOpenedAtRef.current === null) fbOpenedAtRef.current = now;

    // Jeda yang sedang berjalan ikut dihitung, supaya klik yang terjadi tepat
    // setelah tab kembali aktif tidak membawa durasi jeda ke dalam active_ms.
    const pausedNow = fbPausedMsRef.current
      + (fbPausedSinceRef.current !== null ? now - fbPausedSinceRef.current : 0);
    const atMs = now - fbOpenedAtRef.current;
    const activeMs = Math.max(0, atMs - pausedNow);

    const events = fbEventsRef.current;
    const prev = events[events.length - 1];

    // Klik ulang pada nilai yang sama tetap dicatat sebagai interaksi, tapi
    // bukan perubahan jawaban — kalau tidak, `changes` menggelembung oleh klik
    // ganda dan tidak lagi bisa dibaca sebagai indikator keraguan.
    let lastValue: number | undefined;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].code === code) { lastValue = events[i].value; break; }
    }

    events.push({
      order: events.length + 1,
      code,
      value,
      at_ms: atMs,
      active_ms: activeMs,
      since_prev_ms: prev ? Math.max(0, activeMs - prev.active_ms) : null,
      is_change: lastValue !== undefined && lastValue !== value,
    });

    setFeedback(f => ({ ...f, [code]: value }));
  }

  function fbBuildResponseTimes() {
    fbPauseEnd();
    const openedAt = fbOpenedAtRef.current;
    if (openedAt === null) return null;

    const events = fbEventsRef.current;
    const submittedAt = Date.now();

    // Ringkasan turunan, murni demi kenyamanan query. Kebenarannya tetap ada di
    // `events` — semua angka di sini bisa dihitung ulang dari sana.
    const perQuestion: Record<string, {
      order: number; first_ms: number; active_ms: number;
      since_prev_ms: number | null; last_ms: number; changes: number;
    }> = {};
    for (const e of events) {
      const seen = perQuestion[e.code];
      if (seen) {
        seen.last_ms = e.at_ms;
        if (e.is_change) seen.changes += 1;
      } else {
        perQuestion[e.code] = {
          order: e.order, first_ms: e.at_ms, active_ms: e.active_ms,
          since_prev_ms: e.since_prev_ms, last_ms: e.at_ms, changes: 0,
        };
      }
    }

    return {
      schema: 1,
      opened_at: new Date(openedAt).toISOString(),
      submitted_at: new Date(submittedAt).toISOString(),
      total_ms: submittedAt - openedAt,
      hidden_ms: fbHiddenMsRef.current,
      away_ms: fbAwayMsRef.current,
      onset_ms: events.length > 0 ? events[0].active_ms : null,
      events,
      per_question: perQuestion,
    };
  }

  async function submitFeedback(smelledFragrance: boolean) {
    if (Object.keys(feedback).length < totalFb) { toast.error("Mohon jawab semua pertanyaan"); return; }
    if (!convId) return;
    if (submittingFeedback) return;
    setSubmittingFeedback(true);
    const latest = recs[recs.length - 1];
    const { error } = await supabase.from("feedback").insert({
      conversation_id: convId,
      session_id: sessionId,
      // Jawaban dialog konfirmasi ikut dititipkan ke `answers` supaya tabel
      // feedback tidak perlu kolom tambahan. Sengaja tidak disimpan di state
      // `feedback`: pengecekan kelengkapan menghitung jumlah key di sana dan
      // mengharapkan tepat delapan item Likert.
      answers: { ...feedback, smelled_fragrance: smelledFragrance },
      explanation_type: latest?.explanation_type ?? condition,
      model_version: latest?.model_version ?? MODEL_VERSION,
      response_times: fbBuildResponseTimes(),
    });
    setSubmittingFeedback(false);
    if (error) {
      // Sebelumnya hasil insert diabaikan dan layar terima kasih tetap tampil,
      // jadi kegagalan menyimpan tidak terlihat oleh siapa pun. Tahan di layar
      // ini supaya partisipan bisa mencoba lagi dan jawabannya tidak hilang.
      toast.error("Jawaban gagal tersimpan. Mohon coba kirim sekali lagi.");
      return;
    }
    setView("thanks");
  }

  const userMsgCount = messages.filter(m => m.role === "user" && !isFamiliarityOnlyMessage(m.content)).length;
  const isBusy = loading || startingConversation;
  const recBtnActive = userMsgCount > 0 && !isBusy;
  const sendActive = input.trim().length > 0 && !isBusy;
  const fbAnswered = Object.keys(feedback).length;
  const fbReady = fbAnswered === totalFb;

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  }

  // Welcome is fullscreen, no sidebar
  if (view === "welcome") {
    return (
      <>
        <WelcomeScreen onStart={handleStart} />
        {showConsent && <ConsentModal onAccept={beginConversation} onClose={() => setShowConsent(false)} loading={startingConversation} />}
      </>
    );
  }

  return (
    <div className={`ambient-bg w-full flex relative ${view === "chat" ? "chat-viewport-shell overflow-hidden" : "min-h-screen"}`}>
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? "translate-x-0 lg:w-72" : "-translate-x-full lg:w-0"} transition-[transform,width] duration-300 flex flex-col fixed lg:sticky left-0 top-0 h-screen w-72 lg:shrink-0 bg-white/90 lg:bg-white/80 backdrop-blur-2xl border-r border-white/40 z-50 overflow-hidden`} style={{ boxShadow: "0 24px 60px rgba(112,70,183,0.08)" }}>
        <div className="w-72 h-full flex flex-col p-6 gap-6">
        <div className="px-2 pt-2">
          <h1 className="text-[18px] font-extrabold tracking-[0.18em] text-[#7046b7] uppercase whitespace-nowrap">Aromatique AI</h1>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-[13px] text-[#5b5553]">Lab Riset Aroma</p>
            <button onClick={() => setSidebarOpen(false)} className="px-3 py-1.5 rounded-full text-[12px] font-semibold text-[#7046b7] bg-[#ac82f7]/10 hover:bg-[#ac82f7]/20 transition-colors" aria-label="Tutup menu">
              Tutup
            </button>
          </div>
        </div>
        <button
          onClick={() => { beginConversation(); setSidebarOpen(false); }}
          className="w-full flex items-center justify-center gap-2 text-white font-semibold text-[14px] py-3 rounded-full transition-all hover:-translate-y-0.5"
          style={{ background: "#ac82f7", boxShadow: "0 8px 20px -4px rgba(112,70,183,0.35)" }}
        >
          <MI name="add" size={20} /> Percakapan Baru
        </button>
        <nav className="flex flex-col gap-1.5">
          {[
            { id: "chat" as const, icon: "chat", label: "Percakapan Saat Ini", action: () => { setView("chat"); setSidebarOpen(false); } },
            { id: "history" as const, icon: "history", label: "Riwayat Percakapan", action: () => {} },
          ].map(n => {
            const active = activeNav === n.id;
            return (
              <button key={n.id} onClick={() => { setActiveNav(n.id); n.action?.(); }}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-[14px] transition-all ${active ? "bg-[#ac82f7]/10 text-[#7046b7] font-bold" : "text-[#5b5553] hover:bg-white/60 hover:translate-x-1 font-medium"}`}>
                <MI name={n.icon} filled={active} /> {n.label}
              </button>
            );
          })}
          {activeNav === "history" && (
            <div className="mt-2 max-h-[28vh] overflow-y-auto no-scrollbar pl-2">
              {history.length === 0 ? (
                <p className="text-[12px] text-[#c2b4cf] text-center py-4">Belum ada riwayat</p>
              ) : history.map((h, i) => (
                <button key={h.id} onClick={() => { loadConversation(h.id); setSidebarOpen(false); }} className="w-full text-left p-2.5 mb-1.5 rounded-lg hover:bg-white/80 transition-colors">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#ac82f7]">Sesi #{history.length - i}</div>
                  <div className="text-[12px] font-semibold text-[#19191b] truncate">{h.title}</div>
                </button>
              ))}
            </div>
          )}
        </nav>
        </div>
      </aside>

      {/* Overlay (mobile/tablet only) */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Top header (all breakpoints) */}
      <header className="fixed top-0 inset-x-0 z-30 px-5 py-4 bg-white/70 backdrop-blur-xl border-b border-white/40 grid grid-cols-[auto_1fr_auto] items-center gap-3 lg:px-8">
        <button onClick={() => setSidebarOpen(true)} aria-label="Buka menu" className="p-1 -ml-1 text-[#7046b7] flex items-center justify-center">
          <MI name="menu" size={24} />
        </button>
        <h1 className="text-center text-[16px] lg:text-[18px] font-extrabold tracking-[0.18em] text-[#7046b7] uppercase">AROMATIQUE AI</h1>
        <span className="w-6" aria-hidden />
      </header>

      {/* Main content */}
      <main className="flex-1 min-w-0 pt-[72px] relative z-10 flex flex-col">

        {view === "chat" && (
          <ChatScreen
            messages={messages} loading={isBusy} input={input}
            onInput={autoResize} onSend={sendMessage} onShowRecs={showRecommendations}
            familiarity={familiarity} onSelectFamiliarity={selectFamiliarity}
            initializing={startingConversation}
            recBtnActive={recBtnActive} sendActive={sendActive}
            chatEndRef={chatEndRef} taRef={taRef}
            onBack={() => setView("welcome")}
          />
        )}
        {view === "recs" && (
          <Suspense fallback={<RecsLoadingOverlay />}>
            <RecsScreen
              recs={recs} showSatisfied={showSatisfied} setShowSatisfied={setShowSatisfied}
              onBack={() => setView("chat")} onContinue={() => setView("chat")}
              onNew={beginConversation} onFeedback={() => setView("feedback")}
            />
          </Suspense>
        )}
        {view === "feedback" && (
          <FeedbackScreen feedback={feedback} onAnswer={recordFeedbackAnswer} onSubmit={submitFeedback}
            fbAnswered={fbAnswered} fbReady={fbReady} totalFb={totalFb} submitting={submittingFeedback} />
        )}
        {view === "thanks" && <ThanksScreen onNew={beginConversation} />}
      </main>

      {showConsent && <ConsentModal onAccept={beginConversation} onClose={() => setShowConsent(false)} loading={startingConversation} />}
      {showHint && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setShowHint(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-3xl p-8 max-w-sm text-center shadow-2xl">
            <div className="text-[56px] mb-3">💬</div>
            <h3 className="text-[20px] font-extrabold mb-2 text-[#19191b]">Yuk ngobrol dulu!</h3>
            <p className="text-[14px] leading-[1.6] text-[#5b5553] mb-6">Aku belum tahu kamu suka aroma seperti apa. Cerita sedikit dulu soal preferensimu, biar aku bisa pilihkan parfum yang pas 🌸</p>
            <button onClick={() => setShowHint(false)} className="w-full text-white font-bold py-3.5 rounded-full" style={{ background: "#ac82f7", boxShadow: "0 8px 20px rgba(112,70,183,0.35)" }}>Oke, ayo mulai!</button>
          </div>
        </div>
      )}
      {generatingRecs && <RecsLoadingOverlay />}
    </div>
  );
}

/* ========== RECS LOADING OVERLAY ========== */
function RecsLoadingOverlay() {
  const steps = [
    "Menganalisis preferensi aromamu",
    "Memetakan karakter wewangian",
    "Menyusun rekomendasi parfum terbaik",
  ];
  const [stepIdx, setStepIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStepIdx(i => (i + 1) % steps.length), 1800);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-white/70 backdrop-blur-xl">
      <div className="relative flex flex-col items-center text-center max-w-sm">
        <div className="relative w-28 h-28 mb-8 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-[#ac82f7]/25 blur-2xl animate-pulse" />
          <div className="absolute inset-0 rounded-full border-2 border-[#ac82f7]/30 border-t-[#7046b7] animate-spin" />
          <div className="absolute inset-3 rounded-full border-2 border-[#7046b7]/20 border-b-[#ac82f7] animate-spin" style={{ animationDuration: "2.4s", animationDirection: "reverse" }} />
          <img src={logoAromatique} alt="Aromatique" className="w-12 h-12 object-contain relative z-10 animate-pulse" />
        </div>
        <h2 className="text-[20px] font-bold text-[#19191b] mb-2 tracking-tight">Meracik rekomendasimu…</h2>
        <p className="text-[14px] text-[#5b5553] leading-relaxed mb-6">
          Sebentar ya, kami sedang mempelajari percakapanmu untuk menemukan parfum yang paling cocok.
        </p>
        <div className="flex flex-col gap-2 w-full">
          {steps.map((s, i) => {
            const done = i < stepIdx;
            const active = i === stepIdx;
            return (
              <div key={i} className={`flex items-center gap-3 text-[13px] px-4 py-2.5 rounded-full border transition-all ${active ? "bg-[#ac82f7]/10 border-[#ac82f7]/40 text-[#19191b]" : done ? "bg-white/60 border-white/60 text-[#7046b7]" : "bg-white/40 border-white/40 text-[#a89fa6]"}`}>
                <span className={`w-2 h-2 rounded-full ${active ? "bg-[#7046b7] animate-pulse" : done ? "bg-[#7046b7]" : "bg-[#d9d2dd]"}`} />
                <span className="font-medium">{s}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ========== WELCOME ========== */
function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="ambient-bg min-h-screen w-full flex items-center justify-center relative overflow-hidden p-8">
      <main className="relative z-10 w-full max-w-3xl flex flex-col items-center justify-center text-center">
        <div className="mb-12 relative group">
          <div className="absolute inset-0 bg-[#ac82f7]/30 rounded-full blur-3xl scale-110" />
          <div className="w-40 h-40 relative z-10 flex items-center justify-center">
            <img src={logoAromatique} alt="Logo Aromatique" className="w-full h-full object-contain" />
          </div>
        </div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-[#19191b] mb-4 leading-[1.1]" style={{ letterSpacing: "-0.02em" }}>
          Aromatique AI
        </h1>
        <p className="text-[18px] text-[#5b5553] max-w-md leading-relaxed">
          Asisten AI untuk menemukan aroma terbaikmu.
        </p>
        <button
          onClick={onStart}
          className="group mt-16 inline-flex items-center gap-3 px-10 py-5 bg-[#ac82f7] text-white rounded-full font-semibold uppercase tracking-[0.15em] text-[12px] transition-all hover:-translate-y-1 hover:bg-[#7046b7]"
          style={{ boxShadow: "0 20px 40px rgba(112,70,183,0.25)" }}
        >
          <span>Mulai Percakapan</span>
        </button>
        
      </main>
    </div>
  );
}

/* ========== CONSENT ========== */
function ConsentModal({ onAccept, onClose, loading }: { onAccept: () => void; onClose: () => void; loading: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-md" onClick={loading ? undefined : onClose}>
      <div onClick={e => e.stopPropagation()} className="relative w-full max-w-[640px] bg-white rounded-[32px] overflow-hidden flex flex-col border border-white/50" style={{ boxShadow: "0 32px 64px -16px rgba(112,70,183,0.25)" }}>
        <div className="pt-10 px-8 pb-6 flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 bg-[#ac82f7]/20 blur-2xl rounded-full" />
            <div className="relative w-20 h-20 flex items-center justify-center overflow-hidden">
              <img src={logoAromatique} alt="Logo Aromatique" className="w-full h-full object-contain" />
            </div>
          </div>
        </div>
        <div className="px-8 sm:px-12 pb-6 text-center max-h-[60vh] overflow-y-auto no-scrollbar">
          <h1 className="text-[28px] sm:text-[32px] font-bold text-[#19191b] mb-6 tracking-tight leading-[1.2]">Selamat Datang!</h1>
          <div className="text-left space-y-5 text-[15px] text-[#5b5553]">
            <p className="leading-relaxed">
              Aromatique AI adalah asisten rekomendasi parfum berbasis AI yang dikembangkan sebagai bagian dari penelitian kolaboratif <span className="font-semibold text-[#19191b]">Universitas Gadjah Mada (UGM)</span>.
            </p>
            <p className="leading-relaxed">
              Untuk memberikan rekomendasi yang dipersonalisasi, kami perlu mengumpulkan beberapa informasi preferensi aroma Anda. Proses ini akan memakan waktu sekitar <strong className="text-[#7046b7] font-bold">10 menit</strong>.
            </p>
            <div className="bg-white/60 rounded-2xl border border-[#ccc3d4]/40 p-6 space-y-3">
              <h2 className="text-[12px] font-semibold text-[#7046b7] uppercase tracking-[0.15em] flex items-center gap-2">
                <MI name="verified_user" size={18} /> Komitmen Privasi Kami
              </h2>
              {[
                { i: "lock", t: "Semua data Anda dianonimkan secara menyeluruh (anonymous)." },
                { i: "school", t: "Data hanya digunakan untuk tujuan penelitian akademis murni." },
                { i: "volunteer_activism", t: "Partisipasi Anda sepenuhnya bersifat sukarela dan tanpa tekanan." },
              ].map(it => (
                <div key={it.i} className="flex items-start gap-3">
                  <MI name={it.i} className="text-[#7046b7]" size={20} />
                  <p className="text-[14px] text-[#5b5553]">{it.t}</p>
                </div>
              ))}
            </div>
            <p className="text-[12px] text-[#5b5553]/70 text-center px-4 leading-relaxed">
              Dengan menekan tombol di bawah, Anda mengonfirmasi bahwa Anda telah membaca, memahami, dan menyetujui ketentuan penelitian ini.
            </p>
          </div>
        </div>
        <div className="p-6 sm:p-8 pt-4 flex flex-col sm:flex-row gap-3 bg-white border-t border-[#ccc3d4]/30">
          <button onClick={onClose} disabled={loading} className="w-full sm:w-1/3 px-6 py-4 rounded-2xl border border-[#ccc3d4] text-[#5b5553] font-semibold text-[14px] hover:bg-white/80 transition-all disabled:opacity-50">Kembali</button>
          <button onClick={onAccept} disabled={loading} className="w-full sm:w-2/3 px-8 py-4 rounded-2xl bg-[#ac82f7] text-white font-bold text-[14px] hover:bg-[#7046b7] transition-all hover:-translate-y-0.5 disabled:opacity-70 disabled:hover:translate-y-0" style={{ boxShadow: "0 8px 20px -4px rgba(112,70,183,0.4)" }}>
            {loading ? "Menyiapkan..." : "Saya Setuju & Mulai"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ========== CHAT ========== */
function ChatScreen(props: {
  messages: Msg[]; loading: boolean; input: string;
  onInput: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSend: () => void; onShowRecs: () => void; onBack: () => void;
  familiarity: Familiarity | null; onSelectFamiliarity: (value: Familiarity) => void;
  initializing: boolean;
  recBtnActive: boolean; sendActive: boolean;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  taRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const { messages, loading, input, onInput, onSend, onShowRecs, onBack, familiarity, onSelectFamiliarity, initializing, recBtnActive, sendActive, chatEndRef, taRef } = props;
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(164);
  const showFamiliarityButtons = !familiarity && !loading && messages.length === 1 && messages[0]?.role === "assistant";

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;

    const updateComposerHeight = () => setComposerHeight(composer.offsetHeight);
    updateComposerHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateComposerHeight);
      return () => window.removeEventListener("resize", updateComposerHeight);
    }

    const observer = new ResizeObserver(updateComposerHeight);
    observer.observe(composer);
    window.addEventListener("resize", updateComposerHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateComposerHeight);
    };
  }, []);

  return (
    <div className="chat-screen-height flex-1 w-full relative overflow-hidden">
      <div
        className="absolute inset-0 overflow-y-auto px-4 lg:px-12 pt-6 lg:pt-8 no-scrollbar flex flex-col items-center"
        style={{ paddingBottom: composerHeight + 24 }}
      >
        <div className="w-full max-w-[640px] flex flex-col gap-6">
          {initializing && messages.length === 0 && (
            <div className="self-start w-full">
              <div className="flex items-center gap-2 ml-2 mb-2">
                <div className="w-6 h-6 flex items-center justify-center overflow-hidden">
                  <img src={logoAromatique} alt="Aromatique" className="w-full h-full object-contain" />
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#5b5553]">Aromatique AI</span>
              </div>
              <div className="glass-panel p-5 rounded-2xl rounded-tl-sm text-[#5b5553] text-[15px] leading-[1.6]">
                Menyiapkan percakapan...
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex flex-col gap-2 max-w-[88%] ${m.role === "user" ? "self-end items-end w-fit" : "self-start w-full"}`}>
              {m.role === "assistant" && (
                <div className="flex items-center gap-2 ml-2">
                  <div className="w-6 h-6 flex items-center justify-center overflow-hidden">
                    <img src={logoAromatique} alt="Aromatique" className="w-full h-full object-contain" />
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#5b5553]">Aromatique AI</span>
                </div>
              )}
              {m.role === "assistant" ? (
                <div className="glass-panel p-5 rounded-2xl rounded-tl-sm text-[#19191b] text-[15px] leading-[1.6] whitespace-pre-wrap" style={{ boxShadow: "0 8px 30px rgba(112,70,183,0.04)" }}>
                  <MarkdownText content={m.content} />
                </div>
              ) : (
                <div className="text-white text-[15px] leading-[1.6] whitespace-pre-wrap p-5 rounded-2xl rounded-tr-sm" style={{ background: "#ac82f7", boxShadow: "0 8px 30px rgba(172,130,247,0.18)" }}>
                  <MarkdownText content={m.content} />
                </div>
              )}
              {showFamiliarityButtons && i === 0 && m.role === "assistant" && (
                <div className="ml-8 flex flex-wrap gap-2">
                  {FAMILIARITY_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onSelectFamiliarity(option.value)}
                      className="rounded-full border border-[#ac82f7]/35 bg-white px-4 py-2 text-[13px] font-bold text-[#7046b7] shadow-sm transition-all hover:-translate-y-0.5 hover:bg-[#ac82f7]/10"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && messages[messages.length - 1]?.role === "user" && (
            <div className="self-start glass-panel p-5 rounded-2xl rounded-tl-sm text-[14px] text-[#5b5553]">mengetik…</div>
          )}
          <div ref={chatEndRef} />
        </div>
      </div>

      <div ref={composerRef} className="absolute inset-x-0 bottom-0 z-20 p-4 lg:p-6 bg-gradient-to-t from-[#fbf9fc] via-[#fbf9fc] to-transparent">
        <div className="max-w-[640px] mx-auto">
          <form onSubmit={(e) => { e.preventDefault(); onSend(); }} className="glass-panel rounded-3xl overflow-hidden flex flex-col" style={{ boxShadow: "0 4px 14px rgba(112,70,183,0.06)" }}>
            <textarea
              ref={taRef} value={input} onChange={onInput}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
              placeholder="Ketik pesan…" rows={1} disabled={loading}
              className="w-full bg-transparent border-0 outline-none resize-none text-[15px] pt-4 pb-2 px-5 text-[#19191b] placeholder:text-[#5b5553]/50"
              style={{ maxHeight: 120 }}
            />
            <div className="flex items-center justify-between px-3 pb-3 pt-1">
              <button
                type="button"
                onClick={onShowRecs}
                disabled={loading}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold py-2 px-3 rounded-full border transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
                style={{ borderColor: "#ac82f7", color: "#7046b7", background: "rgba(172,130,247,0.08)" }}
              >
                <Sparkles size={16} fill="currentColor" /> Tampilkan Rekomendasi
              </button>
              <button type="submit" disabled={!sendActive} aria-label="Kirim"
                className="w-10 h-10 rounded-full flex items-center justify-center transition-all"
                style={{ background: sendActive ? "#ac82f7" : "transparent", color: sendActive ? "#fff" : "#c2b4cf" }}>
                <MI name="send" filled={sendActive} size={20} />
              </button>
            </div>
          </form>
        </div>

      </div>
    </div>
  );
}

/* ========== FEEDBACK ========== */
function FeedbackScreen({ feedback, onAnswer, onSubmit, fbAnswered, fbReady, totalFb, submitting }: {
  feedback: Record<string, number>;
  onAnswer: (code: string, value: number) => void;
  onSubmit: (smelledFragrance: boolean) => void;
  fbAnswered: number; fbReady: boolean; totalFb: number; submitting: boolean;
}) {
  const [showConfirm, setShowConfirm] = useState(false);
  return (
    <div className="flex-1 w-full max-w-5xl mx-auto px-6 py-12 lg:px-16 lg:py-14">
      <header className="mb-12 max-w-3xl">
        <div className="flex items-center gap-2 text-[#7046b7] text-[12px] font-semibold uppercase tracking-[0.15em] mb-4">
          <MI name="biotech" size={18} /> <span>Form Evaluasi</span>
        </div>
        <p className="text-[14px] lg:text-[18px] text-[#5b5553] leading-relaxed max-w-2xl">
          Jawabanmu akan membantu menyempurnakan riset kami. Mohon nilai pengalamanmu dengan rekomendasi yang baru saja diberikan, ya!
        </p>
      </header>

      <section className="pb-32">
        <div className="glass-panel p-6 lg:p-10 rounded-3xl shadow-sm divide-y divide-[#ccc3d4]/30">
          {FEEDBACK_GROUPS.flatMap(g => g.items).map((q, idx) => {
            const v = feedback[q.code];
            return (
              <div key={q.code} className={idx === 0 ? "pb-8" : "py-8 last:pb-0"}>
                <div className="flex items-start gap-3 mb-6">
                  <span className="text-[11px] font-bold text-[#7046b7] px-2 py-1 rounded-md bg-[#eaddff] flex-shrink-0">{idx + 1}</span>
                  <label className="block text-[15px] font-semibold text-[#19191b] leading-snug">{q.text}</label>
                </div>
                <div className="flex justify-between items-start gap-2 max-w-xl mx-auto">
                  {SCALE.map(s => {
                    const sel = v === s.v;
                    return (
                      <button key={s.v} type="button" onClick={() => onAnswer(q.code, s.v)}
                        className="group flex flex-col items-center gap-2 flex-1">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${sel ? "bg-[#ac82f7] text-white shadow-lg" : "bg-[#f5f3f6] text-[#5b5553] group-hover:bg-[#eaddff] group-hover:text-[#7046b7]"}`}
                          style={sel ? { boxShadow: "0 8px 20px rgba(172,130,247,0.35)" } : {}}>
                          <MI name={s.icon} filled={sel} size={26} />
                        </div>
                        <span className={`text-[10px] font-bold text-center leading-tight ${sel ? "text-[#7046b7]" : "text-[#5b5553]/70"}`}>{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Sticky submit */}
      <div className="sticky bottom-0 left-0 right-0 p-4 lg:p-6 bg-gradient-to-t from-[#fbf9fc] via-[#fbf9fc]/95 to-transparent z-30">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 glass-panel rounded-2xl px-4 py-3 lg:px-6 lg:py-4">
          <div className="text-[12px] lg:text-[13px] text-[#5b5553] min-w-0 flex-1">
            <span className="font-bold text-[#7046b7]">{fbAnswered}</span> / {totalFb} terjawab
            <div className="mt-1.5 w-full max-w-48 h-1.5 bg-[#f5f3f6] rounded-full overflow-hidden">
              <div className="h-full transition-all duration-500" style={{ width: `${(fbAnswered / totalFb) * 100}%`, background: "linear-gradient(90deg, #ac82f7, #7046b7)" }} />
            </div>
          </div>
          <button onClick={() => setShowConfirm(true)} disabled={!fbReady || submitting}
            className="px-6 py-3 lg:px-8 lg:py-4 rounded-full font-bold text-[13px] lg:text-[14px] uppercase tracking-[0.1em] transition-all disabled:opacity-50 flex-shrink-0"
            style={{ background: fbReady ? "#ac82f7" : "#ccc3d4", color: "#fff", boxShadow: fbReady ? "0 8px 20px rgba(172,130,247,0.35)" : "none" }}>
            {submitting ? "Menyimpan…" : "Kirim"}
          </button>
        </div>
      </div>

      {/* Confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50" onClick={() => setShowConfirm(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl">
            <div className="text-center mb-6">
              <div className="text-[48px] mb-3">🌸</div>
              <h3 className="text-[20px] font-bold text-[#19191b] leading-snug">
                Apakah kamu sudah mencium aroma parfum rekomendasi kami?
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => { setShowConfirm(false); onSubmit(false); }}
                className="py-3 rounded-full bg-[#f3f1f4] border border-[#ccc3d4]/60 text-[#19191b] font-bold text-[14px] active:scale-[0.98] transition-transform"
              >
                Tidak
              </button>
              <button
                onClick={() => { setShowConfirm(false); onSubmit(true); }}
                className="py-3 rounded-full text-white font-bold text-[14px] active:scale-[0.98] transition-transform"
                style={{ background: "linear-gradient(135deg, #ac82f7, #7046b7)", boxShadow: "0 8px 20px rgba(172,130,247,0.35)" }}
              >
                Ya, Sudah
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========== THANKS ========== */
function ThanksScreen({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-12 min-h-[80vh]">
      <div className="text-[80px] leading-none mb-6">🌺</div>
      <h2 className="text-[40px] font-bold text-[#19191b] mb-4 tracking-tight">Terima kasih!</h2>
      <p className="text-[18px] text-[#5b5553] max-w-md mb-8 leading-relaxed">
        Jawabanmu sangat berarti untuk penelitian kami. Semoga Aromatique AI bisa terus membantu menemukan parfum yang pas 🌸
      </p>
      <div className="glass-panel rounded-2xl px-8 py-5 mb-8 max-w-md">
        <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7046b7] mb-1">Penelitian</div>
        <div className="text-[15px] font-bold text-[#19191b]">Aromatique AI × Universitas Gadjah Mada</div>
      </div>
      <button onClick={onNew} className="px-10 py-4 rounded-full bg-[#ac82f7] text-white font-bold uppercase tracking-[0.1em] text-[12px] hover:-translate-y-0.5 transition-all" style={{ boxShadow: "0 8px 20px rgba(172,130,247,0.35)" }}>
        Mulai Percakapan Baru
      </button>
    </div>
  );
}
