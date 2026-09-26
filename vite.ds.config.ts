// Design-system library build. This is a SEPARATE build from `pnpm build` (the Tauri app) —
// it does not touch `dist/` and the app is unaffected by it.
//
// It bundles `src/design-system/entry.tsx` — a curated subset of the real GitBaro React
// components, plus React itself (React 19 has no UMD build) — into ONE classic IIFE script
// that assigns `window.GitBaro`, for the "GitBaro" Design System artifact's
// `components/bundle.js`. `postcss.config.js` (Tailwind) still applies, so `bundle.css` is
// compiled from the real `src/styles/globals.css` tokens over the components actually used.
//
// Run with `pnpm ds:bundle`. Output goes to the gitignored `dist-ds/`; only
// `bundle.js`/`bundle.css` from there are ever published to the artifact (see
// `scripts/ds-postprocess.mjs`, which also strips `@font-face` — the artifact already hosts
// those fonts under its own `fonts/`, loaded by its own `tokens.css`).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist-ds",
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    lib: {
      entry: path.resolve(__dirname, "src/design-system/entry.tsx"),
      name: "GitBaro",
      formats: ["iife"],
      fileName: () => "bundle.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: (info) => (info.names?.some((n) => n.endsWith(".css")) ? "bundle.css" : "assets/[name][extname]"),
      },
    },
    minify: "esbuild",
    target: "es2020",
  },
});
