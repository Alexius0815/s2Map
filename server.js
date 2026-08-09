#!/usr/bin/env node
/**
 * Lokaler Dev-Server für s2Map
 * Startet mit: node server.js [PORT]
 * Standard: http://localhost:3000
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.argv[2]) || 3000;
const STATIC_DIR = path.join(__dirname, "s2-niantic-map");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css",
  ".js":   "application/javascript",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".csv":  "text/csv",
};

const apiHandlers = {
  "/api/weather":      require("./api/weather"),
  "/api/resolve-link": require("./api/resolve-link"),
};

function serveStatic(urlPath, res) {
  // strip query string
  const clean = urlPath.split("?")[0];
  let filePath = path.join(STATIC_DIR, clean === "/" ? "index.html" : clean);

  // If path has no extension, try index.html
  if (!path.extname(filePath)) {
    filePath = path.join(filePath, "index.html");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found: " + clean);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function parseQuery(search) {
  const params = {};
  if (!search) return params;
  new URLSearchParams(search).forEach((v, k) => { params[k] = v; });
  return params;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;

  // API routes
  const handler = apiHandlers[pathname];
  if (handler) {
    await readBody(req);
    req.query = parseQuery(parsed.search);

    // Wrap res to emulate Vercel's response API
    let statusCode = 200;
    const vercelRes = {
      setHeader: (k, v) => res.setHeader(k, v),
      status(code) { statusCode = code; return this; },
      end(body) {
        res.writeHead(statusCode);
        res.end(body);
      },
      json(obj) {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(statusCode);
        res.end(JSON.stringify(obj));
      },
    };

    try {
      await handler(req, vercelRes);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal_error", message: err.message }));
      }
    }
    return;
  }

  serveStatic(pathname, res);
});

server.listen(PORT, () => {
  console.log(`\n✅ S2 Map läuft lokal unter http://localhost:${PORT}\n`);
  console.log("   Stoppen mit Ctrl+C\n");
});
