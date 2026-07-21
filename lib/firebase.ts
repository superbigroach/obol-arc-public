// Firebase client init. Config comes from NEXT_PUBLIC_FIREBASE_* env vars
// (see .env.local.example). Safe to expose — these are public client keys.
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getFunctions, type Functions } from "firebase/functions";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID, // GA4 — enable in Firebase console
};

// Avoid re-initializing during Next.js hot reload / multiple imports.
const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth: Auth = getAuth(app);
export const fdb: Firestore = getFirestore(app);
export const storage: FirebaseStorage = getStorage(app);
export const functions: Functions = getFunctions(app, "us-central1");
export const googleProvider = new GoogleAuthProvider();

// ── Analytics (GA4) — browser-only, activates when NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
// is set. GA4 auto-tracks page_views, sessions, and engagement time (where users spend
// time). Use track() for custom events (button clicks, ACK opens, etc.).
// To enable: Firebase console → Project settings → Integrations → Google Analytics →
// copy the G-XXXX measurement id into NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID.
let _analytics: import("firebase/analytics").Analytics | null = null;
if (typeof window !== "undefined" && firebaseConfig.measurementId) {
  import("firebase/analytics").then(({ getAnalytics, isSupported }) =>
    isSupported().then((ok) => { if (ok) _analytics = getAnalytics(app); }),
  ).catch(() => {});
}

/** Log a custom analytics event (no-op until a GA4 measurementId is configured). */
export function track(event: string, params?: Record<string, unknown>) {
  if (!_analytics) return;
  import("firebase/analytics").then(({ logEvent }) => logEvent(_analytics!, event, params)).catch(() => {});
}
googleProvider.setCustomParameters({ prompt: "select_account" });

// App Check (abuse protection). Only runs in the browser, and only if a
// reCAPTCHA v3 site key is provided — it stays a no-op until then, so it
// never crashes builds or local dev where the key is absent.
if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_RECAPTCHA_KEY) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(process.env.NEXT_PUBLIC_RECAPTCHA_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch {
    // Non-fatal: App Check is optional until enforcement is enabled.
  }
}

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
