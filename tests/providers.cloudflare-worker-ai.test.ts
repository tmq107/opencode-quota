import { describe, expect, it, vi } from "vitest";

import {
  expectAttemptedWithErrorLabel,
  expectAttemptedWithNoErrors,
  expectNotAttempted,
} from "./helpers/provider-assertions.js";
import { cloudflareWorkerAiProvider } from "../src/providers/cloudflare-worker-ai.js";

vi.mock("../src/lib/cloudflare.js", () => ({
  queryCloudflareWorkerAiQuota: vi.fn(),
  hasCloudflareWorkerAiConfigured: vi.fn(),
}));

describe("cloudflare-worker-ai provider", () => {
  it("returns attempted:false when not configured", async () => {
    const { queryCloudflareWorkerAiQuota } = await import("../src/lib/cloudflare.js");
    (queryCloudflareWorkerAiQuota as any).mockResolvedValueOnce(null);

    const out = await cloudflareWorkerAiProvider.fetch({} as any);
    expectNotAttempted(out);
  });

  it("maps success into one toast entry", async () => {
    const { queryCloudflareWorkerAiQuota } = await import("../src/lib/cloudflare.js");
    (queryCloudflareWorkerAiQuota as any).mockResolvedValueOnce({
      success: true,
      percentRemaining: 64,
      resetTimeIso: "2026-01-02T00:00:00.000Z",
      usedNeurons24h: 3600,
      freeDailyNeurons: 10_000,
    });

    const out = await cloudflareWorkerAiProvider.fetch({ config: {} } as any);
    expectAttemptedWithNoErrors(out);
    expect(out.entries).toEqual([
      {
        name: "Cloudflare Worker AI (Neutron)",
        group: "Cloudflare Worker AI (Neutron)",
        label: "Daily:",
        percentRemaining: 64,
        resetTimeIso: "2026-01-02T00:00:00.000Z",
        right: "3600/10000",
      },
    ]);
  });

  it("maps errors into toast errors", async () => {
    const { queryCloudflareWorkerAiQuota } = await import("../src/lib/cloudflare.js");
    (queryCloudflareWorkerAiQuota as any).mockResolvedValueOnce({
      success: false,
      error: "Token expired",
    });

    const out = await cloudflareWorkerAiProvider.fetch({} as any);
    expectAttemptedWithErrorLabel(out, "Cloudflare Worker AI");
  });

  it("is available when provider ids include cloudflare aliases", async () => {
    const { hasCloudflareWorkerAiConfigured } = await import("../src/lib/cloudflare.js");
    (hasCloudflareWorkerAiConfigured as any).mockResolvedValue(false);

    const makeCtx = (ids: string[]) =>
      ({
        client: {
          config: {
            providers: vi
              .fn()
              .mockResolvedValue({ data: { providers: ids.map((id) => ({ id })) } }),
            get: vi.fn(),
          },
        },
        config: { googleModels: [] },
      }) as any;

    await expect(
      cloudflareWorkerAiProvider.isAvailable(makeCtx(["cloudflare-worker-ai"])),
    ).resolves.toBe(true);
    await expect(cloudflareWorkerAiProvider.isAvailable(makeCtx(["cloudflare"]))).resolves.toBe(
      true,
    );
    await expect(cloudflareWorkerAiProvider.isAvailable(makeCtx(["workers-ai"]))).resolves.toBe(
      true,
    );
    await expect(cloudflareWorkerAiProvider.isAvailable(makeCtx(["zai"]))).resolves.toBe(false);
  });

  it("falls back to local config when provider lookup throws", async () => {
    const { hasCloudflareWorkerAiConfigured } = await import("../src/lib/cloudflare.js");
    (hasCloudflareWorkerAiConfigured as any).mockResolvedValueOnce(true);

    const ctx = {
      client: {
        config: {
          providers: vi.fn().mockRejectedValue(new Error("boom")),
          get: vi.fn(),
        },
      },
      config: { googleModels: [] },
    } as any;

    await expect(cloudflareWorkerAiProvider.isAvailable(ctx)).resolves.toBe(true);
  });
});
