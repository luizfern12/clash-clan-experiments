import cors from "cors";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROXY_BASE = "https://proxy.royaleapi.dev/v1";
const USER_AGENT = "clash-royale-webapp/0.1";
const ROLE_NOME = { leader: "líder", coLeader: "co-líder", elder: "ancião", member: "membro" };

let token = null;
function getToken() {
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

async function apiGet(apiPath) {
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

const normalizeTag = (t) => (t || "").trim().toUpperCase().replace(/^#/, "");
const encodeTag = (t) => "%23" + normalizeTag(t);

function analyze(clan, log) {
  const races = [...(log.items || [])]
    .sort((a, b) => (b.createdDate || "").localeCompare(a.createdDate || ""))
    .slice(0, 8);

  const famePorGuerra = new Map();
  for (const m of clan.memberList) famePorGuerra.set(normalizeTag(m.tag), []);

  const myTag = normalizeTag(clan.tag);
  for (const guerra of races) {
    const nosso = (guerra.standings || []).find(
      (s) => normalizeTag(s.clan?.tag) === myTag,
    );
    if (!nosso) continue;
    const porParticipante = new Map(
      (nosso.clan?.participants || []).map((p) => [normalizeTag(p.tag), p.fame || 0]),
    );
    for (const tag of famePorGuerra.keys()) {
      famePorGuerra.get(tag).push(porParticipante.get(tag) || 0);
    }
  }

  const members = [...clan.memberList]
    .sort((a, b) => (a.clanRank || 0) - (b.clanRank || 0))
    .map((m) => {
      const fame = famePorGuerra.get(normalizeTag(m.tag)) || [];
      const media4 = fame.length >= 4 ? fame.slice(0, 4).reduce((a, b) => a + b, 0) / 4 : null;
      const media8 = fame.length >= 8 ? fame.reduce((a, b) => a + b, 0) / 8 : null;
      const part4 = fame.length >= 4 ? 4 - fame.slice(0, 4).filter((v) => v === 0).length : null;
      const part8 = fame.length >= 8 ? 8 - fame.filter((v) => v === 0).length : null;

      let promotion = null;
      if (m.role === "member" && media4 !== null && media4 > 2500) {
        promotion = {
          label: "PROMOVER A ANCIÃO",
          reason: `média 4 = ${Math.round(media4)} > 2500`,
        };
      } else if (m.role === "elder" && media8 !== null && media8 > 2500) {
        promotion = {
          label: "PROMOVER A CO-LÍDER",
          reason: `média 8 = ${Math.round(media8)} > 2500`,
        };
      }

      return {
        tag: m.tag,
        name: m.name,
        role: m.role,
        roleLabel: ROLE_NOME[m.role] || m.role,
        media4: media4 === null ? null : Math.round(media4),
        media8: media8 === null ? null : Math.round(media8),
        part4,
        part8,
        promotion,
      };
    });

  return {
    clan: { tag: clan.tag, name: clan.name },
    racesAnalyzed: races.length,
    members,
    warnings: members.filter((m) => m.promotion),
  };
}

function analyzeWarAttacks(current, log) {
  const clanInfo = current.clan || {};
  const ourTag = normalizeTag(clanInfo.tag);
  let ourClan = clanInfo;
  if (!ourClan.participants) {
    ourClan = (current.clans || []).find((c) => normalizeTag(c.tag) === ourTag) || clanInfo;
  }
  const participants = ourClan?.participants || [];
  const sum = (key) => participants.reduce((a, p) => a + (p[key] || 0), 0);

  const races = [...(log.items || [])]
    .sort((a, b) => (b.createdDate || "").localeCompare(a.createdDate || ""))
    .slice(0, 7)
    .reverse();

  const weeks = races.map((r) => {
    const nosso = (r.standings || []).find((s) => normalizeTag(s.clan?.tag) === ourTag);
    const attacks = (nosso?.clan?.participants || []).reduce((a, p) => a + (p.decksUsed || 0), 0);
    return {
      label: (r.createdDate || "").replace(/^(\d{4})(\d{2})(\d{2}).*/, "$1-$2-$3"),
      attacks,
    };
  });

  weeks.push({
    label: "Semana atual",
    attacks: sum("decksUsed"),
    attacksToday: sum("decksUsedToday"),
    current: true,
  });

  return {
    clan: { tag: clanInfo.tag, name: clanInfo.name },
    players: participants.length,
    weeks,
  };
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/api/clan/:tag", async (req, res) => {
  const tag = encodeTag(req.params.tag);
  try {
    const [clan, log] = await Promise.all([
      apiGet(`/clans/${tag}`),
      apiGet(`/clans/${tag}/riverracelog`),
    ]);
    res.json(analyze(clan, log));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get("/api/clan/:tag/war-attacks", async (req, res) => {
  const tag = encodeTag(req.params.tag);
  try {
    const [current, log] = await Promise.all([
      apiGet(`/clans/${tag}/currentriverrace`),
      apiGet(`/clans/${tag}/riverracelog`),
    ]);
    res.json(analyzeWarAttacks(current, log));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
