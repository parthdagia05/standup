import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.resolve(here, "../extension/media");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

/** Serves site/ and, under /media, the real panel files from the extension. */
export function serve(port = 0) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x").pathname;
    const file = url.startsWith("/media/") ? path.join(MEDIA, url.slice(7)) : path.join(here, "site", url === "/" ? "index.html" : url);
    if (!file.startsWith(here) && !file.startsWith(MEDIA) && !file.startsWith(path.resolve(here, ".."))) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end();
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}
