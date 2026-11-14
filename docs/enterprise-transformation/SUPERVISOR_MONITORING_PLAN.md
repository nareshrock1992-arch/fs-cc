# Supervisor Listen / Whisper / Barge — Plan (SUP-1, for approval)

## 1. What exists today (checked 2026-11-14, read-only)
- FreeSWITCH `dialplan/default.xml` (stock examples, still enabled):
  - `88xxxx` / `*0xxxx` → `eavesdrop` on a call found by extension (spymap).
  - **`779` → `eavesdrop all`: any registered phone can listen to every live call.**
- No backend API, no permission check, no audit log. FS-CC never uses these extensions.

## 2. Security finding first (SEC-8, P1)
Any agent (or anyone with any SIP extension) can dial **779** and silently listen to customer calls. No log in FS-CC.
- Fix (needs owner approval: it changes FreeSWITCH configuration): disable the `779` and `88xxxx / *0` example extensions (back up `default.xml`, comment them out, `reloadxml`).
- After that, listening is possible **only** through FS-CC (section 3), which checks the role and records who listened to which call.

## 3. Proposed design (backend-driven, audited)
| Step | What happens |
|---|---|
| 1 | Supervisor opens Live Calls / Live Operations and presses **Listen** on a call. |
| 2 | Backend checks role (`supervisor` / `admin`) and that the call is live (UUID from ESL). |
| 3 | Backend sends ESL `originate {origination_caller_id_name=Monitor}user/<supervisor extension> &eavesdrop(<call uuid>)` — FreeSWITCH rings the supervisor's own phone (or browser phone); on answer they hear both sides. |
| 4 | Mode switches while listening (built into FreeSWITCH eavesdrop, keypad on the supervisor phone): **2** = whisper to agent only, **1** = talk to customer only, **3** = barge (everyone hears), **0** = back to listen. Buttons in the UI send the same through ESL `uuid_send_dtmf`. |
| 5 | Every start / mode change / end is written to a new `monitor_audit` table (who, which call, agent, mode, start, end). Report page later. |

Needs:
- **Supervisor extension**: a field on the admin user (`users.extension`) — new DB column (migration).
- New endpoint `POST /api/calls/:uuid/monitor { mode }` + `DELETE` to stop.
- UI: Listen / Whisper / Barge buttons on Live Calls (supervisor/admin only).
- Tests: role checks, call-not-live, audit rows, ESL command text.

## 4. Owner decisions needed
1. **Disable 779 / 88xxxx / *0 now?** (recommended — privacy risk today)
2. Should agents **hear a beep** when a supervisor starts listening? (many regulators expect "calls may be monitored" announcement instead; FreeSWITCH supports a tone.)
3. Which supervisors may **barge** (talk to the customer) — all supervisors, or admins only?

## 5. Not in scope
Recording, quality scoring, agent-side "request help" button (later).
