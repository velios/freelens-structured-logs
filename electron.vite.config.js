import { builtinModules } from "node:module";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { globalExternals } from "./build/global-externals.js";

// Modules provided by the Node.js/Electron runtime in the Freelens host. They
// must stay external (left as `require(...)`) instead of being bundled.
const runtimeExternals = ["electron", /^electron\//, ...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

export default defineConfig({
  // renderer process in Freelens can use Node.js modules, so it is built with
  // the settings for a preload script
  preload: {
    build: {
      lib: {
        entry: resolve(__dirname, "src/renderer/index.tsx"),
        // Freelens 1.xx extensions are CommonJS modules
        formats: ["cjs"],
      },
      outDir: "out/renderer",
      rolldownOptions: {
        external: runtimeExternals,
        output: {
          // silence warning about using `chunk.default` to access the default export
          exports: "named",
        },
      },
      sourcemap: true,
    },
    plugins: [
      react(),
      globalExternals({
        // the modules are provided by the host app as a global variable
        "@freelensapp/extensions": "global.LensExtensions",
        mobx: "global.Mobx",
        "mobx-react": "global.MobxReact",
        react: "global.React",
        "react-dom": "global.ReactDOM",
        "react-router-dom": "global.ReactRouterDom",
        "react/jsx-runtime": "global.ReactJsxRuntime",
      }),
    ],
  },
});
