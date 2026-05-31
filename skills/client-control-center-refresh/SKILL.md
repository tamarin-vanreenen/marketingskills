---
name: client-control-center-refresh
description: Daily refresh job for the Client Control Center dashboard. Pulls live Google Ads + Meta data from the Campaign Forge MCP for every client account, evaluates the alert rules in control-center/alert-rules.json, writes the refreshed control-center/data/*.json files, commits and pushes them, and sends the alert digest to Slack and email. Use when the user says "refresh the control center", "update client alerts", "run the daily client scan", or when invoked on a schedule.
license: MIT
metadata:
  author: ROI Solutions
  version: 1.0.0
---

# Client Control Center — Daily Refresh

You maintain a multi-client marketing **control center** that monitors every client's Google Ads + Meta accounts via the **Campaign Forge MCP** and raises alerts. This skill is the engine that refreshes it. It is designed to run **once per day on a schedule** (and on demand).

**Scope:** Google Ads + Meta only, via Campaign Forge. Do **not** use the gomarble MCP — it has been intentionally dropped from this workflow.

## Inputs

- `control-center/data/clients.json` — the canonical client roster (account IDs, currency, group).
- `control-center/alert-rules.json` — thresholds and which rules are enabled, plus delivery config.

## Procedure

### 1. Discover accounts
- Call `meta_list_ad_accounts` and `google_ads_list_accounts` (Campaign Forge).
- Reconcile against `clients.json`. If a brand-new account appears, add it to the roster under the best-matching group (match by name). If an account in the roster is gone, mark its platform `status: "removed"`.

### 2. Pull metrics (per account, last_30d)
For each Meta account: `meta_get_campaign_metrics` (date_preset `last_30d`).
For each Google account: `google_ads_get_campaign_metrics`.

> **Context hygiene:** these responses are large. Process **one account at a time** — read the response, compute the aggregates you need, write them, then move on. Do not hold many full responses at once. If a response is too large and is saved to a file, use `jq` to extract only `spend/cost`, `conversions`, `impressions`, `clicks`, `status`, and `dailyBudget` per campaign.

Aggregate per account: total spend, conversions, leads (Meta `lead`/`onsite_web_lead` actions), purchases (Meta `purchase`/`omni_purchase`), clicks, impressions, active campaign count.

### 3. Evaluate alert rules
Read `alert-rules.json` and, for each enabled rule, evaluate against the data:

- **account_health** → `connection_error` (API auth/permission error like 403 USER_PERMISSION_DENIED), `account_disabled` (status not ACTIVE), `no_active_campaigns`.
- **spend_budget** → `spend_spike` / `spend_drop` (vs trailing 7-day average — needs history, see step 5), `budget_capped` (campaign cost ÷ days ≥ threshold_pct of dailyBudget), `monthly_overpacing`.
- **performance** → `zero_conversion_spend` (spend > min_spend and 0 conversions), `cpa_above_average` (campaign CPA > multiple × account's best CPA), `roas_drop`, `ctr_collapse`.
- **data_freshness** → `no_data_window` (no rows > N hours while enabled), `active_not_delivering` (ENABLED/ACTIVE but 0 impressions over the window).

Each alert object must include: `id, clientId, client, platform, account, category, severity, source:"live", title, detail, metric, action, detectedAt` (today's date).

### 4. Write data files
Overwrite:
- `control-center/data/clients.json` — roster with refreshed `metrics` and `status` per platform.
- `control-center/data/alerts.json` — all live alerts (keep a couple of `source:"sample"` cards only if a whole category has zero live alerts, so the UI still demonstrates it).
- `control-center/data/snapshot.json` — `lastRefresh` (now, ISO), `dataRange`, `totals`, `liveSpend` per currency, `alertCounts`.

Keep history for trend rules by appending a compact daily total per account to `control-center/data/history.jsonl` (one JSON line: `{date, accountId, spend, conversions}`). Step 3's spend/ROAS-trend rules read from this file.

### 5. First run vs. ongoing
- On the **first** runs there is < 7 days of history, so `spend_spike`/`spend_drop`/`roas_drop` cannot fire yet — that is expected. Leave the flagged `sample` cards for those categories until history accrues, then drop them.

### 6. Commit & push
Commit the changed `control-center/data/*` files to the working branch with a message like `chore: refresh control center YYYY-MM-DD (N alerts)` and push. Do **not** open a PR.

### 7. Deliver the digest
Read `delivery` in `alert-rules.json`.
- **Slack** (`slack.enabled`): post a summary to `slack.channel` for alerts at or above `slack.min_severity`. Use `slack_send_message`. Format: a header line with counts, then one line per critical/warning alert: `🔴 *Client* — Title (metric)`. Link to the dashboard.
- **Email** (`email.enabled`): send a daily digest to `email.to` via the Gmail MCP (`create_draft` then send, or the send tool) for alerts at/above `email.min_severity`. Subject: `Client Control Center — N alerts (X critical) — YYYY-MM-DD`. Body: grouped by severity.
- Only message channels that are enabled. If there are **zero** new critical/warning alerts, send a one-line "all clear" to Slack and skip email (configurable).

### 8. Report
End with a short summary: accounts refreshed, alerts by severity, and anything that needs human attention (e.g. broken connections).

## Notes
- Currencies differ (ZAR / USD / GBP). Never sum across currencies — report `liveSpend` per currency.
- Be resilient: if one account errors, record an `account_health` alert for it and continue the rest.
- This skill only **reads** ad data and **proposes** nothing — it never changes campaigns.
