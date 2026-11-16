import { createServer } from 'node:http';
import { createReadStream, mkdirSync, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, extname, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function inside(root, target) {
  const base = resolve(root) + sep;
  const full = resolve(target);
  return full === resolve(root) || full.startsWith(base);
}

export function serve({ root, mounts = {}, uploadDir = null, port = 0 }) {
  if (uploadDir) mkdirSync(uploadDir, { recursive: true });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = decodeURIComponent(url.pathname);
      if (req.method === 'PUT' && uploadDir && path.startsWith('/__out/')) {
        const name = path.slice('/__out/'.length).replace(/[^A-Za-z0-9._()-]/g, '_');
        const target = join(uploadDir, name);
        const sink = createWriteStream(target);
        req.pipe(sink);
        sink.on('finish', () => {
          res.writeHead(204);
          res.end();
        });
        sink.on('error', () => {
          res.writeHead(500);
          res.end();
        });
        return;
      }
      let base = root;
      let rel = path;
      for (const [prefix, dir] of Object.entries(mounts)) {
        if (path.startsWith(prefix)) {
          base = dir;
          rel = path.slice(prefix.length);
          break;
        }
      }
      let file = normalize(join(base, rel));
      if (!inside(base, file)) {
        res.writeHead(403);
        res.end();
        return;
      }
      let info = await stat(file).catch(() => null);
      if (info && info.isDirectory()) {
        file = join(file, 'index.html');
        info = await stat(file).catch(() => null);
      }
      if (!info) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': info.size, 'cache-control': 'no-store' });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  return new Promise((done) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      done({ url: `http://127.0.0.1:${address.port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}
