# Detail Implementasi Aromatique AI

Dokumen ini menjelaskan implementasi aplikasi live `https://aromatique-ai.vercel.app` secara end-to-end, mulai dari frontend, backend Supabase Edge Function, database, mekanisme eksperimen A/B/C, rekomendasi produk, logging riset, sampai deployment Vercel.

Dokumen ini sengaja tidak mencantumkan nilai secret, access token, atau API key. Semua nilai sensitif harus tetap dikelola lewat environment variables.

## 1. Ringkasan Sistem

Aromatique AI adalah aplikasi rekomendasi parfum berbasis percakapan. User berbicara dengan chatbot, sistem mengekstrak preferensi aroma, lalu menghasilkan top 3 rekomendasi parfum dengan explanation style yang ditentukan oleh assignment eksperimen A/B/C.

Secara umum sistem terdiri dari:

| Layer | Teknologi | Peran |
| --- | --- | --- |
| Frontend | React 19, TanStack Start, Vite, Tailwind CSS 3.4 | UI chatbot, consent, rekomendasi, feedback, history |
| Hosting | Vercel | Hosting aplikasi web production |
| Backend API | Supabase Edge Function `aromatique-chat` | Chat streaming, assignment A/B/C, NLU, ranking produk, explanation generation |
| Database | Supabase Postgres | Menyimpan percakapan, message log, rekomendasi, feedback, product catalog, KG edges, eksperimen |
| LLM | OpenAI Chat Completions via Edge Function | Chat assistant, GPT NLU, explanation generation |
| Recommender data | Supabase tables `products`, `kg_edges`, `product_embeddings` | Product metadata dan knowledge graph serving |

Runtime flow sederhana:

```text
User browser
  -> Vercel frontend
  -> Supabase tables for conversation/message/feedback persistence
  -> Supabase Edge Function aromatique-chat
  -> Supabase products + kg_edges
  -> OpenAI API
  -> response kembali ke frontend
```

## 2. Struktur Repository

Repository production hanya berisi app Aromatique AI, bukan root tesis/training KGAT.

```text
aromatique-ai/
  src/
    components/
      AromatiqueApp.tsx
      AromatiqueRecs.tsx
      ui/
    integrations/
      supabase/
        client.ts
        types.ts
    routes/
      __root.tsx
      index.tsx
    styles.css
  supabase/
    functions/
      aromatique-chat/
        index.ts
        prompt-text.ts
        prompts/
    migrations/
  vercel.json
  vite.config.vercel.ts
  package.json
  .env.example
```

File yang sengaja tidak dipush:

```text
.env
.vercel/
.vite/
.wrangler/
dist/
node_modules/
supabase/.temp/
supabase/seed/
```

Alasan:

- `.env` berisi environment variable lokal.
- `node_modules`, `dist`, `.vercel`, `.vite` adalah build/cache artifact.
- `supabase/seed` berisi generated payload besar dan bukan runtime requirement Vercel.

## 3. Frontend

### 3.1 Entry Point

Route utama berada di:

```text
src/routes/index.tsx
```

Komponen utama:

```text
src/components/AromatiqueApp.tsx
```

Komponen rekomendasi dipisah:

```text
src/components/AromatiqueRecs.tsx
```

Pemisahan `AromatiqueRecs.tsx` dilakukan agar halaman rekomendasi dan asset gambar hero besar tidak ikut dimuat saat halaman welcome/consent pertama dibuka.

### 3.2 Halaman dan State

Frontend memakai state `view` untuk mengatur tampilan:

```ts
type View = "welcome" | "chat" | "recs" | "feedback" | "thanks";
```

Makna masing-masing view:

| View | Fungsi |
| --- | --- |
| `welcome` | Landing awal aplikasi |
| `chat` | Chatbot utama |
| `recs` | Halaman top 3 rekomendasi parfum |
| `feedback` | Form evaluasi penelitian |
| `thanks` | Halaman terima kasih setelah feedback |

State penting di frontend:

| State | Fungsi |
| --- | --- |
| `sessionId` | Anonymous browser session dari `localStorage` |
| `convId` | ID conversation di Supabase |
| `condition` | Assignment eksperimen A/B/C |
| `familiarity` | Level user: `pemula`, `penggemar`, `kolektor` |
| `messages` | Chat messages yang sedang tampil |
| `recs` | Batch rekomendasi yang sudah diterima |
| `feedback` | Jawaban form evaluasi |
| `loading` | State loading chat/recommendation |
| `startingConversation` | State saat menyiapkan conversation baru |

