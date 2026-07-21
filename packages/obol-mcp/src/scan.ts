// Lightweight client-side response scanner for the MCP. Mirrors the server's
// safety heuristics so the agent can detect a malicious/hijacking response at
// RUNTIME (zero extra network cost — it already has the response) and auto-report
// it to Obol. This is the cheapest, highest-coverage layer: every real response
// an agent receives gets checked, catching bait-and-switch the listing scan can't.
const INJECTION_PATTERNS: Array<{ re: RegExp; w: number; tag: string }> = [
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
];
const IMG_EXFIL = /!\[[^\]]*\]\(\s*https?:\/\/[^)]*[?&=][^)]*\)|<img[^>]+src=["']?https?:\/\/[^"'>]*[?&=]/i;
const HIDDEN_UNICODE = /[​-‏‪-‮⁠-⁤﻿]|[\u{E0000}-\u{E007F}]/u;
const SCRIPT_TAG = /<\s*script\b|javascript:\s*\S/i;

export function scanResponse(value: unknown): { verdict: "clean" | "suspicious" | "dangerous"; score: number; flags: string[] } {
  const s = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const flags: string[] = [];
  let score = 0;
  for (const p of INJECTION_PATTERNS) if (p.re.test(s)) { score += p.w; flags.push(p.tag); }
  if (IMG_EXFIL.test(s)) { score += 45; flags.push("markdown-exfil"); }
  if (HIDDEN_UNICODE.test(s)) { score += 35; flags.push("hidden-unicode"); }
  if (SCRIPT_TAG.test(s)) { score += 30; flags.push("script-injection"); }
  const verdict = score >= 50 ? "dangerous" : score >= 20 ? "suspicious" : "clean";
  return { verdict, score, flags: [...new Set(flags)] };
}
