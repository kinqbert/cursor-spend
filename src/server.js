import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { loadEnv } from "./env.js";
import { fetchPersonalSpend, SpendError } from "./spend.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const env = loadEnv();
const publicDir = join(env.root, "public");

async function handleStatic(urlPath) {
  const relative = urlPath === "/" ? "index.html" : urlPath.slice(1);
  if (relative.includes("..") || relative.startsWith("/")) return null;
  const file = join(publicDir, relative);
  try {
    return {
      body: await readFile(file),
      type: MIME[extname(file)] ?? "application/octet-stream",
    };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/spend") {
      const body = JSON.stringify(await fetchPersonalSpend());
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }

    if (req.method === "GET") {
      const file = await handleStatic(url.pathname);
      if (file) {
        res.writeHead(200, { "Content-Type": file.type });
        res.end(file.body);
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (error) {
    const status = error instanceof SpendError ? error.status : 500;
    const message = error instanceof SpendError ? error.message : "Internal error";
    console.error(error);
    res.writeHead(status >= 400 && status < 600 ? status : 500, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify({ error: message }));
  }
});

server.listen(env.port, "127.0.0.1", () => {
  console.log(`Cursor spend → http://127.0.0.1:${env.port}`);
});
