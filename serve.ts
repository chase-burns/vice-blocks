// serve.ts — a tiny static file server for playing the game locally.
//
//   node serve.ts [--port N]
//
// Open the localhost address it prints in your browser.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const serveRoot = fileURLToPath(new URL('./game/', import.meta.url));

let listenPort = 5173;
const cliArgs = process.argv.slice(2);
for (let i = 0; i < cliArgs.length; i++) {
  if (cliArgs[i] === '--port') listenPort = Number(cliArgs[++i]) || listenPort;
  else if (cliArgs[i].startsWith('--port=')) listenPort = Number(cliArgs[i].slice(7)) || listenPort;
}

const CONTENT_TYPES: Record<string, string> = {
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

const httpServer = createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
    let requestPath = decodeURIComponent(parsedUrl.pathname);
    if (requestPath.endsWith('/')) requestPath += 'index.html';

    const filePath = normalize(join(serveRoot, requestPath));
    if (!filePath.startsWith(serveRoot)) { res.writeHead(403).end('forbidden'); return; }

    const fileBody = await readFile(filePath);
    res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
    res.end(fileBody);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

httpServer.listen(listenPort, '127.0.0.1', () => {
  console.log(`Vice Blocks 3D dev server: http://127.0.0.1:${listenPort}/`);
});