### 3.3 Consent dan Anonymous Session

Saat user klik mulai:

1. Consent modal muncul.
2. Jika user setuju, frontend menyimpan consent di `localStorage`.
3. Frontend membuat atau mengambil `sessionId`.
4. Frontend membuat row baru di tabel `conversations`.
5. Frontend memanggil Edge Function `mode: "init"` untuk mendapat assignment A/B/C dan greeting awal.

Key localStorage:

```text
aromatique_session_id
aromatique_consent_v1
```

### 3.4 Greeting Awal dan Familiarity Button

Setiap condition A/B/C memiliki greeting yang berakhir dengan pertanyaan:

```text
Sebelum kita mulai, boleh aku tahu dulu - seberapa familiar
kamu dengan dunia parfum?
```

Frontend menampilkan tiga button tag:

```text
Pemula
Penggemar
Kolektor
```

Pilihan user disimpan sebagai:

```text
experiment_sessions.familiarity
```

Pilihan familiarity juga ditambahkan sebagai message user, tetapi tidak dihitung sebagai preferensi aroma untuk mengaktifkan tombol rekomendasi.

### 3.5 Chat Streaming

Chat dikirim ke Edge Function dengan payload:

```json
{
  "mode": "chat",
  "messages": [],
  "conversation_id": "...",
  "session_id": "..."
}
```

Edge Function mengembalikan response streaming dengan format Server-Sent Event style:

```text
data: {"choices":[{"delta":{"content":"..."}}]}
```

Frontend membaca stream dengan:

```ts
resp.body.getReader()
```

Konten assistant ditambahkan bertahap ke message terakhir sehingga user melihat jawaban muncul streaming.

### 3.6 Markdown Ringan

Model kadang mengirim teks seperti:

```text
*Kencan Malam*
**Fresh**
```

Sebelumnya bintang tampil mentah karena bubble chat hanya merender plain text. Sekarang frontend memakai renderer markdown ringan untuk:

```text
*teks*
**teks**
```

Renderer ini tidak memakai `dangerouslySetInnerHTML`, sehingga lebih aman.

### 3.7 Rekomendasi

Tombol rekomendasi mengirim request:

```json
{
  "mode": "recommend",
  "messages": [],
  "conversation_id": "...",
  "session_id": "...",
  "batch_index": 1,
  "exclude_product_ids": []
}
```

Jika user generate ulang setelah batch pertama, frontend mengirim `exclude_product_ids` dari produk yang sudah pernah muncul. Backend juga melakukan pengecekan ulang dari tabel `recommendations`, sehingga produk lama tidak direkomendasikan lagi pada batch baru.

### 3.8 Feedback

Feedback disimpan ke tabel:

```text
feedback
```

Isi feedback:

- `conversation_id`
- `session_id`
- `answers` dalam JSON
- `explanation_type`
- `model_version`

Kelompok pertanyaan feedback:

| Group | Kode |
| --- | --- |
| Kepercayaan terhadap AI | T1, T2 |
| Niat Pembelian | PI1, PI2 |
| Kegunaan dan Kepuasan | U1, U2, S1, S2 |

## 4. Optimasi Frontend

Beberapa optimasi yang sudah diterapkan:

### 4.1 Menghapus Bottleneck Material Symbols

Sebelumnya icon memakai Google Material Symbols webfont. Dampaknya:

- Consent modal kadang muncul dulu, icon menyusul setelah font selesai load.
- Ada duplicate font loading dari `styles.css` dan `__root.tsx`.

Sekarang icon memakai `lucide-react`, sehingga:

- Tidak perlu menunggu font icon eksternal.
- Icon dirender sebagai SVG React.
- Consent modal terasa lebih cepat.

### 4.2 Mengurangi Async Waterfall Saat Masuk Chat

Sebelumnya UI chat baru tampil setelah:

1. Insert conversation selesai.
2. Edge Function `init` selesai.
3. Greeting tersimpan ke `messages`.
4. History reload.

Sekarang:

- Setelah user setuju, view langsung pindah ke `chat`.
- UI menampilkan state "Menyiapkan percakapan...".
- Conversation dan greeting tetap disiapkan async.
- Save message dan load history tidak menahan rendering utama.

Dampak:

- Perceived loading lebih cepat.
- User tidak melihat aplikasi diam terlalu lama setelah klik setuju.

