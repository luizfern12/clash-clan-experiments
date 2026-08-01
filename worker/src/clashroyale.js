import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROXY_BASE = "https://proxy.royaleapi.dev/v1";
export const USER_AGENT = "clash-royale-worker/0.1";

let token = null;
export function getToken() {
  if (token) return token;
  if (process.env.ROYALE_API_TOKEN) {
    token = process.env.ROYALE_API_TOKEN.trim();
    return token;
  }
  const agentsPath = path.join(__dirname, "..", "..", "AGENTS.md");
  const match = fs.readFileSync(agentsPath, "utf8").match(/^Token: (\S+)/m);
  if (!match) {
    throw new Error("Token não encontrado: defina ROYALE_API_TOKEN ou a linha Token no AGENTS.md");
  }
  token = match[1];
  return token;
}

export async function apiGet(apiPath) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${PROXY_BASE}${apiPath}`, {
      headers: { Authorization: `Bearer ${getToken()}`, "User-Agent": USER_AGENT },
    });
    if (res.ok) return res.json();
    if (attempt < 3 && res.status >= 500) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
      continue;
    }
    const body = await res.text();
    const err = new Error(`Erro HTTP ${res.status} em ${apiPath}: ${body}`);
    err.status = res.status;
    throw err;
  }
}

export const normalizeTag = (t) => (t || "").trim().toUpperCase().replace(/^#/, "");
export const encodeTag = (t) => "%23" + normalizeTag(t);
