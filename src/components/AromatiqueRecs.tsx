import { CheckCircle2, MessageCircle, RefreshCw } from "lucide-react";
import recommendationHero from "@/assets/recommendation-hero.png";

type Condition = "A" | "B" | "C";
type KgPathItem = { relation: string; entity: string; matched: boolean; reason: string };
export type Product = {
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
export type RecBatch = {
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

function RecommendationDetails({ product }: { product: Product }) {
  return (
    <div className="rounded-[10px] px-4 py-4 mt-auto" style={{ background: "rgba(230,217,253,0.6)" }}>
      <div className="mb-2.5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[#7046b7]">Kenapa cocok</div>
      </div>
      <p className="text-[13.5px] font-medium text-[#503886] leading-[1.65]"><MarkdownText content={product.reason} /></p>
    </div>
  );
}

function ProductNotes({ notes }: { notes: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {notes.map(n => (
        <span key={n} className="text-[12px] font-semibold text-[#503886] px-3 py-1 rounded-full bg-[#eaddff]">{n}</span>
      ))}
    </div>
  );
}

export default function RecsScreen({ recs, onContinue, onNew, onFeedback }: {
  recs: RecBatch[];
  showSatisfied: boolean;
  setShowSatisfied: (b: boolean) => void;
  onBack: () => void;
  onContinue: () => void;
  onNew: () => void;
  onFeedback: () => void;
}) {
  const latest = recs[recs.length - 1];
  return (
    <div className="flex-1 w-full max-w-7xl mx-auto px-4 py-6 md:px-8 md:py-10 lg:px-16 lg:py-14 flex flex-col">
      <div className="mb-6 lg:mb-10">
        <h1 className="text-[24px] md:text-[32px] lg:text-[40px] font-bold text-[#19191b] mb-2 lg:mb-3 tracking-tight leading-[1.15]">Rekomendasi Parfum Kamu</h1>
        <p className="text-[14px] md:text-[16px] lg:text-[18px] text-[#5b5553] max-w-2xl leading-relaxed">
          Berdasarkan profil penciuman dan preferensi yang Anda bagikan, AI kami telah mengkurasi {latest?.products.length ?? 3} pilihan wewangian eksklusif ini.
        </p>
      </div>

      <div className="flex flex-col gap-4 mb-6 md:hidden">
        {latest?.products.map((p, i) => (
          <div key={p.id} className="rounded-2xl overflow-hidden bg-white border border-[#ccc3d4]/40 shadow-sm">
            <div className="relative aspect-[4/3] bg-[#f3f1f4]">
              <img src={recommendationHero} alt={p.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
              <span className="absolute top-3 left-3 px-2.5 py-1 bg-white/92 backdrop-blur-sm rounded-lg text-[11px] font-extrabold text-[#19191b]">{String(i + 1).padStart(2, "0")}</span>
            </div>
            <div className="p-4">
              <h2 className="text-[20px] font-extrabold text-[#19191b] tracking-tight leading-tight mb-3">{p.name}</h2>
              <ProductNotes notes={p.notes} />
              <div className="h-px bg-[#ccc3d4]/40 my-3" />
              <RecommendationDetails product={p} />
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:flex lg:hidden flex-col gap-5 mb-8">
        {latest?.products.map((p, i) => (
          <div key={p.id} className="rounded-3xl overflow-hidden bg-white border border-[#ccc3d4]/40 shadow-sm flex">
            <div className="relative w-[38%] flex-shrink-0 bg-[#f3f1f4]">
              <img src={recommendationHero} alt={p.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
              <span className="absolute top-3 left-3 px-2.5 py-1 bg-white/92 backdrop-blur-sm rounded-lg text-[11px] font-extrabold text-[#19191b]">{String(i + 1).padStart(2, "0")}</span>
            </div>
            <div className="flex-1 p-6 flex flex-col">
              <h2 className="text-[22px] font-extrabold text-[#19191b] tracking-tight leading-tight mb-4">{p.name}</h2>
              <div className="mb-4"><ProductNotes notes={p.notes} /></div>
              <RecommendationDetails product={p} />
            </div>
          </div>
        ))}
      </div>

      <div className="hidden lg:grid grid-cols-3 gap-6 mb-12">
        {latest?.products.map((p, i) => (
          <div key={p.id} className="group rounded-3xl overflow-hidden bg-white border border-[#ccc3d4]/40 flex flex-col transition-all hover:-translate-y-1 hover:shadow-[0_20px_40px_-12px_rgba(112,70,183,0.18)]">
            <div className="relative aspect-[4/3] bg-[#f3f1f4] overflow-hidden">
              <img src={recommendationHero} alt={p.name} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
              <span className="absolute top-3 left-3 px-2.5 py-1 bg-white/92 backdrop-blur-sm rounded-lg text-[11px] font-extrabold text-[#19191b]">{String(i + 1).padStart(2, "0")}</span>
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <h2 className="text-[22px] font-extrabold text-[#19191b] tracking-tight leading-tight mb-4">{p.name}</h2>
              <div className="mb-4"><ProductNotes notes={p.notes} /></div>
              <RecommendationDetails product={p} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 p-8 rounded-3xl bg-[#eaddff]/60 border border-[#ac82f7]/20">
        <div className="grid sm:grid-cols-3 gap-3">
          <button onClick={onNew} className="text-left p-5 rounded-2xl bg-white border border-[#ccc3d4]/40 hover:-translate-y-0.5 transition-all">
            <RefreshCw className="text-[#7046b7] mb-2" size={22} />
            <div className="text-[14px] font-bold text-[#19191b]">Mulai Percakapan Baru</div>
            <div className="text-[12px] text-[#5b5553] mt-1">Reset dan cari aroma berbeda</div>
          </button>
          <button onClick={onContinue} className="text-left p-5 rounded-2xl bg-white border border-[#ccc3d4]/40 hover:-translate-y-0.5 transition-all">
            <MessageCircle className="text-[#7046b7] mb-2" size={22} />
            <div className="text-[14px] font-bold text-[#19191b]">Lanjutkan Percakapan</div>
            <div className="text-[12px] text-[#5b5553] mt-1">Eksplorasi opsi lain</div>
          </button>
          <button onClick={onFeedback} className="text-left p-5 rounded-2xl text-white hover:-translate-y-0.5 transition-all" style={{ background: "linear-gradient(135deg, #ac82f7, #7046b7)", boxShadow: "0 8px 20px rgba(172,130,247,0.35)" }}>
            <CheckCircle2 className="mb-2" size={22} fill="currentColor" />
            <div className="text-[14px] font-bold">Selesai & Beri Feedback</div>
            <div className="text-[12px] opacity-90 mt-1">Bantu penelitian kami</div>
          </button>
        </div>
      </div>
    </div>
  );
}
