# Client Control Center

A live control center for **ROI Solutions / Shift One Digital** that merges every client's **Google Ads + Meta** accounts (via the **Campaign Forge MCP**) into one dashboard with a daily **alert system**.

> Scope is **Google Ads + Meta only**. The gomarble MCP (GA4, LinkedIn, Bing, Klaviyo, Shopify, etc.) was intentionally excluded.

## What it does

- **Roster** of all clients, grouped (Rola Motor Group, Wines U, Property & Lifestyle, Retail & E-commerce, B2B & Tech), each showing its Meta/Google accounts, live spend, conversions and health.
- **Alert Center** across four categories — **Account health, Spend & budget, Performance, Data freshness** — filterable by severity and category, each alert tagged `live` (pulled this run) or `sample` (rule placeholder until history accrues).
- **Per-client drill-down** drawer with account-level metrics and that client's alerts.

## How "live, daily" works

The browser cannot call MCP servers directly, so a **scheduled Claude session** does the work:

```
 ┌─ scheduled trigger (Claude Code on the web) ─────────────────────┐
 │ 1. run skill: client-control-center-refresh (daily | weekly)     │
 │ 2. collect rows from Campaign Forge MCP into build/*.json         │
 │ 3. node build/evaluate.mjs  → data/*.json + standalone.html       │
 │ 4. git commit + push  ──► triggers Pages deploy                  │
 │ 5. send digest to Slack + Gmail (MCP)                            │
 └──────────────────────────────────────────────────────────────────┘
            │
            ▼
  GitHub Pages serves control-center/  ──►  always-current dashboard (shareable link)
```

### Daily vs weekly (how we keep MCP responses small)

A naive campaign-level pull is 60k+ characters per account. So the refresh runs in two modes:

| Mode | Pull | Powers |
|------|------|--------|
| **Daily** | Account-level, **one row per account** (account-level GAQL / Meta `level=account`) | CPA / ROAS / CTR moves, zero-conversion spend, ROAS<1, cost-per-lead vs group, connection health |
| **Weekly** | Campaign-level, **filtered to active + cost>0** | Budget pacing & caps, per-campaign zero-conversion / high-CPA, non-delivery |

Each rule in `alert-rules.json` is tagged with its `cadence`.

- **Engine:** [`skills/client-control-center-refresh/SKILL.md`](../skills/client-control-center-refresh/SKILL.md)
- **Thresholds & delivery config:** [`alert-rules.json`](./alert-rules.json)
- **Hosting:** [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml)

## Files

| File | Purpose |
|------|---------|
| `index.html` | The dashboard (self-contained React via CDN; reads `data/*.json`, or embedded `window.__CC_DATA__`). |
| `standalone.html` | Generated build with data **embedded** — opens offline by double-click, fully clickable. Hand this to anyone. |
| `data/clients.json` | Canonical client roster + latest per-account metrics. |
| `data/alerts.json` | Current alerts. |
| `data/snapshot.json` | Totals, last-refresh timestamp, alert counts. |
| `alert-rules.json` | Rule thresholds, **cadence (daily/weekly)**, + Slack/email delivery config. |
| `build/accounts.live.json` | Collected account-level rows from the latest daily pull. |
| `build/weekly-alerts.json` | Campaign-level alerts from the latest weekly pull. |
| `build/evaluate.mjs` | Evaluator: rows + rules → `data/*.json` + `standalone.html`. |

## Viewing it

**Live (recommended):** once Pages is enabled (Settings → Pages → Source: *GitHub Actions*), the dashboard is at
`https://<owner>.github.io/marketingskills/control-center/` and refreshes whenever the daily job pushes new data.

**Locally / handoff to a developer:** it reads JSON over HTTP, so serve it (don't open as a `file://`):

```bash
cd control-center
npx serve            # or: python3 -m http.server
# open the printed http://localhost:… URL
```

The whole thing is plain React + JSON — drop `index.html` and `data/` straight into the CampaignForge codebase, or paste the JSX from the `<script type="text/babel">` block into a React component if you prefer a build pipeline.

## Setting up the daily schedule

In **Claude Code on the web**, add a scheduled trigger on this repo that runs, each morning:

> Run the `client-control-center-refresh` skill.

That session pulls fresh data, evaluates the rules, pushes the JSON (which redeploys Pages), and sends the Slack + email digest. Tune cadence, thresholds, channel and recipient in `alert-rules.json`.

## Current snapshot

Pulled live from Campaign Forge on **2026-05-31**: **27 clients · 39 ad accounts (35 live, 4 needing MCC manager mapping) · 22 alerts** monitoring **R808k + $27.9k + £3.2k** of 30-day spend. Real signals detected include Heriz Gallery Meta at **0.27 ROAS** (losing money), the **Wines U Google accounts** (Zaccagnini, Saracco, Ruggeri, Brilla) spending with **near-zero conversions**, three **Rola dealers** at >2.5× the group median cost-per-lead, budget-capped Rola Toyota search campaigns, and a non-delivering Rola Toyota Meta campaign.
