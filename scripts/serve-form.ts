import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const PORT = 3333;
const FORM_DIR = path.join(__dirname, '..', 'form');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  // Normalize URL — default to index.html
  let urlPath = req.url || '/';
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/favicon.ico') { res.writeHead(204); res.end(); return; }

  // Prevent directory traversal
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(FORM_DIR, safePath);

  // Must stay inside FORM_DIR
  if (!filePath.startsWith(FORM_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${safePath}`);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
    console.log(`  ${req.method} ${urlPath}`);
  });
});

server.listen(PORT, () => {
  console.log(`\n🌐  Form server running at http://localhost:${PORT}`);
  console.log('    Press Ctrl+C to stop.\n');
});
