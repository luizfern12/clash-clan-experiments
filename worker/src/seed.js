import { FieldValue } from "firebase-admin/firestore";
import { apiGet, encodeTag, normalizeTag } from "./clashroyale.js";
import { db } from "./firebase.js";

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Uso: node src/seed.js #TAG [--disable]');
    process.exit(1);
  }
  const disable = process.argv.includes("--disable");
  const tag = encodeTag(arg);
  const clan = await apiGet(`/clans/${tag}`);
  const id = normalizeTag(tag);

  await db()
    .doc(`clans/${id}`)
    .set(
      {
        name: clan.name,
        badgeId: clan.badgeId || null,
        enabled: !disable,
        addedAt: disable ? undefined : FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  console.log(`${disable ? "Desabilitado" : "Habilitado"} ${clan.name} (${clan.tag})`);
}

main().catch((err) => {
  console.error("Falha no seed:", err.message);
  process.exit(1);
});