### 4.3 Lazy Load Rekomendasi

Komponen rekomendasi dipisah ke:

```text
src/components/AromatiqueRecs.tsx
```

Dimuat dengan:

```ts
const RecsScreen = lazy(() => import("./AromatiqueRecs"));
```

Dampak:

- Kode rekomendasi tidak masuk initial render path.
- Asset `recommendation-hero.png` baru relevan saat user membuka halaman rekomendasi.

### 4.4 Build Vercel Khusus

Vercel memakai:

```text
vite.config.vercel.ts
```

Config ini memakai:

- `tanstackStart`
- `nitro({ preset: "vercel" })`
- `viteReact`
- `tailwindcss`
- `vite-tsconfig-paths`

## 5. Backend: Supabase Edge Function

Backend utama:

```text
supabase/functions/aromatique-chat/index.ts
```

Function ini menangani beberapa mode:

| Mode | Fungsi |
| --- | --- |
| `init` | Assignment A/B/C, persist experiment session, return greeting |
| `familiarity` | Simpan familiarity user |
| `chat` | Chat streaming dengan prompt sesuai condition |
| `recommend` | Ekstraksi preferensi, ranking produk, explanation, persist rekomendasi |

Endpoint production:

```text
https://<project-ref>.supabase.co/functions/v1/aromatique-chat
```

Frontend memanggil endpoint ini lewat:

```ts
`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/aromatique-chat`
```

### 5.1 Authorization

Edge Function memeriksa request dari:

- header `apikey`
- header `Authorization: Bearer ...`

Value yang diterima adalah Supabase publishable/anon key yang sudah dikonfigurasi.

### 5.2 Prompt Config A/B/C

Condition:

| Condition | Explanation Style | Prompt File |
| --- | --- | --- |
| A | Feature-based explanation | `system_prompt_feature_based_explanation.md` |
| B | Narrative-based explanation | `system_prompt_narrative_based_explanation.md` |
| C | Comparative-based explanation | `system_prompt_comparative_based_explanation.md` |

Prompt disimpan di:

```text
supabase/functions/aromatique-chat/prompts/
```

Prompt juga tersedia sebagai embedded fallback di:

```text
supabase/functions/aromatique-chat/prompt-text.ts
```

Jika `Deno.readTextFile` gagal membaca prompt markdown, Edge Function memakai embedded prompt fallback.

### 5.3 Assignment A/B/C

Assignment dilakukan di backend agar condition tidak ditentukan frontend.

Alur:

1. Frontend membuat conversation.
2. Frontend memanggil `mode: "init"`.
3. Edge Function mengecek apakah conversation/session sudah punya condition.
4. Jika belum ada, backend memilih condition secara balanced.
5. Assignment dipersist ke:

```text
conversations.condition
experiment_sessions.condition
experiment_sessions.explanation_type
```

Metadata yang disimpan:

- `prompt_name`
- `prompt_version`
- `llm_model`
- `recommendation_engine`
- `model_version`

### 5.4 Chat Mode

Chat mode membangun system prompt berdasarkan assigned condition:

```text
Runtime context:
- PHASE 1 conversation mode
- Keep assigned style for condition A/B/C
- Do not recommend product names in chat mode
- Ask one concise question per turn
- Invite user to click recommendation button when enough context is collected
- Never reveal internal condition label
```

Jika `OPENAI_API_KEY` tidak tersedia di Edge Function environment, backend memakai fallback response.

### 5.5 Recommendation Mode

Recommendation mode melakukan beberapa tahap:

```text
messages
  -> hybrid preference extraction
  -> product ranking
  -> KG path building
  -> GPT explanation generation
  -> persist recommendation batch
  -> return top 3 products
```

#### 5.5.1 Hybrid Preference Extraction

Backend menggabungkan dua pendekatan:

1. Deterministic extraction
2. GPT NLU extraction

Deterministic extraction memakai `PREFERENCE_LEXICON`, misalnya:

| Label | Terms |
| --- | --- |
| segar | fresh, citrus, aquatic, green, aromatic |
| manis | sweet, vanilla, caramel, cacao, honey |
| floral | floral, white floral, rose, jasmine |
| woody | woody, sandalwood, cedar, oud |
| hangat | amber, warm spicy, balsamic, musky |
| kasual | fresh, citrus, aromatic, clean |
| sporty | fresh, aquatic, citrus, green |

GPT NLU meminta model mengembalikan JSON preference seperti:

