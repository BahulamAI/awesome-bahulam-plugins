import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Builds the Workplane view into a staging directory. `scripts/inline.mjs` then
 * folds the JS and CSS into a single `workspace/workplane.html`.
 *
 * It has to be one file. The local service authorises EVERY request with a
 * `?token=` query parameter or an `x-bahulam-local-token` header, and a
 * relative `<script src>` carries neither — external assets come back 401. The
 * plugin's original panel is a single self-contained file for the same reason.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "workspace/.wp-build",
    emptyOutDir: true,
    sourcemap: false,
    // Fold small assets in; anything left over would be a 401 waiting to happen.
    assetsInlineLimit: 1024 * 1024,
    rollupOptions: {
      input: "workplane-src/main.tsx",
      output: {
        entryFileNames: "bundle.js",
        assetFileNames: "bundle.[ext]",
        manualChunks: undefined,
        inlineDynamicImports: true,
      },
    },
  },
});
