// serve.ts — minimal static server for trying the game locally.
//
//   node serve.ts [--port N]
//
// Then visit the printed localhost address in a browser.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('./game/', import.meta.url));

let port = 5173;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') port = Number(args[++i]) || port;
  else if (args[i].startsWith('--port=')) port = Number(args[i].slice(7)) || port;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    const target = normalize(join(rootDir, pathname));
    if (!target.startsWith(rootDir)) { res.writeHead(403).end('forbidden'); return; }

    const body = await readFile(target);
    res.writeHead(200, { 'content-type': MIME_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Vice Blocks 3D dev server: http://127.0.0.1:${port}/`);
});
