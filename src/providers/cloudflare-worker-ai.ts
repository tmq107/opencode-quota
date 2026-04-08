/**
 * Cloudflare Worker AI provider wrapper.
 */

import type { QuotaProvider, QuotaProviderContext, QuotaProviderResult } from "../lib/entries.js";
import {
  hasCloudflareWorkerAiConfigured,
  queryCloudflareWorkerAiQuota,
} from "../lib/cloudflare.js";

export const cloudflareWorkerAiProvider: QuotaProvider = {
  id: "cloudflare-worker-ai",

  async isAvailable(ctx: QuotaProviderContext): Promise<boolean> {
    try {
      const resp = await ctx.client.config.providers();
      const ids = new Set((resp.data?.providers ?? []).map((p) => p.id));
      if (ids.has("cloudflare-worker-ai") || ids.has("cloudflare") || ids.has("workers-ai")) {
        return true;
      }
    } catch {
      // ignore and fall back to local key presence
    }

    return await hasCloudflareWorkerAiConfigured();
  },

  matchesCurrentModel(model: string): boolean {
    const provider = model.split("/")[0]?.toLowerCase();
    if (!provider) return false;
    return (
      provider.includes("cloudflare") ||
      provider.includes("workers-ai") ||
      provider.includes("worker-ai")
    );
  },

  async fetch(_ctx: QuotaProviderContext): Promise<QuotaProviderResult> {
    const result = await queryCloudflareWorkerAiQuota();

    if (!result) {
      return { attempted: false, entries: [], errors: [] };
    }

    if (!result.success) {
      return {
        attempted: true,
        entries: [],
        errors: [{ label: "Cloudflare Worker AI", message: result.error }],
      };
    }

    return {
      attempted: true,
      entries: [
        {
          name: "Cloudflare Worker AI (Neutron)",
          group: "Cloudflare Worker AI (Neutron)",
          label: "Daily:",
          percentRemaining: result.percentRemaining,
          resetTimeIso: result.resetTimeIso,
          right: `${Math.round(result.usedNeurons24h)}/${result.freeDailyNeurons}`,
        },
      ],
      errors: [],
    };
  },
};
