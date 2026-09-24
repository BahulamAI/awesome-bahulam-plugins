import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Builds the Workplane view into `workspace/` as a committed artifact.
 *
 * The host serves a plugin's directory statically with no build step, so the
 * bundle has to be in the repository. Nothing here is a runtime dependency of
 * the plugin: a user installing it gets plain files.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "workspace",
    emptyOutDir: false,
    sourcemap: false,
    // One predictable filename, because workplane.html references it directly
    // and a hashed name would need an HTML rewrite on every build.
    rollupOptions: {
      input: "workplane-src/main.tsx",
      output: {
        entryFileNames: "workplane.js",
        assetFileNames: "workplane.[ext]",
        manualChunks: undefined,
      },
    },
  },
});
