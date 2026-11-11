# Enterprise Gap Analysis (vs Genesys / Amazon Connect / Zoom CC / NICE patterns)

## 1. Decisions needed from the owner (business policy — not taken by engineering)
1. **Multi-tenancy (ARCH-1).** Option A: one deployment per customer (current model, fs-cp Docker images) — no schema change. Option B: shared multi-tenant — `tenant_id` on every table, tenant-scoped JWT, row-level filtering, migration of existing data. B is a large irreversible schema decision.
2. **Service level definition.** Threshold (e.g. 80/20) and whether short abandons (< N s) are excluded — required before SLA reporting is called "accurate".
3. **Disposition codes** — free list per queue or global? Mandatory before going Ready?
4. **Recording** — record all / per queue / on demand; who may listen (new permission).

## 2. Gaps by area (prioritised)
| Area | Gap | Native in FreeSWITCH? | Priority |
|---|---|---|---|
| Security | helmet headers, JSON size limit, token storage (SEC-6/7) | n/a | P2 |
| Agent | wrap-up timer + disposition | `wrap-up-time` per agent exists in mod_callcenter; disposition is app-level | P2 |
| Voice | conference (C1), recording + playback permissions | yes (`conference`, `record_session`) | P2 |
| Supervisor | listen / whisper / barge | yes (`eavesdrop` app with DTMF modes) | P2 |
| Routing | business hours + holidays, overflow, callback | partially (dialplan time conditions); callback is app-level | P2 |
| Reporting | KPI formula register, SLA, transfer report | data partly in `calls` | P2 |
| Admin | audit log UI | data exists | P3 |
| Quality | admin portal tests, E2E | n/a | P2 |
| Omnichannel | interaction table + channel adapter layer | n/a | P3 (architecture only, no fake channels) |

## 3. Omnichannel foundation (planned, not built)
`interactions(id, channel, direction, status, customer_ref, queue, agent_id, started_at, ended_at, meta jsonb)` with voice calls linked by `call_uuid`; channel adapters (voice = existing ESL) publish into one interaction service; agent desktop already renders through an interaction abstraction (`interactions/correlate.js`).
