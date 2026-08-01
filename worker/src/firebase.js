import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export function db() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    initializeApp(
      raw
        ? { credential: cert(JSON.parse(Buffer.from(raw, "base64").toString("utf8"))) }
        : {},
    );
  }
  return getFirestore();
}
