/**
 * MiniMax auth resolver
 *
 * Reads MiniMax credentials from OpenCode auth.json and resolves
 * them into a standardized format for the MiniMax Coding Plan provider.
 */

import type { AuthData, MiniMaxAuthData } from "./types.js";
import { readAuthFileCached } from "./opencode-auth.js";

export const DEFAULT_MINIMAX_AUTH_CACHE_MAX_AGE_MS = 5_000;

export type ResolvedMiniMaxAuth =
  | { state: "none" }
  | { state: "configured"; apiKey: string }
  | { state: "invalid"; error: string };

function getMiniMaxAuth(auth: AuthData | null | undefined): MiniMaxAuthData | null {
  return auth?.["minimax-coding-plan"] ?? null;
}

function getMiniMaxCredential(auth: MiniMaxAuthData): string {
  return auth.key?.trim() || auth.access?.trim() || "";
}

/**
 * Resolve MiniMax auth from the full auth data.
 *
 * Returns `"none"` when no minimax-coding-plan entry exists,
 * `"invalid"` when the entry exists but has wrong type or empty credentials,
 * and `"configured"` when a usable API key is found.
 */
export function resolveMiniMaxAuth(auth: AuthData | null | undefined): ResolvedMiniMaxAuth {
  const minimax = getMiniMaxAuth(auth);
  if (!minimax) {
    return { state: "none" };
  }

  if (minimax.type !== "api") {
    return { state: "invalid", error: `Unsupported MiniMax auth type: "${minimax.type}"` };
  }

  const credential = getMiniMaxCredential(minimax);
  if (!credential) {
    return { state: "invalid", error: "MiniMax auth entry present but credentials are empty" };
  }

  return { state: "configured", apiKey: credential };
}

export async function resolveMiniMaxAuthCached(params?: {
  maxAgeMs?: number;
}): Promise<ResolvedMiniMaxAuth> {
  const auth = await readAuthFileCached({
    maxAgeMs: Math.max(0, params?.maxAgeMs ?? DEFAULT_MINIMAX_AUTH_CACHE_MAX_AGE_MS),
  });
  return resolveMiniMaxAuth(auth);
}
