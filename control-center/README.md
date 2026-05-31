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
 ┌─ daily trigger (Claude Code on the web) ─────────────────────────┐
 │ 1. run skill: client-control-center-refresh                      │
 │ 2. pull Google Ads + Meta data from Campaign Forge MCP           │
 │ 3. evaluate alert-rules.json                                     │
 │ 4. write control-center/data/{clients,alerts,snapshot}.json      │
 │ 5. git commit + push  ──► triggers Pages deploy                  │
 │ 6. send digest to Slack + Gmail (MCP)                            │
 └──────────────────────────────────────────────────────────────────┘
            │
            ▼
  GitHub Pages serves control-center/  ──►  always-current dashboard (shareable link)
```

- **Engine:** [`skills/client-control-center-refresh/SKILL.md`](../skills/client-control-center-refresh/SKILL.md)
- **Thresholds & delivery config:** [`alert-rules.json`](./alert-rules.json)
- **Hosting:** [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml)

## Files

| File | Purpose |
|------|---------|
| `index.html` | The dashboard (self-contained React via CDN; reads `data/*.json`). |
| `data/clients.json` | Canonical client roster + latest per-account metrics. |
| `data/alerts.json` | Current alerts. |
| `data/snapshot.json` | Totals, last-refresh timestamp, alert counts. |
| `alert-rules.json` | Rule thresholds + Slack/email delivery config. |

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

## Seed data

The committed snapshot was pulled live from Campaign Forge on **2026-05-31** for the flagship/multi-platform clients (Bloomable, Brilla, Computer Mania, Rola Toyota, Heriz Gallery, Oasis). Other accounts show `pending` until the first full scheduled run fills them in. Real alerts already detected include a broken Bloomable Google Ads connection, zero-conversion spend and high CPAs on Heriz Gallery, budget-capped Rola Toyota search campaigns, and a non-delivering Rola Toyota Meta campaign.
