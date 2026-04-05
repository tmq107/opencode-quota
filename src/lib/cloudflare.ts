/**
 * Cloudflare Worker AI quota fetcher.
 *
 * Uses Cloudflare GraphQL analytics to estimate free-tier neuron usage over
 * the last 24 hours.
 */

import type { AuthData, QuotaError } from "./types.js";
import { sanitizeDisplaySnippet, sanitizeDisplayText } from "./display-sanitize.js";
import { fetchWithTimeout } from "./http.js";
import { clampPercent } from "./format-utils.js";
import { readAuthFile } from "./opencode-auth.js";
import { getGlobalOpencodeConfigCandidatePaths, readOpencodeConfig } from "./api-key-resolver.js";
import { resolveEnvTemplate } from "./env-template.js";

const CLOUDFLARE_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const CLOUDFLARE_DEFAULT_FREE_DAILY_NEURONS = 10_000;
const ALLOWED_ACCOUNT_ENV_VARS = ["CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID"] as const;

type CloudflareAuth = {
  apiToken: string;
  accountId: string;
  freeDailyNeurons: number;
};

export type CloudflareWorkerAiResult =
  | {
      success: true;
      percentRemaining: number;
      resetTimeIso: string;
      usedNeurons24h: number;
      freeDailyNeurons: number;
    }
  | QuotaError
  | null;

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | null {
  if (!value || typeof value !== "object") return null;
  return value as RecordLike;
}

function getNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function extractCloudflareFromConfig(config: unknown): Partial<CloudflareAuth> {
  const root = asRecord(config);
  if (!root) return {};

  const provider = asRecord(root.provider);
  if (!provider) return {};

  const entry =
    asRecord(provider["cloudflare-worker-ai"]) ??
    asRecord(provider.cloudflare) ??
    asRecord(provider["workers-ai"]);
  if (!entry) return {};

  const options = asRecord(entry.options);
  if (!options) return {};

  const accountTemplate =
    getNonEmptyString(options.accountId) ?? getNonEmptyString(options.accountTag);
  const accountId = accountTemplate
    ? (resolveEnvTemplate(accountTemplate, ALLOWED_ACCOUNT_ENV_VARS) ?? undefined)
    : undefined;
  const freeDailyNeurons = getPositiveInteger(options.freeDailyNeurons);

  return {
    accountId,
    freeDailyNeurons,
  };
}

function extractCloudflareFromAuth(auth: AuthData | null): Partial<CloudflareAuth> {
  const root = asRecord(auth);
  if (!root) return {};

  const entry =
    asRecord(root["cloudflare-workers-ai"]) ??
    asRecord(root["cloudflare-worker-ai"]) ??
    asRecord(root.cloudflare) ??
    asRecord(root["workers-ai"]);
  if (!entry) return {};

  const authType = getNonEmptyString(entry.type);
  if (authType && authType !== "api") return {};

  const apiToken =
    getNonEmptyString(entry.apiToken) ??
    getNonEmptyString(entry.token) ??
    getNonEmptyString(entry.key);
  const accountId = getNonEmptyString(entry.accountId) ?? getNonEmptyString(entry.accountTag);
  const freeDailyNeurons = getPositiveInteger(entry.freeDailyNeurons);

  return {
    apiToken,
    accountId,
    freeDailyNeurons,
  };
}

function getRollingDailyResetIso(nowMs: number): string {
  return new Date(nowMs + 24 * 60 * 60 * 1000).toISOString();
}

function getEnvCloudflareAuth(): Partial<CloudflareAuth> {
  const accountId =
    getNonEmptyString(process.env.CLOUDFLARE_ACCOUNT_ID) ??
    getNonEmptyString(process.env.CF_ACCOUNT_ID);
  const freeDailyNeurons = getPositiveInteger(process.env.CLOUDFLARE_WORKER_AI_DAILY_FREE_NEURONS);

  return {
    accountId,
    freeDailyNeurons,
  };
}

async function getConfigCloudflareAuth(): Promise<Partial<CloudflareAuth>> {
  const candidates = getGlobalOpencodeConfigCandidatePaths();
  for (const candidate of candidates) {
    const parsed = await readOpencodeConfig(candidate.path, candidate.isJsonc);
    if (!parsed) continue;

    const extracted = extractCloudflareFromConfig(parsed.config);
    if (extracted.accountId || extracted.freeDailyNeurons) {
      return extracted;
    }
  }
  return {};
}

