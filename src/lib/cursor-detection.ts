import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { homedir, platform } from "os";
import { join } from "path";

import { parseJsonOrJsonc } from "./jsonc.js";
import { getOpencodeRuntimeDirCandidates } from "./opencode-runtime-paths.js";
import { CURSOR_OPENCODE_PROVIDER_ID } from "./cursor-pricing.js";

export interface CursorAuthPresence {
  state: "missing" | "present" | "invalid";
  selectedPath?: string;
  presentPaths: string[];
  candidatePaths: string[];
  error?: string;
}

export interface CursorOpenCodeIntegration {
  pluginEnabled: boolean;
  providerConfigured: boolean;
  matchedPaths: string[];
  checkedPaths: string[];
}

function dedupe(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))];
}

function getCursorHomeDir(): string {
  return process.env.CURSOR_ACP_HOME_DIR?.trim() || homedir();
}

export function getCursorAuthCandidatePaths(): string[] {
  const home = getCursorHomeDir();
  const authFiles = ["cli-config.json", "auth.json"];
  const paths: string[] = [];

  if (platform() === "darwin") {
    for (const file of authFiles) paths.push(join(home, ".cursor", file));
    for (const file of authFiles) paths.push(join(home, ".config", "cursor", file));
  } else {
    for (const file of authFiles) paths.push(join(home, ".config", "cursor", file));

    const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
    if (xdgConfigHome && xdgConfigHome !== join(home, ".config")) {
      for (const file of authFiles) paths.push(join(xdgConfigHome, "cursor", file));
    }

    for (const file of authFiles) paths.push(join(home, ".cursor", file));
  }

  return dedupe(paths);
}

export async function inspectCursorAuthPresence(): Promise<CursorAuthPresence> {
  const candidatePaths = getCursorAuthCandidatePaths();
  const presentPaths = candidatePaths.filter((path) => existsSync(path));
  let invalidPath: string | undefined;
  let invalidError: string | undefined;

  for (const path of presentPaths) {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return {
          state: "present",
          selectedPath: path,
          presentPaths,
          candidatePaths,
        };
      }
    } catch (error) {
      invalidPath ??= path;
      invalidError ??= error instanceof Error ? error.message : String(error);
    }
  }

  if (invalidPath) {
    return {
      state: "invalid",
      selectedPath: invalidPath,
      presentPaths,
      candidatePaths,
      error: invalidError,
    };
  }

  return {
    state: "missing",
    presentPaths,
    candidatePaths,
  };
}

function pluginIncludesCursor(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === CURSOR_OPENCODE_PROVIDER_ID ||
    normalized === "open-cursor" ||
    normalized === "@rama_nigg/open-cursor" ||
    normalized.endsWith("/open-cursor")
  );
}

function providerConfigIncludesCursor(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.prototype.hasOwnProperty.call(value, CURSOR_OPENCODE_PROVIDER_ID);
}

export async function inspectCursorOpenCodeIntegration(): Promise<CursorOpenCodeIntegration> {
  const { configDirs } = getOpencodeRuntimeDirCandidates();
  const checkedPaths = dedupe(
    [...configDirs, process.cwd()].flatMap((dir) => [
      join(dir, "opencode.json"),
      join(dir, "opencode.jsonc"),
    ]),
  );

  const matchedPaths: string[] = [];
  let pluginEnabled = false;
  let providerConfigured = false;

  for (const path of checkedPaths) {
    if (!existsSync(path)) continue;

    try {
      const raw = await readFile(path, "utf8");
      const parsed = parseJsonOrJsonc(raw, path.endsWith(".jsonc")) as any;
      const plugin = Array.isArray(parsed?.plugin) ? parsed.plugin : [];
      const provider = parsed?.provider;

      const matchedPlugin = plugin.some(pluginIncludesCursor);
      const matchedProvider = providerConfigIncludesCursor(provider);
      if (matchedPlugin || matchedProvider) {
        matchedPaths.push(path);
      }
      pluginEnabled ||= matchedPlugin;
      providerConfigured ||= matchedProvider;
    } catch {
      // Ignore invalid user configs here and let status output show missing matches.
    }
  }

  return {
    pluginEnabled,
    providerConfigured,
    matchedPaths,
    checkedPaths,
  };
}
