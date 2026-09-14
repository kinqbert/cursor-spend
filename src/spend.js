import { loadSessionCookie } from "./auth.js";
import { SpendError } from "./errors.js";

export { SpendError };

const API = "https://cursor.com";

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function request(cookie, method, path, body) {
  const headers = {
    Cookie: cookie,
    Accept: "application/json",
  };
  if (method !== "GET") {
    headers.Origin = "https://cursor.com";
    headers.Referer = "https://cursor.com/dashboard/usage";
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await parseBody(response);
  if (!response.ok) throw new SpendError(response.status, json);
  return json;
}

const getJson = (cookie, path) => request(cookie, "GET", path);
const postJson = (cookie, path, body) => request(cookie, "POST", path, body);

function cents(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dollars(valueCents) {
  return cents(valueCents) / 100;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

/** Cursor returns cycle bounds as ISO strings, epoch ms, epoch seconds, or numeric strings. */
export function toMs(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "object") {
    const seconds = firstDefined(value.seconds, value._seconds, value.epochSeconds);
    if (seconds != null) return toMs(Number(seconds) * 1000);
    return toMs(firstDefined(value.value, value.iso, value.date, value.ms, value.timestamp));
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return null;
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+(\.\d+)?$/.test(trimmed)) return toMs(Number(trimmed));
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toIso(value) {
  const ms = toMs(value);
  return ms == null ? null : new Date(ms).toISOString();
}

function pickDate(...candidates) {
  for (const candidate of candidates) {
    const iso = toIso(candidate);
    if (iso) return iso;
  }
  return null;
}

function modelsFromAggregated(data) {
  const rows = data?.aggregations ?? data?.aggregatedUsageEvents ?? data?.usageEvents ?? [];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const tokens = row.tokenUsage ?? {};
      return {
        model: row.model ?? row.modelIntent ?? "unknown",
        requests: firstDefined(row.numRequests, row.count, row.requests),
        inputTokens: cents(firstDefined(row.inputTokens, tokens.inputTokens)),
        outputTokens: cents(firstDefined(row.outputTokens, tokens.outputTokens)),
        cacheReadTokens: cents(firstDefined(row.cacheReadTokens, tokens.cacheReadTokens)),
        cacheWriteTokens: cents(firstDefined(row.cacheWriteTokens, tokens.cacheWriteTokens)),
        totalCents: cents(firstDefined(row.totalCents, tokens.totalCents, row.chargedCents)),
      };
    })
    .map((row) => ({ ...row, totalDollars: dollars(row.totalCents) }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

export function formatUsd(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export async function fetchPersonalSpend() {
  const { cookie } = await loadSessionCookie();
  const me = await getJson(cookie, "/api/auth/me");
  if (!me || (me.id == null && !me.email)) {
    throw new SpendError(401, { message: "Cursor session did not return an identity" });
  }
  const summary = await getJson(cookie, "/api/usage-summary");

  let period = null;
  try {
    period = await postJson(cookie, "/api/dashboard/get-current-period-usage", {});
  } catch {
    try {
      period = await postJson(cookie, "/api/dashboard/get-current-period-usage", { teamId: 0 });
    } catch {
      period = null;
    }
  }

  let usage = null;
  try {
    const user = encodeURIComponent(me.sub ?? me.id);
    usage = await getJson(cookie, `/api/usage?user=${user}`);
  } catch {
    usage = null;
  }

  const cycleStart = pickDate(
    period?.billingCycleStart,
    period?.billingCycleStartMs,
    period?.startDate,
    summary.billingCycleStart,
    summary.startOfMonth,
    usage?.startOfMonth,
  );
  const cycleEnd = pickDate(
    period?.billingCycleEnd,
    period?.billingCycleEndMs,
    period?.endDate,
    summary.billingCycleEnd,
  );
  const startMs = toMs(cycleStart) ?? Date.now();
  const endMs = toMs(cycleEnd) ?? Date.now();

  let aggregated = null;
  try {
    aggregated = await postJson(cookie, "/api/dashboard/get-aggregated-usage-events", {
      teamId: 0,
      startDate: String(startMs),
      endDate: String(endMs),
      userId: me.id,
    });
  } catch {
    aggregated = null;
  }

  const planUsage = period?.planUsage ?? {};
  const onDemand = summary.individualUsage?.onDemand ?? {};
  const spendLimit = period?.spendLimitUsage ?? {};

  const includedCents = cents(firstDefined(planUsage.includedSpend, planUsage.includedSpendCents));
  const bonusCents = cents(firstDefined(planUsage.bonusSpend, planUsage.bonusSpendCents));
  const planTotalCents = cents(firstDefined(planUsage.totalSpend, planUsage.totalSpendCents));
  const planLimitCents = cents(firstDefined(planUsage.limit, planUsage.limitCents));
  const onDemandCents = cents(
    firstDefined(onDemand.used, spendLimit.individualUsed, spendLimit.pooledUsed),
  );
  const onDemandLimitCents = firstDefined(onDemand.limit, spendLimit.pooledLimit);
  const models = modelsFromAggregated(aggregated);
  const modelsCents = models.reduce((sum, row) => sum + row.totalCents, 0);

  return {
    fetchedAt: new Date().toISOString(),
    you: {
      email: me.email ?? null,
      name: me.name ?? me.email ?? null,
      id: me.id ?? null,
    },
    membershipType: summary.membershipType ?? null,
    cycleStart: cycleStart ?? null,
    cycleEnd: cycleEnd ?? null,
    messages: {
      auto: summary.autoModelSelectedDisplayMessage ?? null,
      api: summary.namedModelSelectedDisplayMessage ?? null,
    },
    plan: {
      includedCents,
      bonusCents,
      totalCents: planTotalCents,
      limitCents: planLimitCents,
      includedDollars: dollars(includedCents),
      bonusDollars: dollars(bonusCents),
      totalDollars: dollars(planTotalCents),
      limitDollars: dollars(planLimitCents),
      autoPercentUsed: planUsage.autoPercentUsed ?? summary.individualUsage?.plan?.autoPercentUsed ?? null,
      apiPercentUsed: planUsage.apiPercentUsed ?? summary.individualUsage?.plan?.apiPercentUsed ?? null,
      totalPercentUsed: planUsage.totalPercentUsed ?? summary.individualUsage?.plan?.totalPercentUsed ?? null,
    },
    onDemand: {
      enabled: onDemand.enabled !== false,
      usedCents: onDemandCents,
      usedDollars: dollars(onDemandCents),
      limitCents: onDemandLimitCents == null ? null : cents(onDemandLimitCents),
      limitDollars: onDemandLimitCents == null ? null : dollars(onDemandLimitCents),
    },
    models,
    modelsTotalDollars: dollars(modelsCents),
  };
}
