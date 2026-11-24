// serve.ts — a dependency-free static file server for the game.
// It serves the game/ folder (plus this repo root) over HTTP with the
// content types a browser needs for ES modules, stylesheets and the
// screenshot JPEGs, and refuses to wander outside the served root.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
};

export function startServer(port = 8734): void {
  const root = fileURLToPath(new URL("./game/", import.meta.url));
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      let path = decodeURIComponent(url.pathname);
      if (path === "/" || path.endsWith("/")) path += "index.html";
      const file = normalize(join(root, path));
      if (!file.startsWith(root)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
  });
  server.listen(port, () => {
    console.log(`Vice Blocks 3D on http://localhost:${port}/`);
  });
}

// Direct run (`node serve.ts`) starts the server with default settings.
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