```json
{
  "liked_terms": [],
  "disliked_terms": [],
  "occasion": "",
  "style": "",
  "intensity": "",
  "time_of_use": "",
  "summary": ""
}
```

#### 5.5.2 Product Ranking

Ranking dilakukan terhadap tabel `products`.

Produk diberi skor berdasarkan:

- kesesuaian terms dengan `accords`
- kesesuaian `visual_notes`
- `main_accords`
- `olfactory_family`
- matching occasion/style
- penalty untuk disliked terms

Output ranking kemudian dipilih top 3.

#### 5.5.3 Exclude Produk Lama

Agar rekomendasi ulang tidak sama:

1. Frontend mengirim `exclude_product_ids`.
2. Backend juga membaca batch lama dari tabel `recommendations`.
3. Semua product id lama dimasukkan ke set excluded.
4. Selector memilih top 3 dari ranking yang belum pernah muncul.

#### 5.5.4 KG Path

Backend membaca `kg_edges` untuk membangun path explanation:

```text
product -> relation -> entity
```

Contoh relation:

- `has_accord`
- `has_visual_note`
- `belongs_to_family`
- `inspired_by`

KG path dipakai untuk membuat explanation lebih grounded.

#### 5.5.5 GPT Explanation

Backend memanggil GPT untuk menghasilkan reason per produk sesuai condition A/B/C.

Prompt explanation membatasi output:

- hanya memakai produk yang diberikan
- hanya memakai KG paths yang diberikan
- tidak menambah produk
- tidak menambah klaim yang tidak ada di input
- return JSON dengan `summary` dan `recommendations`

Jika GPT explanation gagal, backend tetap mengembalikan fallback reason.

### 5.6 Persist Recommendation Batch

Setiap hasil rekomendasi disimpan ke tabel `recommendations`.

Kolom penting:

- `conversation_id`
- `batch_index`
- `products`
- `recommendations`
- `summary`
- `kg_paths`
- `explanation_type`
- `recommendation_engine`
- `model_version`
- `prompt_name`
- `prompt_version`
- `llm_model`
- `explanation_payload`

## 6. Database Supabase

### 6.1 Core Research Tables

Migration awal membuat:

```text
conversations
messages
recommendations
feedback
```

#### conversations

Menyimpan percakapan per anonymous session.

Kolom utama:

- `id`
- `session_id`
- `title`
- `condition`
- `created_at`
- `updated_at`

#### messages

Menyimpan semua pesan user dan assistant.

Kolom utama:

- `conversation_id`
- `role`
- `content`
- `created_at`

#### recommendations

Menyimpan batch rekomendasi.

Kolom utama:

- `conversation_id`
- `batch_index`
- `products`
- `recommendations`
- `summary`
- `kg_paths`
- metadata experiment/prompt

#### feedback

Menyimpan form evaluasi.

Kolom utama:

- `conversation_id`
- `session_id`
- `answers`
- `explanation_type`
- `model_version`

### 6.2 Serving Tables

Untuk serving rekomendasi, backend tidak menjalankan KGAT training di runtime. Data hasil preprocessing/model disimpan ke Postgres.

Tables:

```text
products
kg_edges
product_embeddings
```

#### products

Menyimpan katalog produk Aromatique.

Kolom penting:

- `product_id`
- `kgat_product_id`
- `old_entity_id`
- `product_name`
- `visual_note`
- `revolutionize`
- `main_accords`
- `olfactory_family`
- `accords`
- `visual_notes`
- `metadata`

#### kg_edges

Menyimpan edge knowledge graph.

Kolom penting:

- `head_entity_id`
- `head_entity_type`
- `head_name`
- `relation_id`
- `relation_name`
- `tail_entity_id`
- `tail_entity_type`
- `tail_name`
- `head_product_id`
- `tail_product_id`
- `source_dataset`
- `model_version`

#### product_embeddings

Disiapkan untuk menyimpan embedding atau feature representation per produk.

Kolom penting:

- `product_id`
- `model_version`
- `embedding`
- `feature_terms`
- `features`

### 6.3 Experiment Sessions

Tabel:

```text
experiment_sessions
```

Menyimpan assignment riset.

Kolom penting:

- `session_id`
- `conversation_id`
- `condition`
- `explanation_type`
- `familiarity`
- `recommendation_engine`
- `model_version`
- `prompt_name`
- `prompt_version`
- `llm_model`
- `metadata`
- `assigned_at`

Nilai `familiarity`:

