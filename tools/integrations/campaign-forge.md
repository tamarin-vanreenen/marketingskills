# Campaign Forge

Cross-platform paid media and analytics MCP server. Unifies Google Ads, Meta, LinkedIn, and GA4 behind a single connector, adding audit and diagnostic tools for performance analysis across channels. Read-and-analyze focused, with organisation-scoped access.

## Capabilities

| Integration | Available | Notes |
|-------------|-----------|-------|
| API | - | Not exposed directly — access is via MCP |
| MCP | ✓ | Full read + audit via Claude connector |
| CLI | - | Not available |
| SDK | - | Not available |

## Authentication

- **Type**: OAuth2 (via MCP connector)
- **Setup**: Connect via the Claude MCP connector — no API key management needed
- **Scope**: All data is scoped to the authenticated organisation and its connected ad/analytics accounts
- **Connection check**: Use `platform_connection_status` to verify which platforms (Google Ads, Meta, LinkedIn, GA4) are connected before running reports

## Usage Pattern

Campaign Forge exposes tools across five namespaces plus compound audit tools. **Always call the `readme` tool first** — it returns a decision map that routes you to the exact tool for the task. Then call the sub-server readmes (`google_ads_readme`, `meta_readme`, `linkedin_readme`, `ga4_readme`, `audit_readme`) for full parameter details. This keeps context usage minimal.

```
readme                 # decision map — call first
google_ads_readme      # per-platform parameter details
meta_readme
linkedin_readme
ga4_readme
audit_readme
```

## Common Agent Operations

All operations are performed via MCP tools. Namespaced by platform.

### Google Ads

```
google_ads_list_accounts
google_ads_list_campaigns
google_ads_get_campaign_metrics
google_ads_get_ad_group_metrics
google_ads_get_ad_performance
google_ads_get_keyword_performance
google_ads_get_search_terms_report
google_ads_get_auction_insights
google_ads_get_audience_insights
google_ads_get_budget_utilization
google_ads_get_change_logs
google_ads_get_extensions
google_ads_list_conversion_actions
google_ads_run_keyword_planner
google_ads_run_gaql        # raw GAQL query for anything not covered above
```

### Meta (Facebook / Instagram Ads)

```
meta_list_ad_accounts
meta_get_account_info
meta_get_campaigns / meta_get_campaign_details / meta_get_campaign_metrics
meta_get_adsets / meta_get_adset_details
meta_get_ads / meta_get_ad_details / meta_get_ad_creatives
meta_get_insights / meta_bulk_get_insights / meta_async_get_insights
meta_get_custom_audiences / meta_estimate_audience_size
meta_get_pixel_status
meta_search_interests / meta_search_behaviors / meta_search_demographics / meta_search_geo_locations
meta_get_interest_suggestions
```

### LinkedIn Ads

```
linkedin_list_ad_accounts / linkedin_get_account_info / linkedin_get_account_metrics
linkedin_get_campaigns / linkedin_get_campaign_metrics
linkedin_list_campaign_groups / linkedin_get_campaign_group_metrics
linkedin_list_creatives / linkedin_get_creative_metrics
linkedin_get_analytics
linkedin_get_budget_utilization
```

### GA4

```
ga4_list_properties / ga4_get_properties / ga4_get_property_info
ga4_run_report            # dimensions + metrics report against a GA4 property
```

### Audit & Diagnostics (compound tools)

```
diagnose_performance_drop      # cross-platform: explains why performance changed
compare_creative_performance   # rank/compare creatives across a channel
```

### Organisation Management

```
list_organisations / create_organisation
list_organisation_members / add_organisation_member
```

## When to Use

- Pulling paid media performance across Google Ads, Meta, and LinkedIn from one place
- Cross-channel spend and budget pacing checks (`*_get_budget_utilization`)
- Diagnosing a drop in conversions or ROAS (`diagnose_performance_drop`)
- Comparing ad creative performance to decide what to scale or cut (`compare_creative_performance`)
- Blending ad-platform data with GA4 site behavior for full-funnel analysis
- Keyword and audience research (Google keyword planner, Meta interest/behavior search)

## Campaign Forge vs. Other Options

| Scenario | Use |
|----------|-----|
| Read metrics across Google Ads + Meta + LinkedIn + GA4 in one connector | **Campaign Forge** |
| Diagnose a cross-channel performance drop | **Campaign Forge** (`diagnose_performance_drop`) |
| Deep single-platform Google Ads work with CLI/scripts | [google-ads.md](google-ads.md) |
| Deep single-platform GA4 reporting | [ga4.md](ga4.md) |
| MCP access to many non-ad OAuth tools (Slack, Sheets, HubSpot) | [composio.md](composio.md) |
| Scheduled data pipelines into sheets/BI | [supermetrics.md](supermetrics.md), [coupler.md](coupler.md) |

## Rate Limits

- Rate limits are managed by the MCP connector and the underlying ad-platform APIs
- Meta insights for large accounts may return via the async variant (`meta_async_get_insights`) — poll for completion
- All data scoped to the authenticated organisation

## Relevant Skills

- paid-ads
- ad-creative
- ab-test-setup
- analytics-tracking
- competitor-alternatives
