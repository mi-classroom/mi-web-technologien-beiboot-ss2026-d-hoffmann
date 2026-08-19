import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// `base` defaults to '/' for local dev/build/preview. The GitHub Pages
// deploy workflow (.github/workflows/deploy.yml) overrides this via the
// GH_PAGES_BASE env var at build time, since the site is served from a
// project-page subpath (https://<org>.github.io/<repo>/) rather than the
// domain root.
const base = process.env.GH_PAGES_BASE ?? '/';

export default defineConfig({
  base,
  build: {
    rollupOptions: {
      input: {
        // The gesture-controlled gallery (Task 5, Weg A) is the primary
        // deployed app and lives at the site root.
        main: resolve(__dirname, 'index.html'),
        // The earlier hand-tracking-modes demo (Assignments 2-4) is kept
        // as a secondary page under /test/ rather than removed outright.
        test: resolve(__dirname, 'test/index.html'),
      },
    },
  },
});