```text
pemula
penggemar
kolektor
```

### 6.4 Row Level Security

Tabel research memakai RLS public policy karena aplikasi dirancang anonymous dan tidak menyimpan PII.

Policy yang aktif secara umum:

```text
FOR ALL USING (true) WITH CHECK (true)
```

Catatan:

- Ini memudahkan anonymous research testing.
- Untuk production publik jangka panjang, policy ini sebaiknya diperketat, misalnya lewat server-side writes atau scoped tokens.

## 7. Logging dan Monitoring Riset

### 7.1 Distribusi Condition A/B/C

```sql
select condition, count(*) as sessions
from public.experiment_sessions
group by condition
order by condition;
```

### 7.2 Distribusi Familiarity per Condition

```sql
select condition, familiarity, count(*) as sessions
from public.experiment_sessions
group by condition, familiarity
order by condition, familiarity nulls first;
```

### 7.3 Jumlah Recommendation Batch

```sql
select
  explanation_type,
  batch_index,
  count(*) as total_batches
from public.recommendations
group by explanation_type, batch_index
order by explanation_type, batch_index;
```

### 7.4 Cek Produk yang Direkomendasikan

```sql
select
  r.created_at,
  r.conversation_id,
  r.batch_index,
  r.explanation_type,
  item->>'product_id' as product_id,
  item->>'product_name' as product_name
from public.recommendations r,
jsonb_array_elements(coalesce(r.recommendations, r.products)) as item
order by r.created_at desc;
```

### 7.5 Cek Feedback per Condition

```sql
select
  explanation_type,
  count(*) as total_feedback
from public.feedback
group by explanation_type
order by explanation_type;
```

### 7.6 Join Session, Recommendation, Feedback

```sql
select
  es.condition,
  es.familiarity,
  es.prompt_name,
  es.llm_model,
  r.batch_index,
  r.created_at as recommendation_at,
  f.created_at as feedback_at,
  f.answers
from public.experiment_sessions es
left join public.recommendations r
  on r.conversation_id = es.conversation_id
left join public.feedback f
  on f.conversation_id = es.conversation_id
order by es.assigned_at desc;
```

## 8. Deployment

### 8.1 Vercel

Live URL:

```text
https://aromatique-ai.vercel.app
```

Build config:

```text
vercel.json
vite.config.vercel.ts
```

`vercel.json`:

```json
{
  "installCommand": "npm ci",
  "buildCommand": "vite build --config vite.config.vercel.ts",
  "framework": null
}
```

Environment variables di Vercel:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_PROJECT_ID
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
```

Jangan masukkan:

```text
SUPABASE_SEED_KEY
OPENAI_API_KEY
```

`OPENAI_API_KEY` dipakai di Supabase Edge Function, bukan di Vercel frontend.

### 8.2 Supabase Edge Function

Deploy command:

```bash
supabase functions deploy aromatique-chat \
  --project-ref <project-ref> \
  --no-verify-jwt \
  --use-api
```

Environment variables Supabase Edge Function:

```text
OPENAI_API_KEY
OPENAI_MODEL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY atau key yang sesuai untuk server-side DB access
SUPABASE_PUBLISHABLE_KEY / SUPABASE_ANON_KEY
```

Catatan:

- Frontend tidak boleh membawa `OPENAI_API_KEY`.
- Semua call OpenAI dilakukan dari Edge Function.

## 9. Security dan Privacy

### 9.1 Data User

Data yang disimpan:

- anonymous `session_id`
- conversation text
- selected familiarity
- recommendations
- feedback answers

Data yang tidak disimpan secara eksplisit:

- nama user
- email
- nomor telepon
- akun login

### 9.2 API Key

Frontend hanya memakai Supabase publishable key. Key ini memang public-facing.

Secret yang harus tetap server-side:

```text
OPENAI_API_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_SEED_KEY
```

### 9.3 Git Hygiene

File yang harus tetap ignored:

```text
.env
.env.*
!.env.example
node_modules/
dist/
.vercel/
.wrangler/
supabase/seed/
```

## 10. Alur User End-to-End

### 10.1 Start

```text
User buka aromatique-ai.vercel.app
  -> Welcome screen
  -> Consent modal
  -> User setuju
  -> Frontend membuat conversation
  -> Edge Function assign condition A/B/C
  -> Greeting muncul
```

### 10.2 Familiarity

```text
User pilih Pemula/Penggemar/Kolektor
  -> message user ditambahkan
  -> experiment_sessions.familiarity diupdate
  -> chat lanjut ke pertanyaan preferensi parfum
