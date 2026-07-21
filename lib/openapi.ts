// OpenAPI → endpoint list parser.
//
// Turns an uploaded/linked OpenAPI (Swagger) spec into the marketplace's
// `ServiceEndpoint[]` shape so a service can advertise every path + method it
// serves with a per-call price. JSON specs are parsed natively; YAML is handled
// best-effort (we attempt a tiny structural parse, otherwise we surface a clear
// error). Everything is defensive: any failure returns [] rather than throwing
// at the call site of `parseOpenApiToEndpoints`.
//
// No external dependencies — only the platform `fetch` + a minimal YAML reader.

import type { ServiceEndpoint } from "./clientStore";

/** Default per-call price assigned to each discovered endpoint. */
const DEFAULT_PRICE = "0.001";

/** HTTP methods we treat as callable operations in an OpenAPI `paths` object. */
const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];

type AnyRecord = Record<string, unknown>;

/**
 * Fetch an OpenAPI/Swagger spec from `url`, parse it (JSON or best-effort YAML),
 * and return one endpoint per path+method. Never throws — returns [] on any
 * failure so callers can render "no endpoints" gracefully.
 */
export async function parseOpenApiToEndpoints(url: string): Promise<ServiceEndpoint[]> {
  if (!url || !/^https?:\/\//i.test(url)) return [];
  try {
    const res = await fetch(url, { headers: { accept: "application/json, text/yaml, */*" } });
    if (!res.ok) return [];
    const text = await res.text();
    const spec = parseSpecText(text);
    if (!spec) return [];
    return specToEndpoints(spec);
  } catch {
    return [];
  }
}

/**
 * Parse spec text into an object. Tries JSON first; if that fails, attempts a
 * minimal YAML parse sufficient for typical OpenAPI documents. Returns null when
 * neither yields a usable object.
 */
export function parseSpecText(text: string): AnyRecord | null {
  if (!text) return null;
  // JSON path.
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === "object") return obj as AnyRecord;
  } catch {
    /* fall through to YAML */
  }
  // Best-effort YAML path.
  try {
    return parseMinimalYaml(text);
  } catch {
    return null;
  }
}

/** Build `{title, version, endpointCount}` summary from a parsed spec. */
export function summarizeSpec(spec: AnyRecord | null | undefined): {
  title: string;
  version: string;
  endpointCount: number;
} {
  const info = (spec?.info as AnyRecord | undefined) ?? {};
  const title = typeof info.title === "string" && info.title.trim() ? info.title.trim() : "Untitled API";
  const version =
    typeof info.version === "string" && info.version.trim() ? info.version.trim() : "—";
  const endpointCount = spec ? specToEndpoints(spec).length : 0;
  return { title, version, endpointCount };
}

/** Walk a parsed spec's `paths` and emit one endpoint per path+method. */
function specToEndpoints(spec: AnyRecord): ServiceEndpoint[] {
  const paths = spec.paths as AnyRecord | undefined;
  if (!paths || typeof paths !== "object") return [];

  const out: ServiceEndpoint[] = [];
  for (const [rawPath, item] of Object.entries(paths)) {
    if (!item || typeof item !== "object") continue;
    const pathItem = item as AnyRecord;
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op || typeof op !== "object") continue;
      const operation = op as AnyRecord;
      const summary =
        firstString(operation.summary, operation.description, operation.operationId) ?? "";
      out.push({
        path: `${method.toUpperCase()} ${rawPath}`,
        priceUsdc: DEFAULT_PRICE,
        description: summary,
        params: extractParams(operation, pathItem),
      });
    }
  }
  return out;
}

