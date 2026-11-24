// serve.ts — tiny development server for the game/ folder.
//
// Usage: node serve.ts [--port N], then open the printed localhost URL.
// Only Node's standard library is used. Requests are mapped into game/,
// directory escapes are refused, and the response carries the MIME type
// a browser expects for each extension. Treat this as a local helper,
// not as a public web server.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./game', import.meta.url)));

const args = process.argv.slice(2);
const flagIndex = args.indexOf('--port');
const wanted = flagIndex === -1 ? 8080 : Number(args[flagIndex + 1]);
const listenPort = Number.isInteger(wanted) && wanted > 0 && wanted < 65536 ? wanted : 8080;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

function pathForRequest(raw: string | undefined): string | null {
  const parsed = new URL(raw ?? '/', 'http://localhost');
  let name: string;
  try { name = decodeURIComponent(parsed.pathname); } catch { return null; }
  if (name.endsWith('/')) name += 'index.html';
  return resolve(join(root, normalize(name)));
}

const httpServer = createServer((req, res) => {
  const target = pathForRequest(req.url);
  if (target === null) { res.writeHead(400).end('bad request'); return; }
  if (target !== root && !target.startsWith(root + sep)) { res.writeHead(403).end('forbidden'); return; }
  let length: number;
  try {
    const info = statSync(target);
    if (!info.isFile()) throw new Error('not a file');
    length = info.size;
  } catch { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, {
    'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
    'content-length': length,
    'cache-control': 'no-store',
  });
  createReadStream(target).pipe(res);
});

httpServer.listen(listenPort, '127.0.0.1', () => {
  console.log(`game/ is on http://localhost:${listenPort}`);
});
