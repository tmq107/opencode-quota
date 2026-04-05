import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { queryCloudflareWorkerAiQuota } from "../src/lib/cloudflare.js";

vi.mock("../src/lib/opencode-auth.js", () => ({
  readAuthFile: vi.fn(),
}));

describe("queryCloudflareWorkerAiQuota", () => {
  const originalEnv = process.env;
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));

    tempDir = mkdtempSync(join(tmpdir(), "opencode-quota-cloudflare-"));
    process.env = { ...originalEnv, XDG_CONFIG_HOME: tempDir };
    process.chdir(tempDir);
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CF_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CF_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_WORKER_AI_DAILY_FREE_NEURONS;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null when not configured", async () => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");
    (readAuthFile as any).mockResolvedValueOnce({});

    await expect(queryCloudflareWorkerAiQuota()).resolves.toBeNull();
  });

  it("ignores CLOUDFLARE_API_TOKEN and CF_API_TOKEN env vars for key resolution", async () => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");
    (readAuthFile as any).mockResolvedValueOnce({});
    process.env.CLOUDFLARE_API_TOKEN = "env-token";
    process.env.CF_API_TOKEN = "env-token-2";
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc-123";

    await expect(queryCloudflareWorkerAiQuota()).resolves.toBeNull();
  });

  it("returns usage data from GraphQL with rolling 24h reset", async () => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");
    (readAuthFile as any).mockResolvedValueOnce({
      "cloudflare-workers-ai": {
        type: "api",
        key: "auth-json-key",
      },
    });
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc-123";
    process.env.CLOUDFLARE_WORKER_AI_DAILY_FREE_NEURONS = "10000";

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                viewer: {
                  accounts: [
                    {
                      aiInferenceAdaptiveGroups: [
                        {
                          sum: {
                            totalNeurons: 2000,
                          },
                        },
                        {
                          sum: {
                            totalNeurons: 500,
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            }),
            { status: 200 },
          ),
      ) as any,
    );

    const out = await queryCloudflareWorkerAiQuota();
    expect(out && out.success ? out.percentRemaining : -1).toBe(75);
    expect(out && out.success ? out.usedNeurons24h : -1).toBe(2500);
    expect(out && out.success ? out.freeDailyNeurons : -1).toBe(10_000);
    expect(out && out.success ? out.resetTimeIso : "").toBe("2026-01-02T12:00:00.000Z");
  });

  it("handles API errors", async () => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");
    (readAuthFile as any).mockResolvedValueOnce({
      "cloudflare-workers-ai": {
        type: "api",
        key: "auth-json-key",
      },
    });
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc-123";

    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unauthorized", { status: 401 })) as any);

    const out = await queryCloudflareWorkerAiQuota();
    expect(out && !out.success ? out.error : "").toContain("Cloudflare API error 401");
  });

  it("returns GraphQL errors when present", async () => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");
    (readAuthFile as any).mockResolvedValueOnce({
      "cloudflare-workers-ai": {
        type: "api",
        key: "auth-json-key",
      },
    });
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc-123";

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              errors: [{ message: "Invalid account id" }],
            }),
            { status: 200 },
          ),
      ) as any,
    );

    const out = await queryCloudflareWorkerAiQuota();
    expect(out && !out.success ? out.error : "").toBe(
      "Cloudflare GraphQL error: Invalid account id",
    );
  });

  it("reads api key from auth.json cloudflare-workers-ai format", async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "env-account";
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");
    (readAuthFile as any).mockResolvedValueOnce({
      "cloudflare-workers-ai": {
        type: "api",
        key: "auth-json-key",
      },
    });

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              viewer: {
                accounts: [
                  {
                    aiInferenceAdaptiveGroups: [{ sum: { totalNeurons: 100 } }],
                  },
                ],
              },
            },
          }),
          { status: 200 },
        ),
    ) as any;
    vi.stubGlobal("fetch", fetchMock);

    const out = await queryCloudflareWorkerAiQuota();
    expect(out && out.success ? out.percentRemaining : -1).toBe(99);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/graphql",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer auth-json-key",
        }),
      }),
    );
  });

  it("reads account settings from trusted global config and key from auth.json", async () => {
    const { readAuthFile } = await import("../src/lib/opencode-auth.js");
    (readAuthFile as any).mockResolvedValueOnce({
      "cloudflare-workers-ai": {
        type: "api",
        key: "auth-json-key",
      },
    });

    mkdirSync(join(tempDir, "opencode"), { recursive: true });
    writeFileSync(
      join(tempDir, "opencode", "opencode.json"),
      JSON.stringify({
        provider: {
          "cloudflare-worker-ai": {
            options: {
              accountId: "from-config-account",
              freeDailyNeurons: 4000,
            },
          },
        },
      }),
      "utf-8",
    );

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              viewer: {
                accounts: [
                  {
                    aiInferenceAdaptiveGroups: [{ sum: { totalNeurons: 1000 } }],
                  },
                ],
              },
            },
          }),
          { status: 200 },
        ),
    ) as any;
    vi.stubGlobal("fetch", fetchMock);

    const out = await queryCloudflareWorkerAiQuota();
    expect(out && out.success ? out.percentRemaining : -1).toBe(75);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/graphql",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer auth-json-key",
        }),
      }),
    );
  });

  it("ignores repo-local provider config for secret lookup", async () => {
    writeFileSync(
      join(tempDir, "opencode.json"),
      JSON.stringify({
        provider: {
          "cloudflare-worker-ai": {
            options: {
              apiToken: "should-not-be-used",
              accountId: "should-not-be-used",
            },
          },
        },
      }),
      "utf-8",
    );

    const out = await queryCloudflareWorkerAiQuota();
    expect(out).toBeNull();
  });
});
