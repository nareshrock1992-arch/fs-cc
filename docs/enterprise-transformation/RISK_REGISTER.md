# Risk Register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | SEC-1 breaks a client that used an agent token on `/api/*` | low (agent desktop uses `/api/agent-desk/*` only — checked `agent-desktop/src/api/client.js`) | agent desktop errors 403 | revert one hunk in `middleware/auth.js` |
| R-2 | SEC-3: a client that never authenticates its socket loses live updates | medium — any third-party wallboard reading the socket anonymously | empty live pages | both first-party clients updated (BUG-002/003); verify live pages after deploy |
| R-3 | login limiter blocks a whole office behind one proxy IP | low: key = IP **and** login name | one user locked 15 min | successful login clears; restart clears memory |
| R-4 | single-tenant schema hard to retrofit | high if CCaaS | large migration | owner decision ARCH-1 before more schema work |
| R-5 | live DEV and test copy share PostgreSQL + FreeSWITCH host | — | test damage to DEV | tests are mocked; no test DB created without approval |
