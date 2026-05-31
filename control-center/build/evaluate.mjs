#!/usr/bin/env node
// Control Center evaluator.
// Reads the collected account rows + roster + rules, computes per-account metrics,
// evaluates the alert rules, and (re)writes data/clients.json, data/alerts.json,
// data/snapshot.json, and a self-contained standalone.html.
//
// Usage:  node build/evaluate.mjs
// The daily refresh skill pulls rows into build/accounts.live.json, then runs this.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));

const roster = read("data/clients.json");
const live = read("build/accounts.live.json").accounts;
const weekly = read("build/weekly-alerts.json").alerts;
const rules = read("alert-rules.json");
const budgets = read("build/budgets.json").entries;

const TODAY = "2026-05-31";
// zero-conversion spend thresholds by currency (account spend over the window)
const ZERO_CONV_MIN = { USD: 300, ZAR: 2000, GBP: 250 };
const ZERO_CONV_MIN_META_INFO = { USD: 1000, ZAR: 6000, GBP: 800 };

const num = (v) => (v == null ? null : Number(v));
const round = (v, d = 2) => (v == null ? null : Number(v.toFixed(d)));

// Date ranges shown in the UI. 'mtd' uses the 30-day pull (≈ month-to-date at
// month-end); 'last_7d' uses the 7-day pull. The daily job can add a true
// this_month pull later without code changes (just add a source here).
const sevenDay = read("build/accounts.7d.json").accounts;
const RANGES = { mtd: live, last_7d: sevenDay };
const RANGE_META = [
  { id: "mtd", label: "Month-to-date" },
  { id: "last_7d", label: "Last 7 days" },
];

function computeMetrics(row) {
  const conv = num(row.conversions), leads = num(row.leads), purch = num(row.purchases);
  const totalConv = (conv || 0) + (leads || 0) + (purch || 0);
  let roas = num(row.roas);
  if (roas == null && row.conversionsValue != null && row.conversionsValue > row.spend) {
    roas = round(row.conversionsValue / row.spend);
  }
  const cpa = totalConv > 0 ? round(row.spend / totalConv) : null;
  const m = {
    spend: round(row.spend), currency: row.currency,
    clicks: num(row.clicks), impressions: num(row.impressions), ctr: num(row.ctr),
    conversions: conv, leads, purchases: purch, cpa, roas,
  };
  for (const k of Object.keys(m)) if (m[k] == null) delete m[k];
  return m;
}

// ---- 1. Attach per-range metrics + status to each platform ---------------
for (const c of roster.clients) {
  for (const p of c.platforms) {
    const mtdRow = live[p.accountId];
    if (!mtdRow) p.status = "pending";
    else if (mtdRow.status === "error") { p.status = "error"; p.error = mtdRow.error; }
    else p.status = "live";

    p.metricsByRange = {};
    for (const [rid, src] of Object.entries(RANGES)) {
      const row = src[p.accountId];
      if (row && row.status !== "error" && row.spend != null) p.metricsByRange[rid] = computeMetrics(row);
    }
    if (Object.keys(p.metricsByRange).length === 0) delete p.metricsByRange;
    // alias mtd metrics for the alert rules below (which read p.metrics)
    if (p.metricsByRange && p.metricsByRange.mtd) p.metrics = p.metricsByRange.mtd;
    else delete p.metrics;
  }
}

