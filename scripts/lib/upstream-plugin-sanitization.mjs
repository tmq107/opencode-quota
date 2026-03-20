import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REDACTED_GOOGLE_OAUTH_CLIENT_ID = "REDACTED_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com";
const REDACTED_GOOGLE_OAUTH_CLIENT_SECRET = "REDACTED_GOOGLE_OAUTH_CLIENT_SECRET";

const SNAPSHOT_SANITIZERS = Object.freeze({
  "opencode-antigravity-auth": Object.freeze([
    {
      relativePath: "dist/src/constants.d.ts",
      replacements: [
        {
          label: "ANTIGRAVITY_CLIENT_ID",
          pattern: /(export declare const ANTIGRAVITY_CLIENT_ID = )"[^"]+";/,
          replacement: `$1"${REDACTED_GOOGLE_OAUTH_CLIENT_ID}";`,
        },
        {
          label: "ANTIGRAVITY_CLIENT_SECRET",
          pattern: /(export declare const ANTIGRAVITY_CLIENT_SECRET = )"[^"]+";/,
          replacement: `$1"${REDACTED_GOOGLE_OAUTH_CLIENT_SECRET}";`,
        },
      ],
    },
    {
      relativePath: "dist/src/constants.js",
      replacements: [
        {
          label: "ANTIGRAVITY_CLIENT_ID",
          pattern: /(export const ANTIGRAVITY_CLIENT_ID = )"[^"]+";/,
          replacement: `$1"${REDACTED_GOOGLE_OAUTH_CLIENT_ID}";`,
        },
        {
          label: "ANTIGRAVITY_CLIENT_SECRET",
          pattern: /(export const ANTIGRAVITY_CLIENT_SECRET = )"[^"]+";/,
          replacement: `$1"${REDACTED_GOOGLE_OAUTH_CLIENT_SECRET}";`,
        },
      ],
    },
  ]),
});

export async function sanitizeUpstreamPluginSnapshot(pluginId, pluginRoot) {
  const sanitizers = SNAPSHOT_SANITIZERS[pluginId] ?? [];

  for (const sanitizer of sanitizers) {
    const filePath = path.join(pluginRoot, sanitizer.relativePath);
    let content = await readFile(filePath, "utf8");

    for (const replacement of sanitizer.replacements) {
      if (!replacement.pattern.test(content)) {
        throw new Error(
          `Expected ${replacement.label} in ${filePath} while sanitizing ${pluginId} snapshot.`,
        );
      }

      content = content.replace(replacement.pattern, replacement.replacement);
    }

    await writeFile(filePath, content, "utf8");
  }
}
