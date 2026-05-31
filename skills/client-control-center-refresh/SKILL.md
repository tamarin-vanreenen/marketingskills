---
name: client-control-center-refresh
description: Refresh job for the Client Control Center dashboard. Pulls live Google Ads + Meta data from the Campaign Forge MCP, evaluates the alert rules, regenerates control-center/data/*.json, commits and pushes, and sends the alert digest to Slack and email. Runs in two modes - a cheap DAILY account-level scan (CPA/ROAS/CTR/zero-conversion/health) and a heavier WEEKLY campaign-level scan (pacing, budget caps, per-campaign issues). Use when the user says "refresh the control center", "run the daily client scan", "run the weekly scan", or when invoked on a schedule.
license: MIT
metadata:
  author: ROI Solutions
  version: 2.0.0
---

# Client Control Center — Refresh

You maintain a multi-client **control center** that monitors every client's Google Ads + Meta accounts via the **Campaign Forge MCP** and raises alerts. This skill is the engine that refreshes it.

**Scope:** Google Ads + Meta only, via Campaign Forge. Do **not** use the gomarble MCP — it was intentionally dropped.

## Two cadences (this is how we keep responses small)

Account/campaign metric responses from the MCP are **huge** if pulled naively (a single campaign-level call can be 60k+ characters). So the refresh is split:

| Mode | What it pulls | Size | Powers |
|------|---------------|------|--------|
| **daily** | **Account-level, one row per account** | tiny | CPA / ROAS / CTR moves, zero-conversion spend, ROAS<1, cost-per-lead vs group, connection health |
| **weekly** | **Campaign-level, filtered to active + cost>0** | small | budget pacing/caps, per-campaign zero-conversion, high-CPA campaigns, non-delivery |

Default to **daily**. Run **weekly** mode once a week (e.g. Monday).

### Size-reduction techniques (always apply)
1. **Account-level first.** Google: `google_ads_run_gaql` with `FROM customer` returns ONE row. Meta: `meta_get_insights` with `level="account"` returns ONE row.
2. **Project only needed fields.** Google GAQL: select just `metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks, metrics.impressions, metrics.ctr`. Meta: `fields=["spend","impressions","clicks","ctr","actions","action_values","purchase_roas"]`.
3. **Filter dead rows (weekly).** Campaign-level GAQL: `WHERE campaign.status != 'REMOVED' AND metrics.cost_micros > 0` — drops the dozens of paused R0 campaigns.
4. **Process one account at a time**; never hold many full responses at once.
5. **If a response still spills to a file, use `jq`** to extract only the fields above.

## Procedure

### 1. Discover accounts
`google_ads_list_accounts` + `meta_list_ad_accounts`. Reconcile against `control-center/data/clients.json`. Add brand-new accounts to the roster under the best-matching group; mark missing ones `status:"removed"`.

> **MCC mapping:** some sub-accounts 403 unless the manager id is passed. Pass `manager_id` to `google_ads_run_gaql` (and the login-customer-id for helpers). Maintain the known mapping (e.g. Rola Ford/BYD → `4046222147`). Accounts that still error are recorded as `account_health` alerts, not crashes.

### 2. Collect rows
- **daily:** for each account, pull the account-level row (see techniques 1–2). Write all rows to `control-center/build/accounts.live.json` keyed by `accountId`, shaped like the existing file (`spend, currency, clicks, impressions, ctr, conversions, conversionsValue, leads, purchases, roas`; or `{status:"error", error}`). For Meta, derive `leads` from the `lead`/`onsite_web_lead` action and `purchases` from `purchase`/`omni_purchase`; `roas` from `purchase_roas`.
- **weekly:** additionally pull campaign-level rows (filtered, technique 3), evaluate the weekly rules, and write the resulting alerts to `control-center/build/weekly-alerts.json`.

### 3. Evaluate + regenerate
Run the evaluator — it reads the roster, `accounts.live.json`, `weekly-alerts.json`, `build/budgets.json` and `alert-rules.json`, computes metrics, **joins the budget ledger to compute pacing** (last-30d spend vs monthly budget) and raises over/under-pacing alerts, evaluates the enabled rules for the relevant cadence, and writes `data/clients.json`, `data/alerts.json`, `data/snapshot.json`, and `standalone.html`. New budget entries with a `newClient` (e.g. relinked Rola dealers) are added as pending clients until their account is matched by name to a live account during discovery (step 1):

```bash
node control-center/build/evaluate.mjs
```

This keeps **your** token use low: you collect compact rows; the script does the maths and file writing.

### 4. History for trend rules
Append one compact line per account to `control-center/build/history.jsonl` (`{date, accountId, spend, conversions}`). The `spend_spike`/`spend_drop`/`roas_drop`/`cpa_spike` rules read this. On the first <7 days there isn't enough history for those rules to fire — that's expected.

### 5. Commit & push
Commit the changed `control-center/**` files: `chore: refresh control center YYYY-MM-DD (N alerts)`. Push to the working branch. The Pages workflow redeploys automatically. Do **not** open a PR.

### 6. Deliver the digest
Read `delivery` in `alert-rules.json`.
- **Slack** (`slack.enabled`): post to `slack.channel` for alerts ≥ `slack.min_severity` using `slack_send_message`. Header with counts, then one line per critical/warning alert: `🟠 *Client* — Title (metric)`. Link to the dashboard.
- **Email** (`email.enabled`): daily digest to `email.to` via the Gmail MCP for alerts ≥ `email.min_severity`. Subject: `Client Control Center — N alerts (X critical) — YYYY-MM-DD`, body grouped by severity.
- If there are zero new critical/warning alerts, send a one-line "all clear" to Slack and skip email.

### 7. Report
End with a short summary: accounts refreshed, alerts by severity, and anything needing a human (broken connections, ROAS<1, runaway CPA).

## Notes
- Currencies differ (ZAR / USD / GBP). Never sum across currencies — `snapshot.liveSpend` is per-currency.
- Be resilient: if one account errors, record an `account_health` alert and continue.
- Read-only: this skill never changes campaigns; it only reports.
