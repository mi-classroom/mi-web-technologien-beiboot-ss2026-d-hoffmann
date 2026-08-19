import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const base = process.env.GH_PAGES_BASE ?? '/';

// Redirects the bare `/test` path (no trailing slash) to `/test/` 
function redirectTestPath() {
  const middleware = (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === `${base}test` || url.pathname === '/test') {
      res.statusCode = 301;
      res.setHeader('Location', `${url.pathname}/${url.search}`);
      res.end();
      return;
    }
    next();
  };
  return {
    name: 'redirect-test-path',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  base,
  plugins: [redirectTestPath()],
  appType: 'mpa',
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
