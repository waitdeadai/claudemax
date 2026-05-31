// Tiny YAML-frontmatter parser/serializer for the vault note contract. The
// shape is deliberately constrained (flat key/value, scalars, booleans,
// integers, single-line inline arrays [a, b]) so a hand-rolled parser stays
// under the repo's zero-new-dependency posture. It is NOT a general YAML
// implementation: nested maps, block scalars, and anchors are unsupported by
// design — the vault note contract never uses them.

export type FrontmatterValue = string | number | boolean | readonly string[];

export interface ParsedNote {
  readonly data: Readonly<Record<string, FrontmatterValue>>;
  readonly body: string;
}

const FENCE = "---";

// Split a note into its frontmatter block and markdown body. Returns null data
// when the note has no leading `---` fence (treated as a bodyless note).
export function parseFrontmatter(raw: string): ParsedNote {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(FENCE)) {
    return { data: {}, body: normalized.trim() };
  }
  const rest = normalized.slice(FENCE.length);
  const closeIdx = rest.indexOf(`\n${FENCE}`);
  if (closeIdx === -1) {
    return { data: {}, body: normalized.trim() };
  }
  const block = rest.slice(0, closeIdx).replace(/^\n/, "");
  const afterFence = rest.slice(closeIdx + 1 + FENCE.length);
  const body = afterFence.replace(/^\n+/, "").trimEnd();
  return { data: parseBlock(block), body };
}

function parseBlock(block: string): Record<string, FrontmatterValue> {
  const data: Record<string, FrontmatterValue> = {};
  for (const line of block.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!key) continue;
    const rawValue = line.slice(colon + 1).trim();
    data[key] = parseScalar(rawValue);
  }
  return data;
}

function parseScalar(raw: string): FrontmatterValue {
  if (raw === "") return "";
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((item) => stripQuotes(item.trim()));
  }
  const lower = raw.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  if (/^-?\d+$/.test(raw)) {
    const n = Number(raw);
    if (Number.isSafeInteger(n)) return n;
  }
  return stripQuotes(raw);
}

// Unwrap single- or double-quoted scalars. Single-quoted YAML escapes a quote
// as '' → '; double-quoted supports \" and \\. Unquoted values pass through.
function stripQuotes(raw: string): string {
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return raw;
}

// Serialize a flat frontmatter object back to a fenced YAML-ish block. Strings
// that could be misread (contain a colon, leading special char, or look like a
// bool/number) are single-quoted; arrays render inline as [a, b].
export function serializeNote(
  data: Readonly<Record<string, FrontmatterValue>>,
  body: string,
): string {
  const lines: string[] = [FENCE];
  for (const [key, value] of Object.entries(data)) {
    lines.push(`${key}: ${serializeValue(value)}`);
  }
  lines.push(FENCE, "");
  return `${lines.join("\n")}\n${body.trim()}\n`;
}

function serializeValue(value: FrontmatterValue): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => serializeScalarString(v)).join(", ")}]`;
  }
  return serializeScalarString(value as string);
}

function serializeScalarString(value: string): string {
  if (value === "") return "''";
  const needsQuote =
    /[:#'"]/.test(value) ||
    /^[!&*?|>%@`\-\[\]{}]/.test(value) ||
    /^(true|false|null|~)$/i.test(value) ||
    /^-?\d+$/.test(value);
  if (!needsQuote) return value;
  return `'${value.replace(/'/g, "''")}'`;
}
