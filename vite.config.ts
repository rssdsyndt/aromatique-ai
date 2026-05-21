import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  build: {
    target: "es2020",
    cssTarget: "safari14",
  },
  plugins: [
    tsConfigPaths(),
    tanstackStart({ prerender: { enabled: false } }),
    nitro(),
    viteReact(),
  ],
});
