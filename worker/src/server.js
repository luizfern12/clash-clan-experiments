import http from "node:http";
import { db } from "./firebase.js";
import { collectAll } from "./collect.js";

const PORT = Number(process.env.PORT) || 8080;
let running = false;

// Dispara a coleta em background (fire-and-forget). Retorna true se iniciou,
// false se já havia uma coleta em andamento (evita sobreposição).
function startCollect() {
  if (running) return false;
  running = true;
  const firestore = db();
  collectAll(firestore)
    .then((results) => {
      const failed = results.filter((r) => !r.ok).length;
      console.log(`[collect] ok=${results.length - failed} falhas=${failed}`);
    })
    .catch((err) => console.error("[collect] erro:", err.message))
    .finally(() => {
      running = false;
    });
  return true;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "POST" && url.pathname === "/collect") {
    const started = startCollect();
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: started ? "started" : "already_running" }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, running }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`Coletor HTTP em :${PORT} (GET /health, POST /collect)`);
});
