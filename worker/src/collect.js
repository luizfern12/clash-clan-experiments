import { apiGet, encodeTag, normalizeTag } from "./clashroyale.js";
import { analyzeRaces, buildWarAttacks } from "./analyze.js";
import { db } from "./firebase.js";

const COLLECTION = "clans";
const RETENTION_DAYS = 35; // 5 semanas
const RACES_MAX = 12;

function utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function ourClanParticipants(current, clanId) {
  if (current.clan?.participants?.length) return current.clan.participants;
  const found = (current.clans || []).find((c) => normalizeTag(c.tag) === clanId);
  return found?.participants || [];
}

function currentSeason(logItems, sectionIndex) {
  const items = [...(logItems || [])].sort((a, b) =>
    (b.createdDate || "").localeCompare(a.createdDate || ""),
  );
  const first = items[0];
  if (!first || typeof first.seasonId !== "number") return null;
  return (first.sectionIndex ?? 0) >= sectionIndex ? first.seasonId + 1 : first.seasonId;
}

// Rótulo da guerra no jogo: "{season}/{dia}" (ex.: 134/3). Dia derivado do
// periodIndex: cada guerra ocupa os períodos {section}*7+3 .. +6.
function warLabel(logItems, current) {
  if (current.sectionIndex == null || current.periodIndex == null) return null;
  const season = currentSeason(logItems, current.sectionIndex);
  const day = current.periodIndex - current.sectionIndex * 7 - 2;
  return season == null ? null : `${season}/${day}`;
}

// Clãs fora de uma guerra atual retornam 404 em currentriverrace.
async function currentRaceOrEmpty(path) {
  try {
    return await apiGet(path);
  } catch (err) {
    if (err.status === 404) return {};
    throw err;
  }
}

async function collectClan(firestore, clanId) {
  const tag = encodeTag(clanId);
  const [clan, current, log] = await Promise.all([
    apiGet(`/clans/${tag}`),
    currentRaceOrEmpty(`/clans/${tag}/currentriverrace`),
    apiGet(`/clans/${tag}/riverracelog`),
  ]);

  const today = utcDate();
  const label = warLabel(log.items, current);
  const reportRef = firestore.doc(`${COLLECTION}/${clanId}/report/latest`);
  const reportSnap = await reportRef.get();
  const report = reportSnap.exists ? reportSnap.data() : null;

  const participants = ourClanParticipants(current, clanId);

  // --- snapshot bruto do dia (fonte da verdade p/ tabela diária) ---
  const dailyRef = firestore.doc(`${COLLECTION}/${clanId}/daily/${today}`);
  const dailySnap = await dailyRef.get();
  const prevDaily = dailySnap.exists ? dailySnap.data() : null;
  const playersMap = new Map((prevDaily?.players || []).map((p) => [normalizeTag(p.tag), p]));
  for (const p of participants) {
    const key = normalizeTag(p.tag);
    const prev = playersMap.get(key);
    playersMap.set(key, {
      tag: p.tag,
      name: p.name || prev?.name || "",
      decksUsed: p.decksUsed ?? prev?.decksUsed ?? 0,
      decksUsedToday: Math.max(prev?.decksUsedToday || 0, p.decksUsedToday || 0),
    });
  }
  await dailyRef.set(
    {
      date: today,
      label,
      raceId: String(current.periodIndex ?? ""),
      players: [...playersMap.values()],
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  // --- cache de races (guerras concluídas) ---
  const logItems = [...(log.items || [])].sort((a, b) =>
    (b.createdDate || "").localeCompare(a.createdDate || ""),
  );
  let races = report?.data?.races || [];
  const lastCached = races.length ? races[0].createdDate : "";
  for (const r of logItems) {
    if (r.createdDate <= lastCached) continue;
    const nosso = (r.standings || []).find((s) => normalizeTag(s.clan?.tag) === clanId);
    if (nosso) {
      races.unshift({
        createdDate: r.createdDate,
        seasonId: r.seasonId,
        sectionIndex: r.sectionIndex,
        players: (nosso.clan?.participants || []).map((p) => ({
          tag: p.tag,
          name: p.name,
          fame: p.fame || 0,
          decksUsed: p.decksUsed || 0,
        })),
      });
    }
  }
  races = races.slice(0, RACES_MAX);

  const members = (clan.memberList || []).map((m) => ({
    tag: m.tag,
    name: m.name,
    role: m.role,
    clanRank: m.clanRank,
  }));

  // --- matriz diária (últimas 5 semanas) ---
  const cutoff = utcDate(new Date(Date.now() - RETENTION_DAYS * 86400000));
  let daily = report?.data?.daily || { dates: [], players: {}, labels: {} };
  daily.dates = (daily.dates || []).filter((d) => d >= cutoff);
  daily.labels = Object.fromEntries(
    Object.entries(daily.labels || {}).filter(([d]) => d >= cutoff),
  );
  if (label) daily.labels[today] = label;
  for (const tag of Object.keys(daily.players)) {
    const cur = daily.players[tag];
    cur.days = Object.fromEntries(Object.entries(cur.days || {}).filter(([d]) => d >= cutoff));
  }
  if (!daily.dates.includes(today)) daily.dates.push(today);
  daily.dates.sort();
  for (const p of participants) {
    const key = normalizeTag(p.tag);
    const cur = daily.players[key] || { name: p.name || "", days: {} };
    if (p.name) cur.name = p.name;
    cur.days[today] = Math.max(cur.days[today] || 0, p.decksUsedToday || 0);
    daily.players[key] = cur;
  }
  const roleByTag = new Map(members.map((m) => [normalizeTag(m.tag), m.role]));
  for (const key of Object.keys(daily.players)) {
    if (roleByTag.has(key)) daily.players[key].role = roleByTag.get(key);
  }

  // --- poda de docs diários antigos (1x por dia) ---
  let lastPruneDate = report?.meta?.lastPruneDate;
  if (lastPruneDate !== today) {
    const old = await firestore.collection(`${COLLECTION}/${clanId}/daily`).get();
    const deletes = old.docs
      .filter((d) => d.id < cutoff)
      .map((d) => d.ref.delete());
    await Promise.all(deletes);
    lastPruneDate = today;
  }

  // --- relatório pré-computado p/ o front ---
  const promotion = analyzeRaces(members, races);
  const warAttacks = buildWarAttacks(participants, races, daily);

  await reportRef.set({
    updatedAt: new Date().toISOString(),
    clan: { tag: clan.tag, name: clan.name, badgeId: clan.badgeId },
    promotion,
    warAttacks,
    data: { members, races, daily },
    meta: { lastPruneDate },
  });

  console.log(
    `[${clanId}] ${clan.name}: ${members.length} membros, ${races.length} guerras, ` +
      `${daily.dates.length} dias rastreados, ${warAttacks.weeks.length} semanas`,
  );
}

async function main() {
  const firestore = db();
  const clans = await firestore.collection(COLLECTION).where("enabled", "==", true).get();
  if (clans.empty) {
    console.log("Nenhum clã habilitado no tracking.");
    return;
  }
  for (const doc of clans.docs) {
    try {
      await collectClan(firestore, doc.id);
    } catch (err) {
      console.error(`[${doc.id}] falha: ${err.message}`);
    }
  }
  console.log("Coleta concluída.");
}

main().catch((err) => {
  console.error("Falha na coleta:", err);
  process.exit(1);
});