async function readCloudflareAuth(): Promise<CloudflareAuth | null> {
  const [configAuth, authData] = await Promise.all([getConfigCloudflareAuth(), readAuthFile()]);
  const authFileAuth = extractCloudflareFromAuth(authData);
  const envAuth = getEnvCloudflareAuth();

  const apiToken = authFileAuth.apiToken;
  const accountId = envAuth.accountId ?? configAuth.accountId ?? authFileAuth.accountId;
  const freeDailyNeurons =
    envAuth.freeDailyNeurons ??
    configAuth.freeDailyNeurons ??
    authFileAuth.freeDailyNeurons ??
    CLOUDFLARE_DEFAULT_FREE_DAILY_NEURONS;

  if (!apiToken || !accountId) return null;

  return {
    apiToken,
    accountId,
    freeDailyNeurons,
  };
}

function extractUsedNeurons24h(payload: unknown): number {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const viewer = asRecord(data?.viewer);
  const accounts = Array.isArray(viewer?.accounts) ? viewer.accounts : [];
  const firstAccount = asRecord(accounts[0]);
  const groups = Array.isArray(firstAccount?.aiInferenceAdaptiveGroups)
    ? firstAccount.aiInferenceAdaptiveGroups
    : [];

  let total = 0;
  for (const groupRaw of groups) {
    const group = asRecord(groupRaw);
    if (!group) continue;
    const sum = asRecord(group.sum);
    const neuronsValue = sum?.totalNeurons;
    const neurons =
      typeof neuronsValue === "number"
        ? neuronsValue
        : typeof neuronsValue === "string"
          ? Number.parseFloat(neuronsValue)
          : NaN;

    if (Number.isFinite(neurons)) {
      total += Math.max(0, neurons);
    }
  }

  return Math.max(0, total);
}

function extractGraphqlErrors(payload: unknown): string | null {
  const root = asRecord(payload);
  const errors = Array.isArray(root?.errors) ? root.errors : null;
  if (!errors || errors.length === 0) return null;

  const messages = errors
    .map((entry) => {
      const message = asRecord(entry)?.message;
      return getNonEmptyString(message);
    })
    .filter((message): message is string => Boolean(message));

  if (messages.length === 0) return "Cloudflare GraphQL returned errors";
  return `Cloudflare GraphQL error: ${messages.join("; ")}`;
}

export async function hasCloudflareWorkerAiConfigured(): Promise<boolean> {
  const auth = await readCloudflareAuth();
  return auth !== null;
}

export async function queryCloudflareWorkerAiQuota(): Promise<CloudflareWorkerAiResult> {
  const auth = await readCloudflareAuth();
  if (!auth) return null;

  const nowMs = Date.now();
  const startIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const endIso = new Date(nowMs).toISOString();

  const query = `
    query GetAIInferencesCostsGroupByModelsOverTime(
      $accountTag: string!
      $datetimeStart: Time
      $datetimeEnd: Time
    ) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          aiInferenceAdaptiveGroups(
            filter: {
              datetime_geq: $datetimeStart
              datetime_leq: $datetimeEnd
              neurons_geq: 0
              costMetricValue1_geq: 0
              costMetricValue2_geq: 0
            }
            orderBy: [datetimeFifteenMinutes_ASC]
            limit: 10000
          ) {
            sum {
              totalCostMetricValue1
              totalCostMetricValue2
              totalNeurons
            }
            dimensions {
              datetimeFifteenMinutes
              modelId
              costMetricName1
              costMetricName2
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetchWithTimeout(CLOUDFLARE_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.apiToken}`,
        "Content-Type": "application/json",
        "User-Agent": "OpenCode-Quota-Toast/1.0",
      },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: auth.accountId,
          datetimeStart: startIso,
          datetimeEnd: endIso,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        error: `Cloudflare API error ${response.status}: ${sanitizeDisplaySnippet(text, 120)}`,
      };
    }

    const payload = await response.json();
    const graphqlError = extractGraphqlErrors(payload);
    if (graphqlError) {
      return { success: false, error: graphqlError };
    }

    const usedNeurons24h = extractUsedNeurons24h(payload);
    const freeDailyNeurons = auth.freeDailyNeurons;
    const remainingNeurons = Math.max(0, freeDailyNeurons - usedNeurons24h);
    const percentRemaining =
      freeDailyNeurons > 0 ? clampPercent((remainingNeurons / freeDailyNeurons) * 100) : 0;

    return {
      success: true,
      percentRemaining,
      resetTimeIso: getRollingDailyResetIso(nowMs),
      usedNeurons24h,
      freeDailyNeurons,
    };
  } catch (err) {
    return {
      success: false,
      error: sanitizeDisplayText(err instanceof Error ? err.message : String(err)),
    };
  }
}
