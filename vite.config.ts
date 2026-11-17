import { builtinModules, isBuiltin } from "node:module";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { globalExternals } from "./build/global-externals.js";

export default defineConfig(({ mode }) => {
  const main = mode === "main";
  return {
    plugins: main ? [] : [
      react(),
      globalExternals({
        react: "globalThis.FreelensExtensionApi.React",
        "react-dom": "globalThis.FreelensExtensionApi.ReactDom",
        "react/jsx-runtime": "globalThis.FreelensExtensionApi.ReactJsxRuntime",
        mobx: "globalThis.FreelensExtensionApi.Mobx",
        "mobx-react": "globalThis.FreelensExtensionApi.MobxReact",
      }),
      {
        name: "no-node-in-renderer",
        enforce: "pre",
        resolveId(source, importer) {
          if (isBuiltin(source) || source === "electron" || source.startsWith("electron/")) {
            this.error(`${source} imported by ${importer} is unavailable in the renderer`);
          }
          return null;
        },
      },
    ],
    define: main ? {} : { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      target: "esnext",
      outDir: `out/${main ? "main" : "renderer"}`,
      lib: {
        entry: resolve(__dirname, `src/${main ? "main/index.ts" : "renderer/index.tsx"}`),
        formats: ["es"],
        fileName: () => "index.mjs",
      },
      rolldownOptions: {
        platform: main ? "node" : "browser",
        external: main ? ["electron", /^electron\//, /^node:/, ...builtinModules] : [],
      },
      sourcemap: true,
    },
  };
});