// ---- 1b. Merge budget ledger onto clients (+ create budget-only clients) -
const byId = new Map(roster.clients.map((c) => [c.id, c]));
for (const e of budgets) {
  // idempotent: match by clientId, else by an already-created newClient id
  let c = e.clientId ? byId.get(e.clientId) : (e.newClient ? byId.get(e.newClient.id) : null);
  if (!c && e.newClient) {
    // budget-only client awaiting account link on the next live refresh
    const platforms = [...new Set(e.lines.map((l) => l.platform))].map((platform) => ({
      platform, accountName: "Pending account link", accountId: "—", status: "pending",
    }));
    c = { ...e.newClient, currency: e.currency, platforms };
    roster.clients.push(c); byId.set(c.id, c);
  }
  if (!c) continue;
  c.category = e.category;
  c.budget = {
    currency: e.currency,
    monthly: round(e.lines.reduce((s, l) => s + l.amount, 0)),
    lines: e.lines,
  };
  // pacing per range: mtd vs monthly budget; last_7d vs pro-rata weekly target.
  c.budget.pacingByRange = {};
  for (const rid of Object.keys(RANGES)) {
    const liveSpend = c.platforms
      .filter((p) => p.metricsByRange?.[rid]?.currency === e.currency)
      .reduce((s, p) => s + p.metricsByRange[rid].spend, 0);
    const hasLive = c.platforms.some((p) => p.metricsByRange?.[rid]);
    const target = rid === "last_7d" ? (c.budget.monthly / 30) * 7 : c.budget.monthly;
    c.budget.pacingByRange[rid] = hasLive
      ? { spend: round(liveSpend), target: round(target), pct: Math.round((liveSpend / target) * 100), hasLive: true }
      : { hasLive: false };
  }
  c.budget.pacing = c.budget.pacingByRange.mtd; // alert rules read mtd pacing
}

// ---- 2. Evaluate daily (account-level) rules -----------------------------
const alerts = [];
const add = (a) => alerts.push({ source: "live", cadence: "daily", detectedAt: TODAY, ...a });
const clientHasLive = (c) => c.platforms.some((p) => p.status === "live");

for (const c of roster.clients) {
  // Rola dealer group median CPA (Meta, lead-gen) — computed once below.
  for (const p of c.platforms) {
    const plat = p.platform === "meta" ? "Meta" : "Google Ads";
    // account_health: connection error
    if (p.status === "error") {
      add({
        id: `a-${c.id}-${p.platform}-conn`, clientId: c.id, client: c.name, platform: p.platform, account: p.accountId,
        category: "account_health", severity: clientHasLive(c) ? "info" : "warning",
        title: "Account not pulling — manager login mapping needed",
        detail: `${plat} account ${p.accountId} returned a permission error on the account-level query. It needs the correct MCC manager login-customer-id mapping in Campaign Forge to collect data automatically.`,
        metric: "USER_PERMISSION_DENIED", action: "Map this account to its MCC manager id in the refresh config.",
      });
      continue;
    }
    if (p.status !== "live") continue;
    const m = p.metrics;
    const totalConv = (m.conversions || 0) + (m.leads || 0) + (m.purchases || 0);
    const hasCustom = live[p.accountId].customConvValue != null;

    // performance: zero-conversion spend
    if (totalConv === 0 && !hasCustom) {
      if (p.platform === "google" && m.spend >= (ZERO_CONV_MIN[m.currency] ?? 300)) {
        add({
          id: `a-${c.id}-g-zeroconv`, clientId: c.id, client: c.name, platform: p.platform, account: p.accountId,
          category: "performance", severity: "warning",
          title: "Search spend with zero conversions",
          detail: `${plat} spent ${m.currency} ${m.spend.toLocaleString()} over 30 days with 0 conversions (${(m.clicks||0).toLocaleString()} clicks). Paid search should be converting.`,
          metric: `${m.currency} ${m.spend.toLocaleString()} · 0 conv`, action: "Audit conversion tracking, search terms and landing pages, or pause.",
        });
      } else if (p.platform === "meta" && m.spend >= (ZERO_CONV_MIN_META_INFO[m.currency] ?? 1000)) {
        add({
          id: `a-${c.id}-m-noconv`, clientId: c.id, client: c.name, platform: p.platform, account: p.accountId,
          category: "performance", severity: "info",
          title: "Meta running engagement/traffic only — no lead/purchase tracked",
          detail: `${plat} spent ${m.currency} ${m.spend.toLocaleString()} with no lead or purchase conversions recorded. Confirm this is an intentional brand/engagement objective and that a conversion campaign + pixel exist.`,
          metric: `${m.currency} ${m.spend.toLocaleString()} · 0 conv`, action: "Confirm objective is intentional; verify pixel/conversion setup.",
        });
      }
    }

    // performance: ROAS below 1 on an e-commerce/purchase account
    if (m.purchases > 0 && m.roas != null && m.roas < 1) {
      add({
        id: `a-${c.id}-${p.platform}-roas`, clientId: c.id, client: c.name, platform: p.platform, account: p.accountId,
        category: "performance", severity: "warning",
        title: "ROAS below 1.0 — spending more than it returns",
        detail: `${plat} is at ${m.roas} ROAS (${m.currency} ${m.spend.toLocaleString()} spend for ${m.currency} ${(live[p.accountId].conversionsValue||0).toLocaleString()} revenue, ${m.purchases} purchases). The account is losing money at the current setup.`,
        metric: `${m.roas} ROAS · ${m.purchases} purchases`, action: "Review targeting, creative and product margins; pause unprofitable campaigns.",
      });
    }

    // performance: meaningful spend, very few conversions at very high CPA
    if (totalConv > 0 && totalConv < 5 && p.platform === "google" && m.spend >= (ZERO_CONV_MIN[m.currency] ?? 300) && m.cpa != null) {
      add({
        id: `a-${c.id}-g-highcpa`, clientId: c.id, client: c.name, platform: p.platform, account: p.accountId,
        category: "performance", severity: "warning",
        title: "Near-zero conversions at very high CPA",
        detail: `${plat} spent ${m.currency} ${m.spend.toLocaleString()} for only ${totalConv} conversion(s) — a CPA of ${m.currency} ${m.cpa.toLocaleString()}. Effectively not converting.`,
        metric: `${m.currency} ${m.cpa.toLocaleString()} CPA · ${totalConv} conv`, action: "Check tracking and keyword intent; pause if genuinely non-converting.",
      });
    }
  }
}