```

### 10.3 Chat

```text
User menjawab pertanyaan
  -> frontend simpan message user
  -> Edge Function chat mode
  -> OpenAI streaming response
  -> frontend simpan message assistant
```

### 10.4 Recommendation

```text
User klik Tampilkan Rekomendasi
  -> Edge Function recommend mode
  -> extract preferences
  -> rank products
  -> build KG paths
  -> generate explanations
  -> persist recommendation batch
  -> show top 3 products
```

### 10.5 Generate Ulang

```text
User lanjut chat lalu generate ulang
  -> frontend kirim exclude_product_ids
  -> backend gabungkan dengan history recommendations
  -> backend pilih produk berbeda
  -> batch_index bertambah
```

### 10.6 Feedback

```text
User selesai
  -> isi feedback
  -> answers disimpan ke table feedback
  -> thanks screen
```

## 11. Testing Checklist

Gunakan checklist ini setelah deployment frontend atau Edge Function.

### 11.1 Frontend

- Welcome page tampil cepat.
- Consent modal tampil dan icon langsung muncul.
- Klik setuju langsung masuk chat dengan state loading singkat.
- Greeting mengandung pertanyaan familiarity.
- Button Pemula/Penggemar/Kolektor muncul.
- Teks `*bold*` tampil bold, bukan bintang mentah.
- Chat streaming berjalan.
- Tombol rekomendasi aktif setelah user memberikan preferensi aroma.
- Rekomendasi tampil responsif di mobile/tablet/desktop.

### 11.2 Backend

- `mode: init` mengembalikan condition A/B/C.
- `mode: familiarity` menyimpan familiarity.
- `mode: chat` streaming.
- `mode: recommend` mengembalikan 3 produk.
- Generate ulang tidak mengulang produk lama.
- Recommendation metadata tersimpan.

### 11.3 Database

- Row baru muncul di `conversations`.
- Messages tersimpan di `messages`.
- Assignment tersimpan di `experiment_sessions`.
- Familiarity tidak null setelah user memilih tag.
- Rekomendasi tersimpan di `recommendations`.
- Feedback tersimpan di `feedback`.

## 12. Known Constraints

1. RLS public policy masih sangat terbuka untuk kebutuhan anonymous testing.
2. Recommendation hero image masih besar, tetapi sudah lazy-loaded di recommendation chunk.
3. Lint belum sepenuhnya bersih karena konfigurasi Prettier/CRLF dan beberapa rule existing.
4. Runtime recommender memakai metadata + KG serving di Supabase, bukan menjalankan training KGAT di production.
5. Kualitas rekomendasi bergantung pada kelengkapan `products`, `kg_edges`, prompt, dan hasil NLU.

## 13. File Penting

| File | Fungsi |
| --- | --- |
| `src/components/AromatiqueApp.tsx` | Main app flow: welcome, consent, chat, feedback |
| `src/components/AromatiqueRecs.tsx` | Recommendation page, lazy loaded |
| `src/integrations/supabase/client.ts` | Supabase client frontend/SSR |
| `src/routes/__root.tsx` | Root route, metadata, font links |
| `src/styles.css` | Global style, Tailwind theme, UI styling |
| `supabase/functions/aromatique-chat/index.ts` | Main backend Edge Function |
| `supabase/functions/aromatique-chat/prompts/*` | Prompt A/B/C |
| `supabase/functions/aromatique-chat/prompt-text.ts` | Embedded prompt fallback |
| `supabase/migrations/*` | Database schema |
| `vercel.json` | Vercel build command |
| `vite.config.vercel.ts` | Vite/Nitro config untuk Vercel |
| `.env.example` | Template environment variables |

## 14. Kesimpulan Arsitektur

Aromatique AI memakai pola thin frontend + serverless recommendation backend:

- Frontend fokus pada UX, consent, chat streaming, rendering rekomendasi, dan feedback.
- Edge Function mengontrol semua logic penting: assignment A/B/C, prompt style, NLU, ranking, KG path, GPT explanation, dan persistence.
- Supabase Postgres menjadi pusat data riset dan serving catalog.
- Vercel hanya menjalankan aplikasi web dan SSR bundle TanStack Start.

Pemisahan ini membuat aplikasi cukup ringan untuk user, tetapi tetap menyimpan data eksperimen secara lengkap untuk kebutuhan tesis.
