/**
 * Token counting (spec §7 prerequisite).
 *
 * Uses cl100k_base — the encoding shared by GPT-4 and Claude's public
 * tiktoken-compatible tooling. Sync, pure JS, no WASM.
 */

import { encode } from 'gpt-tokenizer';

/**
 * Count cl100k_base tokens in `text`.
 * Returns 0 for empty/whitespace-only input.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}
