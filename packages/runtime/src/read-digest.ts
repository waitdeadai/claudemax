// Reversible CCR (Compress-Cache-Retrieve) codec for read-tool output.
//
// This module is the deterministic, fully-reversible digest primitive ONLY.
// Protection/gating decisions (what is safe to digest, which tools and context
// kinds are off-limits) live in a single source of truth: context-engineering.ts
// (`contextShouldDigest`, `isProtectedToolName`, `isProtectedContext`). Do not
// reintroduce a parallel gate here — the live context-editing path is wired
// through context-engineering.ts.

import { deflateSync, inflateSync } from "node:zlib";

const DIGEST_PREFIX = "cmx_digest:v1:";

/**
 * Compress read-tool output into a compact, fully reversible digest string.
 * Format: cmx_digest:v1:<base64(zlib-deflate(utf8(text)))>
 */
export function digestReadOutput(text: string): string {
  const compressed = deflateSync(Buffer.from(text, "utf-8"), { level: 9 });
  return DIGEST_PREFIX + compressed.toString("base64");
}

/**
 * Restore original text from a digest produced by digestReadOutput.
 * Throws if the input is not a valid cmx_digest:v1: string.
 */
export function undigestReadOutput(digest: string): string {
  if (!digest.startsWith(DIGEST_PREFIX)) {
    throw new Error(
      `Invalid read-digest: expected prefix '${DIGEST_PREFIX}', got '${digest.slice(0, 20)}…'`
    );
  }
  const b64 = digest.slice(DIGEST_PREFIX.length);
  if (b64.length === 0) {
    throw new Error("Invalid read-digest: base64 payload is empty");
  }
  let compressed: Buffer;
  try {
    compressed = Buffer.from(b64, "base64");
  } catch {
    throw new Error("Invalid read-digest: base64 decode failed");
  }
  const decompressed = inflateSync(compressed);
  return decompressed.toString("utf-8");
}

/** Returns true if digest was produced by digestReadOutput. */
export function isReadDigest(value: string): boolean {
  return value.startsWith(DIGEST_PREFIX);
}
