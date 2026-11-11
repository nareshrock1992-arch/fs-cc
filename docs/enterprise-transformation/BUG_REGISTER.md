# Bug Register

| ID | Found | Area | Symptom | Root cause | Fix | Status |
|---|---|---|---|---|---|---|
| BUG-001 | 2026-11-11 baseline | backend tests | `queuesRbac` test 27 fails | shared `mockQuery` not cleared between tests | `mockQuery.mockClear()` in that `beforeEach` | FIXED |
| BUG-002 | 2026-11-11 audit | agent desktop | after a socket reconnect the agent stops receiving targeted events | `agent:authenticate` sent once; rooms are per connection | token remembered in memory, re-sent on every connect; cleared on logout | FIXED (runtime NOT VERIFIED) |
| BUG-003 | 2026-11-11 audit | admin portal | supervisor socket authenticated only on (re)connect, not after login | auth tied to `connect` only | `cc-token-changed` event after `setToken` | FIXED (runtime NOT VERIFIED) |

Security defects: SEC-1…SEC-7 in `MASTER_TASK_TRACKER.md`.
