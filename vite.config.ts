import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// `vite build --mode demo`: sustituye Supabase por un mock en memoria con datos de ejemplo
const demoSupabase = (): Plugin => ({
  name: "demo-supabase",
  enforce: "pre",
  resolveId(source, importer) {
    if (!importer || importer.endsWith("mockSupabase.ts") || !source.startsWith(".")) return;
    const target = path.resolve(path.dirname(importer), source);
    if (target === path.resolve(__dirname, "src/lib/supabase")) {
      return path.resolve(__dirname, "src/demo/mockSupabase.ts");
    }
  },
});

export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
    plugins: [react(), tailwindcss(), ...(demo ? [demoSupabase()] : [])],
    ...(demo && {
      define: {
        "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://demo.supabase.co"),
        "import.meta.env.VITE_HOTEL_NAME": JSON.stringify("Hotel Demo"),
      },
      build: {
        outDir: "dist-demo",
        assetsInlineLimit: 100_000,
        chunkSizeWarningLimit: 2000,
        rolldownOptions: { output: { codeSplitting: false } },
      },
    }),
  };
});
