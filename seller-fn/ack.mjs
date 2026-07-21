// ACK-ID — Catena Labs' Agent Commerce Kit (open W3C DID + Verifiable Credentials).
// Obol acts as a credential issuer: each verified seller's payout wallet becomes a
// did:pkh identity, and Obol issues a signed "ObolVerifiedSeller" Verifiable
// Credential (a JWT) asserting they control that wallet. The credential is portable
// and verifiable by anyone against Obol's issuer DID — no trust in Obol's database.
import {
  generateKeypair,
  createDidKeyUri,
  createDidPkhUri,
  createJwtSigner,
  createCredential,
  signCredential,
} from "agentcommercekit";

const ARC_CAIP2 = "eip155:5042002"; // Arc testnet

// Obol's issuer identity. Keypair is provisioned once and stored as a secret
// (OBOL_ISSUER_KEYPAIR json + OBOL_ISSUER_DID). Never regenerate in prod or old
// credentials stop verifying.
function loadIssuer() {
  const raw = process.env.OBOL_ISSUER_KEYPAIR;
  const did = process.env.OBOL_ISSUER_DID;
  if (!raw || !did) throw new Error("OBOL_ISSUER_KEYPAIR / OBOL_ISSUER_DID not configured.");
  const j = JSON.parse(raw); // { curve, privateKey(hex), publicKey(hex) }
  // The signer needs raw key bytes, not hex strings.
  const keypair = {
    curve: j.curve,
    privateKey: new Uint8Array(Buffer.from(j.privateKey, "hex")),
    publicKey: new Uint8Array(Buffer.from(j.publicKey, "hex")),
  };
  return { keypair, did };
}

/** The Obol issuer DID (did:key) — publish this so anyone can verify our credentials. */
export function obolIssuerDid() {
  return process.env.OBOL_ISSUER_DID || null;
}

/**
 * Issue a signed "Obol Verified Seller" credential for a seller's payout wallet.
 * Returns the seller's did:pkh, the signed credential JWT, and the issuer DID.
 */
export async function issueSellerCredential({ payoutAddress, displayName, serviceName, category, memberSince }) {
  const { keypair, did: issuerDid } = loadIssuer();
  const sellerDid = createDidPkhUri(ARC_CAIP2, payoutAddress);
  const signer = createJwtSigner(keypair);

  // PII GUARD: this credential is PUBLIC (buyers open it via the verified badge).
  // Embed ONLY stable, non-sensitive identity attributes. NEVER put email, phone,
  // private keys, raw transactions, or any personal data here. Live reputation
  // (rating, calls served) is served fresh by the /api/ack viewer instead of being
  // signed in — so it never goes stale and stays out of the immutable credential.
  const credential = createCredential({
    id: `urn:obol:seller:${payoutAddress.toLowerCase()}:${Date.now()}`,
    type: "ObolVerifiedSeller",
    issuer: issuerDid,
    subject: sellerDid,
    attestation: {
      verifiedSeller: true,
      payoutAddress,                       // public wallet — safe
      displayName: displayName || null,    // business/display name — safe
      service: serviceName || null,
      category: category || null,          // service category — safe
      memberSince: memberSince || null,    // ISO date the seller joined — safe
      network: "Arc testnet",
      platform: "Obol",
    },
  });

  const jwt = await signCredential(credential, { did: issuerDid, signer, alg: "ES256K" });
  return { sellerDid, credentialJwt: jwt, issuerDid };
}

// Re-export for one-time issuer provisioning scripts.
export { generateKeypair, createDidKeyUri };
