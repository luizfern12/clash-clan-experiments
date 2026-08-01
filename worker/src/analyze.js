import { normalizeTag } from "./clashroyale.js";

export const ROLE_NOME = {
  leader: "líder",
  coLeader: "co-líder",
  elder: "ancião",
  member: "membro",
};

export function analyzeRaces(members, races) {
  // races: [{ createdDate, players: [{ tag, name, fame }] }] (novas primeiro)
  const famePorGuerra = new Map();
  for (const m of members) famePorGuerra.set(normalizeTag(m.tag), []);

  const races8 = races.slice(0, 8);
  for (const r of races8) {
    const por = new Map(r.players.map((p) => [normalizeTag(p.tag), p.fame || 0]));
    for (const tag of famePorGuerra.keys()) {
      famePorGuerra.get(tag).push(por.get(tag) || 0);
    }
  }

  const out = [...members]
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

  return { racesAnalyzed: races8.length, members: out, warnings: out.filter((m) => m.promotion) };
}

export function buildWarAttacks(participants, races, daily) {
  // participants: our clan current river race participants
  // races: [{ createdDate, players: [{ tag, name, decksUsed }] }]
  // daily: { dates, players: { tag: { name, days } } }
  const weekRaces = races.slice(0, 7).reverse();
  const weeks = weekRaces.map((r) => ({
    label: (r.createdDate || "").replace(/^(\d{4})(\d{2})(\d{2}).*/, "$1-$2-$3"),
    attacks: r.players.reduce((a, p) => a + (p.decksUsed || 0), 0),
  }));
  weeks.push({
    label: "Semana atual",
    attacks: participants.reduce((a, p) => a + (p.decksUsed || 0), 0),
    attacksToday: participants.reduce((a, p) => a + (p.decksUsedToday || 0), 0),
    current: true,
  });

  return {
    players: participants.length,
    weeks,
    daily,
  };
}
