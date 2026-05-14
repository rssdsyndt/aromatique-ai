import { createFileRoute } from "@tanstack/react-router";
import AromatiqueApp from "@/components/AromatiqueApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aromatique AI — Asisten Rekomendasi Parfum" },
      { name: "description", content: "Temukan parfum Aromatique yang paling cocok untukmu lewat percakapan singkat dengan asisten AI." },
      { property: "og:title", content: "Aromatique AI — Asisten Rekomendasi Parfum" },
      { property: "og:description", content: "Asisten AI rekomendasi parfum dari tim peneliti UGM x Aromatique Perfume." },
    ],
  }),
  component: AromatiqueApp,
});
