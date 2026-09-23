import { createServer } from "vite";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSandboxMiddleware } from "./http.mjs";
import { previewToolbarHtml } from "./toolbar.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const port = Number(process.env.PREVIEW_PORT || 4182);
const assetRoot = fileURLToPath(
  new URL("../../../backend/static/planet-nobg/", import.meta.url),
);
const sandboxMiddleware = createSandboxMiddleware();
const preview = await createServer({
  root,
  define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
  server: { host: "127.0.0.1", port, strictPort: true },
  plugins: [
    {
      name: "local-only-interactive-sandbox",
      transformIndexHtml(html) {
        return html.replace("<body>", `<body>${previewToolbarHtml()}`);
      },
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url, `http://127.0.0.1:${port}`);
          if (url.pathname.startsWith("/preview-assets/")) {
            const filename = path.basename(url.pathname);
            if (!/^[A-Za-z-]+\.png$/.test(filename)) {
              res.statusCode = 404;
              res.end();
              return;
            }
            try {
              res.setHeader("Content-Type", "image/png");
              res.end(await readFile(path.join(assetRoot, filename)));
            } catch {
              res.statusCode = 404;
              res.end();
            }
            return;
          }
          if (!url.pathname.startsWith("/api/")) return next();
          await sandboxMiddleware(req, res);
        });
      },
    },
  ],
});
await preview.listen();
preview.printUrls();
