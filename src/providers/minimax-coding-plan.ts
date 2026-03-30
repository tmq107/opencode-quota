/**
 * MiniMax Coding Plan provider wrapper.
 *
 * Fetches quota data from MiniMax API for coding plan users.
 */

import type { QuotaProvider, QuotaProviderContext, QuotaProviderResult } from "../lib/entries.js";
import {
  DEFAULT_MINIMAX_AUTH_CACHE_MAX_AGE_MS,
  resolveMiniMaxAuthCached,
} from "../lib/minimax-auth.js";
import { fetchWithTimeout } from "../lib/http.js";
import type { MiniMaxResult, MiniMaxResultEntry } from "../lib/types.js";

const MINIMAX_API_URL = "https://api.minimax.io/v1/api/openplatform/coding_plan/remains";
const USER_AGENT = "OpenCode-Quota-Toast/1.0";

interface MiniMaxModelRemain {
  model_name: string;
  current_interval_total_count: number;
  /** Actually returns remaining quota (not usage). Usage = total - this value. */
  current_interval_usage_count: number;
  remains_time: number;
  current_weekly_total_count: number;
  /** Actually returns remaining quota (not usage). Usage = total - this value. */
  current_weekly_usage_count: number;
  weekly_remains_time: number;
}

interface MiniMaxApiResponse {
  model_remains: MiniMaxModelRemain[];
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

/**
 * Type guard that validates a value is a well-formed MiniMax model record.
 *
 * Checks for `model_name` (string) and all required numeric fields to prevent
 * `NaN` arithmetic when the API response shape is unexpected.
 */
function isMiniMaxModelRecord(value: unknown): value is MiniMaxModelRemain {
  if (value === null || typeof value !== "object" || !("model_name" in value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.model_name === "string" &&
    typeof v.current_interval_total_count === "number" &&
    typeof v.current_interval_usage_count === "number" &&
    typeof v.remains_time === "number" &&
    typeof v.current_weekly_total_count === "number" &&
    typeof v.current_weekly_usage_count === "number" &&
    typeof v.weekly_remains_time === "number"
  );
}

function roundPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Build a weekly quota entry for the main model. */
function buildWeeklyEntry(model: MiniMaxModelRemain): MiniMaxResultEntry {
  const weeklyTotal = model.current_weekly_total_count || 0;
  const weeklyRemaining = model.current_weekly_usage_count || 0;
  const weeklyUsed = weeklyTotal - weeklyRemaining;
  const weeklyPercent = weeklyTotal > 0 ? roundPercent((weeklyRemaining / weeklyTotal) * 100) : 0;

  return {
    name: "MiniMax Coding Plan Weekly",
    group: "MiniMax Coding Plan",
    label: "Weekly:",
    right: `${weeklyUsed}/${weeklyTotal}`,
    percentRemaining: weeklyPercent,
    resetTimeIso: new Date(Date.now() + (model.weekly_remains_time || 0)).toISOString(),
  };
}

/**
 * Fetch MiniMax coding plan quota from the API.
 *
 * Parses usage specifically for `MiniMax-M*` text models.
 *
 * @param apiKey - MiniMax API key
 * @returns Quota entries on success, error on failure, or empty entries when
 *          the API returns successfully but no models have reportable quota.
 */
async function fetchMiniMaxQuota(apiKey: string): Promise<MiniMaxResult> {
  try {
    const response = await fetchWithTimeout(MINIMAX_API_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": USER_AGENT,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        error: `MiniMax API error ${response.status}: ${text.slice(0, 120)}`,
      };
    }

    const payload = (await response.json()) as MiniMaxApiResponse;

    if (payload.base_resp?.status_code !== 0) {
      return {
        success: false,
        error: `MiniMax API error: ${payload.base_resp?.status_msg ?? "unknown"}`,
      };
    }

    const entries: MiniMaxResultEntry[] = [];

    for (const model of payload.model_remains ?? []) {
      if (!isMiniMaxModelRecord(model)) continue;
      if (model.model_name !== "MiniMax-M*") continue;

      const total = model.current_interval_total_count || 0;
      const remaining = model.current_interval_usage_count || 0;
      const used = total - remaining;
      const percentRemaining = total > 0 ? roundPercent((remaining / total) * 100) : 0;

      entries.push({
        name: "MiniMax Coding Plan 5h",
        group: "MiniMax Coding Plan",
        label: "5h:",
        right: `${used}/${total}`,
        percentRemaining,
        resetTimeIso: new Date(Date.now() + (model.remains_time || 0)).toISOString(),
      });

      entries.push(buildWeeklyEntry(model));
    }

    return { success: true, entries };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const minimaxCodingPlanProvider: QuotaProvider = {
  id: "minimax-coding-plan",

  async isAvailable(_ctx: QuotaProviderContext): Promise<boolean> {
    const auth = await resolveMiniMaxAuthCached({
      maxAgeMs: DEFAULT_MINIMAX_AUTH_CACHE_MAX_AGE_MS,
    });
    return auth.state === "configured" || auth.state === "invalid";
  },

  matchesCurrentModel(model: string): boolean {
    return model.toLowerCase().startsWith("minimax/");
  },

  async fetch(ctx: QuotaProviderContext): Promise<QuotaProviderResult> {
    const auth = await resolveMiniMaxAuthCached({
      maxAgeMs: DEFAULT_MINIMAX_AUTH_CACHE_MAX_AGE_MS,
    });

    if (auth.state === "none") {
      return { attempted: false, entries: [], errors: [] };
    }

    if (auth.state === "invalid") {
      return {
        attempted: true,
        entries: [],
        errors: [{ label: "MiniMax Coding Plan", message: auth.error }],
      };
    }

    const result = await fetchMiniMaxQuota(auth.apiKey);

    if (!result) {
      return { attempted: false, entries: [], errors: [] };
    }

    if (!result.success) {
      return {
        attempted: true,
        entries: [],
        errors: [{ label: "MiniMax Coding Plan", message: result.error }],
      };
    }

    const style = ctx.config.toastStyle ?? "classic";

    if (style === "classic") {
      const worst = [...result.entries].sort((a, b) => a.percentRemaining - b.percentRemaining)[0];
      if (!worst) {
        return { attempted: true, entries: [], errors: [] };
      }
      return {
        attempted: true,
        entries: [
          {
            name: worst.name,
            percentRemaining: worst.percentRemaining,
            resetTimeIso: worst.resetTimeIso,
          },
        ],
        errors: [],
      };
    }

    return {
      attempted: true,
      entries: result.entries,
      errors: [],
    };
  },
};
