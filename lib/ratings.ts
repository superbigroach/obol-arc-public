// Client-side ratings + disputes layer (Firestore Web SDK). Gated by
// firestore.rules — public read, owner-only write keyed by `${serviceId}_${uid}`
// so each user has exactly one rating per service (setDoc/merge overwrites).
"use client";

import { collection, query, where, getDocs, doc, setDoc, getDoc, limit } from "firebase/firestore";
import { fdb } from "./firebase";

export type Rating = {
  serviceId: string;
  uid: string;
  stars: number;       // 1–5
  comment: string;
  dispute: boolean;
  ts: number;
};

export type RatingSummary = {
  avg: number;
  count: number;
  disputes: number;
  recent: Rating[];
};

/** Upsert the caller's own rating for a service. Doc id = `${serviceId}_${uid}`. */
export async function rateService(
  uid: string,
  serviceId: string,
  stars: number,
  comment: string,
  dispute: boolean,
): Promise<void> {
  try {
    const clamped = Math.max(1, Math.min(5, Math.round(stars)));
    const data: Rating = {
      serviceId,
      uid,
      stars: clamped,
      comment: (comment || "").trim(),
      dispute: !!dispute,
      ts: Date.now(),
    };
    await setDoc(doc(fdb, "ratings", `${serviceId}_${uid}`), data, { merge: true });
  } catch (e) {
    console.error("[obol:ratings] rate failed", e);
    throw e instanceof Error ? e : new Error("Failed to submit rating");
  }
}

/** Fetch the current user's own rating for a service, or null if none. */
export async function getUserRating(serviceId: string, uid: string): Promise<Rating | null> {
  try {
    const snap = await getDoc(doc(fdb, "ratings", `${serviceId}_${uid}`));
    return snap.exists() ? (snap.data() as Rating) : null;
  } catch {
    return null;
  }
}

/** Aggregate ratings for a service: average stars, count, # disputes, recent. */
export async function getServiceRatings(serviceId: string): Promise<RatingSummary> {
  try {
    const snap = await getDocs(
      query(collection(fdb, "ratings"), where("serviceId", "==", serviceId), limit(100)),
    );
    const rows = snap.docs.map((d) => d.data() as Rating);
    const count = rows.length;
    const disputes = rows.filter((r) => r.dispute).length;
    const avg = count ? rows.reduce((sum, r) => sum + (r.stars || 0), 0) / count : 0;
    const recent = [...rows].sort((a, b) => b.ts - a.ts).slice(0, 5);
    return { avg, count, disputes, recent };
  } catch (e) {
    console.error("[obol:ratings] getServiceRatings failed", e);
    return { avg: 0, count: 0, disputes: 0, recent: [] };
  }
}
