"use client";

// Firebase Auth provider linking for verified socials.
//
// We *link* the OAuth provider onto the already-signed-in user (rather than a
// fresh sign-in) so the connected GitHub / X account becomes a verified
// identity attached to the same Obol uid. The returned handle is the
// provider's screen name, which we persist on the profile's `socials`.
//
// NOTE: provider response shapes here are only loosely typed by the SDK, so we
// read the screen name defensively from a few known locations.

import {
  GithubAuthProvider,
  OAuthProvider,
  TwitterAuthProvider,
  linkWithPopup,
  type UserCredential,
  type User,
} from "firebase/auth";

/** Friendly errors for the common link failures. Returns null if not one we rewrite. */
function friendlyLinkError(err: unknown): Error | null {
  const code = (err as { code?: string } | null)?.code;
  if (code === "auth/credential-already-in-use") {
    return new Error("That account is already linked to a different Obol profile.");
  }
  if (code === "auth/provider-already-linked") {
    return new Error("This account is already connected. Disconnect it first to re-link.");
  }
  if (code === "auth/operation-not-allowed") {
    return new Error(
      "This sign-in provider isn't enabled yet. Enable it in the Firebase console (Authentication → Sign-in method).",
    );
  }
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return new Error("Connection cancelled.");
  }
  if (code === "auth/popup-blocked") {
    return new Error("Popup was blocked by the browser. Allow popups and try again.");
  }
  return null;
}

/** Pull the provider screen name out of a linkWithPopup result, defensively. */
function extractHandle(res: UserCredential, providerId: string): string {
  const anyRes = res as any;

  // 1) The richest source: the raw token response (GitHub/Twitter put screenName here).
  const fromToken: string | undefined =
    anyRes?._tokenResponse?.screenName ?? anyRes?._tokenResponse?.screen_name;
  if (fromToken && String(fromToken).trim()) return String(fromToken).trim();

  // 2) reloadUserInfo on the user (also carries screenName for these providers).
  const fromReload: string | undefined = (res.user as any)?.reloadUserInfo?.screenName;
  if (fromReload && String(fromReload).trim()) return String(fromReload).trim();

  // 3) providerData entry for this provider → displayName, then email prefix.
  const pd = res.user?.providerData?.find((p) => p?.providerId === providerId);
  if (pd?.displayName && pd.displayName.trim()) return pd.displayName.trim();
  if (pd?.email && pd.email.includes("@")) return pd.email.split("@")[0];

  // 4) Last resort: top-level user fields.
  if (res.user?.displayName && res.user.displayName.trim()) return res.user.displayName.trim();
  if (res.user?.email && res.user.email.includes("@")) return res.user.email.split("@")[0];

  return "connected";
}

/** Link the user's GitHub account via OAuth popup. Returns the GitHub handle. */
export async function connectGithub(user: User): Promise<{ handle: string }> {
  try {
    const provider = new GithubAuthProvider();
    provider.addScope("read:user");
    const res = await linkWithPopup(user, provider);
    return { handle: extractHandle(res, "github.com") };
  } catch (err) {
    throw friendlyLinkError(err) ?? (err instanceof Error ? err : new Error("Failed to connect GitHub"));
  }
}

/** Link the user's X (Twitter) account via OAuth popup. Returns the X handle. */
export async function connectX(user: User): Promise<{ handle: string }> {
  try {
    const provider = new TwitterAuthProvider();
    const res = await linkWithPopup(user, provider);
    return { handle: extractHandle(res, "twitter.com") };
  } catch (err) {
    throw friendlyLinkError(err) ?? (err instanceof Error ? err : new Error("Failed to connect X"));
  }
}

/**
 * Link the user's LinkedIn account via OAuth popup. Returns the LinkedIn handle.
 * Requires LinkedIn to be added as a custom OAuth provider in the Firebase console
 * (Authentication → Sign-in method → Add new provider → LinkedIn).
 * LinkedIn App: Client ID + Secret from linkedin.com/developers.
 * Callback: https://obol-arc.firebaseapp.com/__/auth/handler
 */
export async function connectLinkedIn(user: User): Promise<{ handle: string }> {
  try {
    const provider = new OAuthProvider("linkedin.com");
    provider.addScope("profile");
    provider.addScope("email");
    const res = await linkWithPopup(user, provider);
    return { handle: extractHandle(res, "linkedin.com") };
  } catch (err) {
    throw friendlyLinkError(err) ?? (err instanceof Error ? err : new Error("Failed to connect LinkedIn"));
  }
}