// ---- 2b. Rola dealer group: cost-per-lead vs group median ----------------
const rolaLeadCPAs = [];
for (const c of roster.clients) {
  if (c.group !== "Rola Motor Group") continue;
  const meta = c.platforms.find((p) => p.platform === "meta" && p.status === "live" && p.metrics.leads > 0);
  if (meta) rolaLeadCPAs.push({ c, meta, cpa: meta.metrics.cpa });
}
if (rolaLeadCPAs.length >= 4) {
  const sorted = [...rolaLeadCPAs].sort((a, b) => a.cpa - b.cpa);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid].cpa : (sorted[mid - 1].cpa + sorted[mid].cpa) / 2;
  for (const { c, meta, cpa } of rolaLeadCPAs) {
    if (cpa > median * 2.2) {
      add({
        id: `a-${c.id}-cplgroup`, clientId: c.id, client: c.name, platform: "meta", account: meta.accountId,
        category: "performance", severity: "warning",
        title: "Cost per lead well above dealer-group median",
        detail: `${c.name} Meta is at R${cpa.toLocaleString()} per lead vs the Rola dealer-group median of R${Math.round(median).toLocaleString()} (>${(cpa/median).toFixed(1)}×). ${meta.metrics.leads} leads for R${meta.metrics.spend.toLocaleString()}.`,
        metric: `R${cpa.toLocaleString()} CPL vs R${Math.round(median).toLocaleString()} median`,
        action: "Compare creative/targeting/forms against the best-performing Rola dealers.",
      });
    }
  }
}

// ---- 2c. Pacing alerts (budget vs live spend) ----------------------------
const over = rules.categories.spend_budget.rules.find((r) => r.id === "monthly_overpacing")?.threshold_pct ?? 110;
for (const c of roster.clients) {
  const b = c.budget;
  if (!b || !b.pacing || !b.pacing.hasLive) continue;
  const pct = b.pacing.pct;
  const cur = b.currency;
  const fmtB = `${cur} ${b.pacing.spend.toLocaleString()} / ${cur} ${b.monthly.toLocaleString()} (${pct}%)`;
  if (pct >= over) {
    alerts.push({
      source: "live", cadence: "weekly", detectedAt: TODAY,
      id: `a-${c.id}-overpacing`, clientId: c.id, client: c.name, platform: "—", account: "budget",
      category: "spend_budget", severity: "warning",
      title: "Overpacing budget", detail: `Last-30d spend is at ${pct}% of the monthly budget. ${fmtB}.`,
      metric: fmtB, action: "Confirm the overspend is intentional or pull back daily budgets.",
    });
  } else if (pct < 60) {
    alerts.push({
      source: "live", cadence: "weekly", detectedAt: TODAY,
      id: `a-${c.id}-underpacing`, clientId: c.id, client: c.name, platform: "—", account: "budget",
      category: "spend_budget", severity: "info",
      title: "Underpacing budget", detail: `Last-30d spend is only ${pct}% of the monthly budget. ${fmtB}. Budget may be under-delivering.`,
      metric: fmtB, action: "Check delivery / approvals; reallocate or raise bids if intentional headroom.",
    });
  }
}

