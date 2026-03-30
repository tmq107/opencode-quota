import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAuthFileCached: vi.fn(),
}));

vi.mock("../src/lib/opencode-auth.js", () => ({
  readAuthFileCached: mocks.readAuthFileCached,
}));

import {
  DEFAULT_MINIMAX_AUTH_CACHE_MAX_AGE_MS,
  resolveMiniMaxAuth,
  resolveMiniMaxAuthCached,
} from "../src/lib/minimax-auth.js";

describe("minimax auth resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns none when auth is null", () => {
    expect(resolveMiniMaxAuth(null)).toEqual({ state: "none" });
  });

  it("returns none when auth is undefined", () => {
    expect(resolveMiniMaxAuth(undefined)).toEqual({ state: "none" });
  });

  it("returns none when minimax-coding-plan entry is missing", () => {
    expect(resolveMiniMaxAuth({})).toEqual({ state: "none" });
  });

  it("returns invalid when type is not 'api'", () => {
    const result = resolveMiniMaxAuth({
      "minimax-coding-plan": { type: "oauth", key: "some-key" },
    });
    expect(result).toEqual({
      state: "invalid",
      error: 'Unsupported MiniMax auth type: "oauth"',
    });
  });

  it("returns invalid when type is api but credentials are empty", () => {
    const result = resolveMiniMaxAuth({
      "minimax-coding-plan": { type: "api", key: "", access: "" },
    });
    expect(result).toEqual({
      state: "invalid",
      error: "MiniMax auth entry present but credentials are empty",
    });
  });

  it("returns invalid when type is api but credentials are whitespace-only", () => {
    const result = resolveMiniMaxAuth({
      "minimax-coding-plan": { type: "api", key: "   ", access: "  " },
    });
    expect(result).toEqual({
      state: "invalid",
      error: "MiniMax auth entry present but credentials are empty",
    });
  });

  it("returns configured with key when both key and access are present", () => {
    const result = resolveMiniMaxAuth({
      "minimax-coding-plan": { type: "api", key: "primary-key", access: "access-key" },
    });
    expect(result).toEqual({
      state: "configured",
      apiKey: "primary-key",
    });
  });

  it("prefers key over access", () => {
    const result = resolveMiniMaxAuth({
      "minimax-coding-plan": { type: "api", key: "the-key", access: "the-access" },
    });
    expect(result.state).toBe("configured");
    expect((result as any).apiKey).toBe("the-key");
  });

  it("falls back to access when key is missing", () => {
    const result = resolveMiniMaxAuth({
      "minimax-coding-plan": { type: "api", access: "access-token" },
    });
    expect(result).toEqual({
      state: "configured",
      apiKey: "access-token",
    });
  });

  it("falls back to access when key is whitespace", () => {
    const result = resolveMiniMaxAuth({
      "minimax-coding-plan": { type: "api", key: "  ", access: "access-token" },
    });
    expect(result).toEqual({
      state: "configured",
      apiKey: "access-token",
    });
  });

  it("trims whitespace from key", () => {
    const result = resolveMiniMaxAuth({
      "minimax-coding-plan": { type: "api", key: "  my-key  " },
    });
    expect(result).toEqual({
      state: "configured",
      apiKey: "my-key",
    });
  });

  it("trims whitespace from access", () => {
    const result = resolveMiniMaxAuth({
      "minimax-coding-plan": { type: "api", access: "  my-access  " },
    });
    expect(result).toEqual({
      state: "configured",
      apiKey: "my-access",
    });
  });

  it("uses cached auth reads for resolveMiniMaxAuthCached", async () => {
    mocks.readAuthFileCached.mockResolvedValueOnce({
      "minimax-coding-plan": { type: "api", key: "cached-key" },
    });

    await expect(resolveMiniMaxAuthCached()).resolves.toEqual({
      state: "configured",
      apiKey: "cached-key",
    });
    expect(mocks.readAuthFileCached).toHaveBeenCalledWith({
      maxAgeMs: DEFAULT_MINIMAX_AUTH_CACHE_MAX_AGE_MS,
    });
  });

  it("respects custom maxAgeMs in resolveMiniMaxAuthCached", async () => {
    mocks.readAuthFileCached.mockResolvedValueOnce({
      "minimax-coding-plan": { type: "api", key: "key" },
    });

    await resolveMiniMaxAuthCached({ maxAgeMs: 10_000 });
    expect(mocks.readAuthFileCached).toHaveBeenCalledWith({ maxAgeMs: 10_000 });
  });

  it("clamps negative maxAgeMs to 0", async () => {
    mocks.readAuthFileCached.mockResolvedValueOnce({});

    await resolveMiniMaxAuthCached({ maxAgeMs: -500 });
    expect(mocks.readAuthFileCached).toHaveBeenCalledWith({ maxAgeMs: 0 });
  });
});
