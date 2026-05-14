// Vite config khusus untuk deployment Vercel.
// Tidak memakai preset Lovable (yang menarget Cloudflare Workers).
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart({ prerender: { enabled: false } }),
    nitro({ preset: "vercel" }),
    viteReact(),
  ],
});
