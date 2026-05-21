// Vite config khusus untuk deployment Vercel.
// Tidak memakai preset Lovable (yang menarget Cloudflare Workers).
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  build: {
    // Vite 7 defaults to Safari 16.4. Keep the Vercel bundle usable on older iOS Safari.
    target: "es2020",
    cssTarget: "safari14",
  },
  plugins: [
    tsConfigPaths(),
    tanstackStart({ prerender: { enabled: false } }),
    nitro({ preset: "vercel" }),
    viteReact(),
  ],
});
