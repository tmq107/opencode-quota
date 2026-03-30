import { describe, expect, it, vi } from "vitest";

import {
  expectAttemptedWithErrorLabel,
  expectAttemptedWithNoErrors,
  expectNotAttempted,
} from "./helpers/provider-assertions.js";
import { minimaxCodingPlanProvider } from "../src/providers/minimax-coding-plan.js";

vi.mock("../src/lib/opencode-auth.js", () => ({
  readAuthFileCached: vi.fn(),
}));

vi.mock("../src/lib/minimax-auth.js", () => ({
  resolveMiniMaxAuthCached: vi.fn(),
  DEFAULT_MINIMAX_AUTH_CACHE_MAX_AGE_MS: 5_000,
}));

vi.mock("../src/lib/http.js", () => ({
  fetchWithTimeout: vi.fn(),
}));

describe("minimax-coding-plan provider", () => {
  it("returns attempted:false when no minimax coding plan is configured", async () => {
    const { resolveMiniMaxAuthCached } = await import("../src/lib/minimax-auth.js");
    (resolveMiniMaxAuthCached as any).mockResolvedValueOnce({ state: "none" });

    const out = await minimaxCodingPlanProvider.fetch({ config: {} } as any);
    expectNotAttempted(out);
  });

  it("returns error when minimax auth is invalid", async () => {
    const { resolveMiniMaxAuthCached } = await import("../src/lib/minimax-auth.js");
    (resolveMiniMaxAuthCached as any).mockResolvedValueOnce({
      state: "invalid",
      error: "Invalid API key",
    });

    const out = await minimaxCodingPlanProvider.fetch({ config: {} } as any);
    expectAttemptedWithErrorLabel(out, "MiniMax Coding Plan");
    expect(out.errors[0]?.message).toBe("Invalid API key");
  });

  it("maps MiniMax-M* model to rolling 5h and weekly entries", async () => {
    const { resolveMiniMaxAuthCached } = await import("../src/lib/minimax-auth.js");
    const { fetchWithTimeout } = await import("../src/lib/http.js");

    (resolveMiniMaxAuthCached as any).mockResolvedValueOnce({
      state: "configured",
      apiKey: "test-key",
    });
    (fetchWithTimeout as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model_remains: [
          {
            model_name: "MiniMax-M*",
            current_interval_total_count: 4500,
            current_interval_usage_count: 4430,
            remains_time: 13987604,
            current_weekly_total_count: 45000,
            current_weekly_usage_count: 44895,
            weekly_remains_time: 564787604,
          },
        ],
        base_resp: { status_code: 0, status_msg: "success" },
      }),
    });

    const out = await minimaxCodingPlanProvider.fetch({
      config: { toastStyle: "grouped" },
    } as any);

    expectAttemptedWithNoErrors(out);
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0]).toMatchObject({
      name: "MiniMax Coding Plan 5h",
      group: "MiniMax Coding Plan",
      label: "5h:",
      right: "70/4500",
      percentRemaining: 98,
    });
    expect(out.entries[1]).toMatchObject({
      name: "MiniMax Coding Plan Weekly",
      group: "MiniMax Coding Plan",
      label: "Weekly:",
      right: "105/45000",
      percentRemaining: 100,
    });
  });

  it("skips models with zero weekly total and returns empty entries", async () => {
    const { resolveMiniMaxAuthCached } = await import("../src/lib/minimax-auth.js");
    const { fetchWithTimeout } = await import("../src/lib/http.js");

    (resolveMiniMaxAuthCached as any).mockResolvedValueOnce({
      state: "configured",
      apiKey: "test-key",
    });
    (fetchWithTimeout as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model_remains: [
          {
            model_name: "MiniMax-Hailuo-2.3-Fast-6s-768p",
            current_interval_total_count: 0,
            current_interval_usage_count: 0,
            remains_time: 46387604,
            current_weekly_total_count: 0,
            current_weekly_usage_count: 0,
            weekly_remains_time: 564787604,
          },
        ],
        base_resp: { status_code: 0, status_msg: "success" },
      }),
    });

    const out = await minimaxCodingPlanProvider.fetch({
      config: { toastStyle: "grouped" },
    } as any);

    expectAttemptedWithNoErrors(out);
    expect(out.entries).toHaveLength(0);
  });

  it("returns error on API failure", async () => {
    const { resolveMiniMaxAuthCached } = await import("../src/lib/minimax-auth.js");
    const { fetchWithTimeout } = await import("../src/lib/http.js");

    (resolveMiniMaxAuthCached as any).mockResolvedValueOnce({
      state: "configured",
      apiKey: "test-key",
    });
    (fetchWithTimeout as any).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const out = await minimaxCodingPlanProvider.fetch({ config: {} } as any);
    expectAttemptedWithErrorLabel(out, "MiniMax Coding Plan");
    expect(out.errors[0]?.message).toContain("401");
  });

  it("returns error on non-zero status code", async () => {
    const { resolveMiniMaxAuthCached } = await import("../src/lib/minimax-auth.js");
    const { fetchWithTimeout } = await import("../src/lib/http.js");

    (resolveMiniMaxAuthCached as any).mockResolvedValueOnce({
      state: "configured",
      apiKey: "test-key",
    });
    (fetchWithTimeout as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model_remains: [],
        base_resp: { status_code: 1001, status_msg: "invalid token" },
      }),
    });

    const out = await minimaxCodingPlanProvider.fetch({ config: {} } as any);
    expectAttemptedWithErrorLabel(out, "MiniMax Coding Plan");
    expect(out.errors[0]?.message).toContain("invalid token");
  });

  it("returns empty entries when API returns no models", async () => {
    const { resolveMiniMaxAuthCached } = await import("../src/lib/minimax-auth.js");
    const { fetchWithTimeout } = await import("../src/lib/http.js");

    (resolveMiniMaxAuthCached as any).mockResolvedValueOnce({
      state: "configured",
      apiKey: "test-key",
    });
    (fetchWithTimeout as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model_remains: [],
        base_resp: { status_code: 0, status_msg: "success" },
      }),
    });

    const out = await minimaxCodingPlanProvider.fetch({ config: {} } as any);
    expectAttemptedWithNoErrors(out);
    expect(out.entries).toHaveLength(0);
  });

  it("uses worst remaining entry for classic style", async () => {
    const { resolveMiniMaxAuthCached } = await import("../src/lib/minimax-auth.js");
    const { fetchWithTimeout } = await import("../src/lib/http.js");

    (resolveMiniMaxAuthCached as any).mockResolvedValueOnce({
      state: "configured",
      apiKey: "test-key",
    });
    (fetchWithTimeout as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model_remains: [
          {
            model_name: "MiniMax-M*",
            current_interval_total_count: 4500,
            current_interval_usage_count: 100,
            remains_time: 13987604,
            current_weekly_total_count: 45000,
            current_weekly_usage_count: 100,
            weekly_remains_time: 564787604,
          },
        ],
        base_resp: { status_code: 0, status_msg: "success" },
      }),
    });

    const out = await minimaxCodingPlanProvider.fetch({
      config: { toastStyle: "classic" },
    } as any);

    expectAttemptedWithNoErrors(out);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]).toMatchObject({
      name: "MiniMax Coding Plan Weekly",
      percentRemaining: 0,
    });
  });

  it("matches minimax models", () => {
    expect(minimaxCodingPlanProvider.matchesCurrentModel?.("minimax/MiniMax-M2.7")).toBe(true);
    expect(minimaxCodingPlanProvider.matchesCurrentModel?.("minimax/MiniMax-M2.7-highspeed")).toBe(
      true,
    );
    expect(minimaxCodingPlanProvider.matchesCurrentModel?.("MINIMAX/MiniMax-M2.7")).toBe(true);
    expect(minimaxCodingPlanProvider.matchesCurrentModel?.("openai/gpt-4")).toBe(false);
  });

  it("isAvailable returns true when auth is configured", async () => {
    const { resolveMiniMaxAuthCached } = await import("../src/lib/minimax-auth.js");
    (resolveMiniMaxAuthCached as any).mockResolvedValueOnce({
      state: "configured",
      apiKey: "test-key",
    });

    const available = await minimaxCodingPlanProvider.isAvailable({} as any);
    expect(available).toBe(true);
  });

  it("isAvailable returns true when auth is invalid", async () => {
    const { resolveMiniMaxAuthCached } = await import("../src/lib/minimax-auth.js");
    (resolveMiniMaxAuthCached as any).mockResolvedValueOnce({
      state: "invalid",
      error: "Invalid API key",
    });

    const available = await minimaxCodingPlanProvider.isAvailable({} as any);
    expect(available).toBe(true);
  });

  it("isAvailable returns false when no auth", async () => {
    const { resolveMiniMaxAuthCached } = await import("../src/lib/minimax-auth.js");
    (resolveMiniMaxAuthCached as any).mockResolvedValueOnce({ state: "none" });

    const available = await minimaxCodingPlanProvider.isAvailable({} as any);
    expect(available).toBe(false);
  });
});
