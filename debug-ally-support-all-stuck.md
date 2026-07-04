# Debug Session: ally-support-all-stuck
- **Status**: [OPEN]
- **Issue**: `Ally support DMG per country` only starts scanning for `week`; `month/all` stays at `building` with no corresponding runtime logs except `period=week`.
- **Debug Server**: not started
- **Log File**: .dbg/trae-debug-log-ally-support-all-stuck.ndjson

## Reproduction Steps
1. Open the dashboard.
2. Switch to `This month` or `All time`.
3. Observe `building` UI with zero stats.
4. Check server logs: only `support scan start (period=week)` appears.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | `fedPeriod` / polling logic never issues `/api/federationSupport?period=all` after switching away from `week` | High | Low | Pending |
| B | Browser/CDN cache still serves an old `building` payload for `all`, so polling never reaches the server | High | Low | Pending |
| C | The endpoint is called for `all`, but `getFederationSupportData('all')` exits before logging because the background task never starts or is dropped | Med | Med | Pending |
| D | `month -> all` mapping plus shared `useFetch` key / reactive query state prevents a new fetch from being triggered | Med | Med | Pending |
| E | Requests for `all` are being made, but they fail before app-level logging due to routing/proxy/client-side aborts | Low | Med | Pending |

## Log Evidence
- Pending

## Verification Conclusion
- Pending
