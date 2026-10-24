// Minimal static file server for local use: `npm start`, then open http://localhost:8080.
// The app is plain static files, so any static host (GitHub Pages, Netlify, ...) works too.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

const server = createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  // Only serve files inside the project, and never dotfiles such as .git.
  const filePath = normalize(join(root, pathname));
  const relative = filePath.slice(root.length);
  if (!filePath.startsWith(root) || relative.split(sep).some((part) => part.startsWith('.'))) {
    return send(res, 404, 'Not found');
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': TYPES[extname(filePath)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
    });
    createReadStream(filePath).pipe(res);
  } catch {
    send(res, 404, 'Not found');
  }
});

server.listen(port, () => {
  console.log(`Ride Price Compare running at http://localhost:${port}`);
});
