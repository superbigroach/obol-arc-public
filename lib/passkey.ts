// Obol — client-side passkey (WebAuthn) helpers for withdrawal gating. SECURITY P0.
//
// Withdrawals move funds OUT, so we require a signature from the user's DEVICE
// (Touch ID / Windows Hello / security key), not just a valid session. These
// helpers drive the browser WebAuthn ceremonies and talk to the passkey Cloud
// Functions (registerPasskey / getPasskeyRegisterOptions / getWithdrawChallenge /
// getPasskeyStatus). Pair getWithdrawPasskeyAuth() with withdrawObolWallet.
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import {
  startRegistration,
  startAuthentication,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

/** True if the signed-in user has already registered a passkey. */
export async function isPasskeyRegistered(): Promise<boolean> {
  const fn = httpsCallable<Record<string, never>, { registered: boolean }>(functions, "getPasskeyStatus");
  const res = await fn({});
  return !!res.data?.registered;
}

/** Register a device passkey: fetch options → OS prompt → store the credential. */
export async function setupPasskey(): Promise<void> {
  const origin = window.location.origin;
  const optsFn = httpsCallable<{ origin: string }, { options: PublicKeyCredentialCreationOptionsJSON }>(
    functions, "getPasskeyRegisterOptions",
  );
  const { data } = await optsFn({ origin });
  const attestationResponse = await startRegistration({ optionsJSON: data.options });
  const regFn = httpsCallable(functions, "registerPasskey");
  await regFn({ origin, attestationResponse });
}

/**
 * Produce the passkey assertion a withdrawal must carry. Returns null if the user
 * has no passkey registered (the backend then allows the withdraw for backward
 * compatibility but flags setup as required). Spread the result into the
 * withdrawObolWallet payload.
 */
export async function getWithdrawPasskeyAuth(): Promise<
  { passkeyAssertion: unknown; passkeyChallenge: string } | null
> {
  if (!(await isPasskeyRegistered())) return null;
  const origin = window.location.origin;
  const chFn = httpsCallable<{ origin: string }, { options: PublicKeyCredentialRequestOptionsJSON; challenge: string }>(
    functions, "getWithdrawChallenge",
  );
  const { data } = await chFn({ origin });
  const passkeyAssertion = await startAuthentication({ optionsJSON: data.options });
  return { passkeyAssertion, passkeyChallenge: data.challenge };
}
