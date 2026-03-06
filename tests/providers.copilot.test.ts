import { describe, expect, it, vi } from "vitest";

import {
  expectAttemptedWithErrorLabel,
  expectAttemptedWithNoErrors,
  expectNotAttempted,
} from "./helpers/provider-assertions.js";
import { copilotProvider } from "../src/providers/copilot.js";

vi.mock("../src/lib/copilot.js", () => ({
  queryCopilotQuota: vi.fn(),
}));

describe("copilot provider", () => {
  it("returns attempted:false when Copilot quota is unavailable", async () => {
    const { queryCopilotQuota } = await import("../src/lib/copilot.js");
    (queryCopilotQuota as any).mockResolvedValueOnce(null);

    const out = await copilotProvider.fetch({} as any);
    expectNotAttempted(out);
  });

  it("maps personal quota into a percent toast entry", async () => {
    const { queryCopilotQuota } = await import("../src/lib/copilot.js");
    (queryCopilotQuota as any).mockResolvedValueOnce({
      success: true,
      mode: "user_quota",
      used: 42,
      total: 300,
      percentRemaining: 86,
      resetTimeIso: "2026-02-01T00:00:00.000Z",
    });

    const out = await copilotProvider.fetch({} as any);
    expectAttemptedWithNoErrors(out);
    expect(out.entries).toEqual([
      {
        name: "Copilot",
        percentRemaining: 86,
        resetTimeIso: "2026-02-01T00:00:00.000Z",
      },
    ]);
  });

  it("maps organization usage into a value toast entry", async () => {
    const { queryCopilotQuota } = await import("../src/lib/copilot.js");
    (queryCopilotQuota as any).mockResolvedValueOnce({
      success: true,
      mode: "organization_usage",
      organization: "acme-corp",
      period: {
        year: 2026,
        month: 1,
      },
      used: 9,
      resetTimeIso: "2026-02-01T00:00:00.000Z",
    });

    const out = await copilotProvider.fetch({} as any);
    expectAttemptedWithNoErrors(out);
    expect(out.entries).toEqual([
      {
        kind: "value",
        name: "Copilot Org",
        value: "9 used",
        resetTimeIso: "2026-02-01T00:00:00.000Z",
      },
    ]);
  });

  it("maps errors into toast errors", async () => {
    const { queryCopilotQuota } = await import("../src/lib/copilot.js");
    (queryCopilotQuota as any).mockResolvedValueOnce({
      success: false,
      error: "Unauthorized",
    });

    const out = await copilotProvider.fetch({} as any);
    expectAttemptedWithErrorLabel(out, "Copilot");
  });
});