// ---- 3. Merge weekly campaign-level alerts -------------------------------
for (const w of weekly) alerts.push(w);

// severity ordering for stable output
const SEV = { critical: 0, warning: 1, info: 2 };
alerts.sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.clientId.localeCompare(b.clientId));

// ---- 4. Snapshot ---------------------------------------------------------
const flatPlatforms = roster.clients.flatMap((c) => c.platforms);
const byCurrency = {};
for (const p of flatPlatforms) {
  if (p.status === "live") byCurrency[p.metrics.currency] = (byCurrency[p.metrics.currency] || 0) + p.metrics.spend;
}
const curLabel = { ZAR: "South Africa & UK clients", USD: "International (Wines U)", GBP: "UK" };
const liveSpendForRange = (rid) => {
  const acc = {};
  for (const p of flatPlatforms) {
    const m = p.metricsByRange?.[rid];
    if (m) acc[m.currency] = (acc[m.currency] || 0) + m.spend;
  }
  return Object.entries(acc).map(([currency, spend]) => ({
    currency, spend: round(spend), label: curLabel[currency] || currency,
  })).sort((a, b) => b.spend - a.spend);
};
const snapshot = {
  agency: "ROI Solutions / Shift One Digital",
  lastRefresh: new Date("2026-05-31T06:30:00Z").toISOString(),
  refreshWindow: "last_30d",
  dataRange: { start: "2026-05-01", end: "2026-05-30" },
  source: "Campaign Forge MCP (Google Ads + Meta) · account-level daily + campaign-level weekly",
  totals: {
    clients: roster.clients.length,
    adAccounts: flatPlatforms.length,
    platforms: 2,
    accountsLive: flatPlatforms.filter((p) => p.status === "live").length,
    accountsPending: flatPlatforms.filter((p) => p.status === "pending").length,
    accountsError: flatPlatforms.filter((p) => p.status === "error").length,
  },
  ranges: RANGE_META,
  liveSpend: liveSpendForRange("mtd"),
  liveSpendByRange: { mtd: liveSpendForRange("mtd"), last_7d: liveSpendForRange("last_7d") },
  monthlyBudget: Object.entries(
    roster.clients.reduce((acc, c) => {
      if (c.budget) acc[c.budget.currency] = (acc[c.budget.currency] || 0) + c.budget.monthly;
      return acc;
    }, {})
  ).map(([currency, amount]) => ({ currency, amount: round(amount) })).sort((a, b) => b.amount - a.amount),
  alertCounts: {
    critical: alerts.filter((a) => a.severity === "critical").length,
    warning: alerts.filter((a) => a.severity === "warning").length,
    info: alerts.filter((a) => a.severity === "info").length,
    total: alerts.length,
  },
};

// ---- 5. Write data files -------------------------------------------------
const write = (p, obj) => fs.writeFileSync(path.join(root, p), JSON.stringify(obj, null, 2) + "\n");
write("data/clients.json", roster);
write("data/alerts.json", { alerts });
write("data/snapshot.json", snapshot);

// ---- 6. Build standalone.html (data embedded) ----------------------------
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const embed = `<script>window.__CC_DATA__=${JSON.stringify({ snapshot, clients: roster, alerts: { alerts } })};</script>`;
fs.writeFileSync(path.join(root, "standalone.html"), indexHtml.replace("</head>", embed + "\n</head>"));

console.log(`Wrote ${roster.clients.length} clients, ${flatPlatforms.filter(p=>p.status==='live').length} live accounts, ${alerts.length} alerts (` +
  `${snapshot.alertCounts.critical}C/${snapshot.alertCounts.warning}W/${snapshot.alertCounts.info}I).`);
console.log("Live spend:", snapshot.liveSpend.map(s => `${s.currency} ${s.spend.toLocaleString()}`).join(" · "));
