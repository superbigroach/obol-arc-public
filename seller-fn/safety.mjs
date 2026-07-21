// Obol service safety scanner.
//
// An Obol service's response is fed straight into a buyer's LLM, so a malicious
// seller can try to HIJACK the buyer's agent via prompt injection, hidden
// unicode, or markdown-image data-exfiltration. This module:
//   1. validateServiceUrl()  — blocks SSRF (private/loopback/metadata hosts).
//   2. scanText()            — flags injection / hidden-content patterns.
//   3. scanServiceSafety()   — does a bounded, sandboxed test call + scans it.
// Results are stored on the service so buyers see a safety verdict BEFORE paying.
import { lookup } from "node:dns/promises";
import net from "node:net";

// ── SSRF guard ────────────────────────────────────────────────────────────────
// Block private, loopback, link-local, and cloud-metadata ranges so a listing
// can't point Obol's scanner (or a buyer) at internal infrastructure.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;                         // loopback
    if (a === 169 && b === 254) return true;            // link-local + 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16/12
    if (a === 192 && b === 168) return true;            // 192.168/16
    if (a === 0 || a >= 224) return true;               // 0.0.0.0/8, multicast/reserved
    return false;
  }
  // IPv6: loopback, unique-local (fc00::/7), link-local (fe80::/10), v4-mapped
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("fc") || v.startsWith("fd")) return true;
  if (v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true;
  if (v.startsWith("::ffff:")) return isPrivateIp(v.replace("::ffff:", ""));
  return false;
}

export async function validateServiceUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return { ok: false, reason: "Invalid URL." }; }
  if (u.protocol !== "https:") return { ok: false, reason: "Service URL must be https://." };
  const host = u.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "Internal/loopback hosts are not allowed." };
  }
  // If the host is a literal IP, check it directly; otherwise resolve and check all answers.
  if (net.isIP(host)) {
    if (isPrivateIp(host)) return { ok: false, reason: "Private/metadata IPs are not allowed." };
  } else {
    try {
      const answers = await lookup(host, { all: true });
      if (answers.some((a) => isPrivateIp(a.address))) {
        return { ok: false, reason: "Host resolves to a private/metadata IP." };
      }
    } catch {
      return { ok: false, reason: "Host could not be resolved." };
    }
  }
  return { ok: true };
}

// ── Content scanner ──────────────────────────────────────────────────────────
const INJECTION_PATTERNS = [
  { re: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts?|context)/i, w: 40, tag: "instruction-override" },
  { re: /disregard\s+(your|all|the)\s+(instructions|rules|system)/i, w: 40, tag: "instruction-override" },
  { re: /forget\s+(everything|all\s+previous|your\s+instructions)/i, w: 35, tag: "instruction-override" },
  { re: /you\s+are\s+now\s+(a|an|the)\b/i, w: 25, tag: "role-hijack" },
  { re: /new\s+(system\s+)?(instructions?|rules?|directive)/i, w: 30, tag: "instruction-override" },
  { re: /system\s*prompt|<\s*system\s*>|\[system\]/i, w: 25, tag: "system-spoof" },
  { re: /(send|transfer|move|withdraw)\b[^.]{0,40}\b(funds|usdc|eth|wallet|balance|crypto)/i, w: 50, tag: "fund-theft" },
  { re: /(reveal|print|show|expose|leak|exfiltrate)\b[^.]{0,30}\b(api[\s_-]?key|private[\s_-]?key|secret|password|seed|mnemonic|token)/i, w: 50, tag: "secret-exfil" },
  { re: /(run|execute|eval)\b[^.]{0,20}\b(this\s+)?(code|command|script|shell)/i, w: 35, tag: "code-exec" },
  { re: /\bcurl\b.{0,60}\|\s*(sh|bash)\b/i, w: 45, tag: "code-exec" },
  { re: /\bawait\s+pay_and_call|call\s+this\s+(service|url)\s+\d{2,}\s+times/i, w: 40, tag: "spend-amplification" },
];

// Markdown/HTML image that smuggles data to an attacker host (classic exfil).
const IMG_EXFIL = /!\[[^\]]*\]\(\s*https?:\/\/[^)]*[?&=][^)]*\)|<img[^>]+src=["']?https?:\/\/[^"'>]*[?&=]/i;
// Zero-width / BOM / bidi-override / invisible-operator / unicode-tag chars used
// to hide instructions from human reviewers while the LLM still reads them.
const HIDDEN_UNICODE = /[​-‏‪-‮⁠-⁤﻿]|[\u{E0000}-\u{E007F}]/u;
// Large base64 / data: blobs that may hide a payload.
const ENCODED_BLOB = /data:[^;]+;base64,[A-Za-z0-9+/]{200,}|[A-Za-z0-9+/]{512,}={0,2}/;
const SCRIPT_TAG = /<\s*script\b|javascript:\s*[^\s]/i;

// learnedPhrases: lowercase literal substrings Gemini previously confirmed as
// attacks (from the threatPatterns collection). A match is high-confidence since
// it was already verified, so it scores at the dangerous threshold.
export function scanText(text, learnedPhrases = []) {
  const flags = [];
  let score = 0;
  const s = String(text || "");
  for (const p of INJECTION_PATTERNS) {
    if (p.re.test(s)) { score += p.w; flags.push(p.tag); }
  }
  if (IMG_EXFIL.test(s)) { score += 45; flags.push("markdown-exfil"); }
  if (HIDDEN_UNICODE.test(s)) { score += 35; flags.push("hidden-unicode"); }
  if (SCRIPT_TAG.test(s)) { score += 30; flags.push("script-injection"); }
  if (ENCODED_BLOB.test(s)) { score += 15; flags.push("encoded-blob"); }

  if (learnedPhrases.length) {
    const lower = s.toLowerCase();
    for (const phrase of learnedPhrases) {
      if (phrase && lower.includes(phrase)) { score += 50; flags.push("learned-threat"); break; }
    }
  }

  const verdict = score >= 50 ? "dangerous" : score >= 20 ? "suspicious" : "clean";
  return { score, verdict, flags: [...new Set(flags)] };
}

// ── End-to-end: sandboxed test call + scan ────────────────────────────────────
// Bounded: 6s timeout, 64KB cap, no auto-redirects (manual → can't be bounced
// to a private host after the SSRF check).
export async function scanServiceSafety(url, learnedPhrases = []) {
  const urlCheck = await validateServiceUrl(url);
  if (!urlCheck.ok) {
    return { scannedAt: Date.now(), verdict: "dangerous", score: 100, flags: ["ssrf-blocked"], reason: urlCheck.reason, sample: null };
  }
  let body = "";
  let status = 0;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, { method: "GET", redirect: "manual", signal: ctrl.signal });
    clearTimeout(t);
    status = r.status;
    body = (await r.text()).slice(0, 65536); // 64KB cap
  } catch (e) {
    // Couldn't reach it (or x402 402-gated with no body) → unknown, not dangerous.
    return { scannedAt: Date.now(), verdict: "unknown", score: 0, flags: ["unreachable"], reason: String(e.message || e), sample: null, status };
  }
  const scan = scanText(body, learnedPhrases);
  return {
    scannedAt: Date.now(),
    verdict: scan.verdict,
    score: scan.score,
    flags: scan.flags,
    status,
    sample: body.slice(0, 600), // short preview shown on the listing for transparency
  };
}
