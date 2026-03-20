import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sanitizeUpstreamPluginSnapshot } from "../scripts/lib/upstream-plugin-sanitization.mjs";

async function writeAntigravityConstants(pluginRoot: string, clientId: string, clientSecret: string) {
  const constantsDir = path.join(pluginRoot, "dist", "src");
  await mkdir(constantsDir, { recursive: true });
  await writeFile(
    path.join(constantsDir, "constants.js"),
    `export const ANTIGRAVITY_CLIENT_ID = "${clientId}";\nexport const ANTIGRAVITY_CLIENT_SECRET = "${clientSecret}";\n`,
    "utf8",
  );
  await writeFile(
    path.join(constantsDir, "constants.d.ts"),
    `export declare const ANTIGRAVITY_CLIENT_ID = "${clientId}";\nexport declare const ANTIGRAVITY_CLIENT_SECRET = "${clientSecret}";\n`,
    "utf8",
  );
}

describe("upstream-plugin-sanitization", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it("redacts embedded Google OAuth values from antigravity snapshots", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "opencode-quota-sanitize-"));
    tempRoots.push(tempRoot);

    await writeAntigravityConstants(
      tempRoot,
      "SAFE_TEST_CLIENT_ID",
      "SAFE_TEST_CLIENT_SECRET",
    );

    await sanitizeUpstreamPluginSnapshot("opencode-antigravity-auth", tempRoot);

    await expect(readFile(path.join(tempRoot, "dist", "src", "constants.js"), "utf8")).resolves.toContain(
      "REDACTED_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com",
    );
    await expect(readFile(path.join(tempRoot, "dist", "src", "constants.d.ts"), "utf8")).resolves.toContain(
      "REDACTED_GOOGLE_OAUTH_CLIENT_SECRET",
    );
  });

  it("fails closed when an expected secret assignment disappears", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "opencode-quota-sanitize-"));
    tempRoots.push(tempRoot);

    const constantsDir = path.join(tempRoot, "dist", "src");
    await mkdir(constantsDir, { recursive: true });
    await writeFile(path.join(constantsDir, "constants.js"), "export const OTHER = \"value\";\n", "utf8");
    await writeFile(path.join(constantsDir, "constants.d.ts"), "export declare const OTHER = \"value\";\n", "utf8");

    await expect(sanitizeUpstreamPluginSnapshot("opencode-antigravity-auth", tempRoot)).rejects.toThrow(
      "Expected ANTIGRAVITY_CLIENT_ID",
    );
  });
});