/** Summarize an operation's parameter names (query/path/header) into a string. */
function extractParams(operation: AnyRecord, pathItem: AnyRecord): string | undefined {
  const collected: string[] = [];
  const lists = [operation.parameters, pathItem.parameters];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      if (p && typeof p === "object") {
        const name = (p as AnyRecord).name;
        if (typeof name === "string" && name.trim()) collected.push(name.trim());
      }
    }
  }
  if (collected.length === 0) return undefined;
  // De-dupe while preserving order.
  return Array.from(new Set(collected)).join(", ");
}

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * Minimal indentation-based YAML parser — handles the nested maps and simple
 * scalar/sequence values that appear in typical OpenAPI documents. This is NOT a
 * full YAML implementation; it exists only so JSON-less specs degrade
 * gracefully instead of returning nothing. Unsupported constructs are skipped.
 */
function parseMinimalYaml(text: string): AnyRecord {
  // Strip comments + blank lines, keep indentation.
  const rawLines = text.replace(/\r\n/g, "\n").split("\n");
  const lines: { indent: number; content: string }[] = [];
  for (const line of rawLines) {
    const noComment = stripYamlComment(line);
    if (!noComment.trim()) continue;
    const indent = noComment.length - noComment.trimStart().length;
    lines.push({ indent, content: noComment.trim() });
  }

  let idx = 0;

  function parseBlock(minIndent: number): AnyRecord | unknown[] {
    // Decide if this block is a sequence or a map by peeking at the first line.
    const isSeq = idx < lines.length && lines[idx].content.startsWith("- ");
    if (isSeq) return parseSeq(minIndent);
    return parseMap(minIndent);
  }

  function parseMap(minIndent: number): AnyRecord {
    const obj: AnyRecord = {};
    while (idx < lines.length) {
      const { indent, content } = lines[idx];
      if (indent < minIndent) break;
      if (indent > minIndent) {
        // Unexpected deeper indent with no parent key — skip.
        idx++;
        continue;
      }
      if (content.startsWith("- ")) break; // sequence belongs to a parent
      const colon = findKeyColon(content);
      if (colon === -1) {
        idx++;
        continue;
      }
      const key = unquote(content.slice(0, colon).trim());
      const rest = content.slice(colon + 1).trim();
      idx++;
      if (rest === "" ) {
        // Nested block (map or sequence) follows, if more-indented.
        if (idx < lines.length && lines[idx].indent > minIndent) {
          obj[key] = parseBlock(lines[idx].indent);
        } else {
          obj[key] = {};
        }
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  }

  function parseSeq(minIndent: number): unknown[] {
    const arr: unknown[] = [];
    while (idx < lines.length) {
      const { indent, content } = lines[idx];
      if (indent < minIndent || !content.startsWith("- ")) break;
      const after = content.slice(2).trim();
      const colon = findKeyColon(after);
      if (colon !== -1) {
        // Inline first key of a mapping item, e.g. "- name: foo".
        const item: AnyRecord = {};
        const key = unquote(after.slice(0, colon).trim());
        const val = after.slice(colon + 1).trim();
        idx++;
        if (val === "") {
          if (idx < lines.length && lines[idx].indent > minIndent) {
            item[key] = parseBlock(lines[idx].indent);
          } else {
            item[key] = {};
          }
        } else {
          item[key] = parseScalar(val);
        }
        // Remaining keys of this mapping item live at indent > minIndent.
        if (idx < lines.length && lines[idx].indent > minIndent) {
          const more = parseMap(lines[idx].indent);
          for (const [k, v] of Object.entries(more)) item[k] = v;
        }
        arr.push(item);
      } else {
        arr.push(parseScalar(after));
        idx++;
      }
    }
    return arr;
  }

  const root = parseBlock(0);
  return (root && typeof root === "object" && !Array.isArray(root)) ? (root as AnyRecord) : {};
}

/** Find the colon that separates a YAML key from its value (skip quoted keys). */
function findKeyColon(s: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === ":" && !inSingle && !inDouble) {
      // Must be followed by end-of-string or whitespace to count as a separator.
      if (i + 1 >= s.length || s[i + 1] === " ") return i;
    }
  }
  return -1;
}

function stripYamlComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble && (i === 0 || line[i - 1] === " ")) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquote(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseScalar(s: string): unknown {
  const v = unquote(s);
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d*\.\d+$/.test(v)) return Number(v);
  return v;
}
