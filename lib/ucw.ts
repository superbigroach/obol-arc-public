"use client";

import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";

let _sdk: W3SSdk | null = null;
let _deviceReady = false;

export async function getUCWSdk(): Promise<W3SSdk> {
  if (_sdk) return _sdk;
  // Dynamic import keeps this out of the SSR/static bundle
  const mod = await import("@circle-fin/w3s-pw-web-sdk");
  // Handle both named and default exports
  const Sdk: typeof W3SSdk =
    (mod as unknown as { W3SSdk: typeof W3SSdk }).W3SSdk ??
    (mod as unknown as { default: typeof W3SSdk }).default;
  const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID;
  if (!appId) throw new Error("CIRCLE_APP_ID not configured.");
  _sdk = new Sdk({ appSettings: { appId } });
  if (!_deviceReady) {
    await _sdk.getDeviceId();
    _deviceReady = true;
  }
  return _sdk;
}

export async function executeChallenge(
  userToken: string,
  encryptionKey: string,
  challengeId: string
): Promise<void> {
  const sdk = await getUCWSdk();
  sdk.setAuthentication({ userToken, encryptionKey });
  return new Promise((resolve, reject) => {
    sdk.execute(challengeId, (error) => {
      if (error) {
        reject(new Error((error as Error).message ?? "Challenge failed"));
        return;
      }
      resolve();
    });
  });
}
