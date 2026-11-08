# Softphone engine: source provenance

The `engine/` folder is a **verbatim copy** of the FS-WebRTC phone engine. **Do not edit files in `engine/`.** Any future change must be made in FS-WebRTC first, or recorded below as a local change with its reason.

| Item | Value |
|---|---|
| Source repository | https://github.com/nareshrock1992-arch/FS-WEBRTC |
| Source commit | `23ab1ce682489b4cded330286f0f4235a440da11` |
| Copied on | 2026-11-08 (CP-3, WebRTC Phase 2) |
| Method | `git archive 23ab1ce <paths>`, extracted into `engine/` (taken from Git objects; no line-ending conversion) |
| Layout | Mirrors the source repository (`engine/src/…`, `engine/tests/unit/…`), so the tests' relative imports (`../../src/…`) resolve unchanged |
| Local changes | **None** |

## Included

- `src/audio`, `src/config`, `src/services`, `src/sip`, `src/types`, `src/utils`: the engine (requirement R-1)
- `src/vite-env.d.ts`: types for `import.meta.env` (`VITE_SIP_DOMAIN`, `VITE_SIP_WSS_URL`), needed by the strict typecheck
- `tests/unit/{call-state,logger-time-store,reconnect,validation}.test.ts`: engine unit tests

## Excluded, and why

- `src/main.ts`, `src/pages/*`, `src/components/*`, `src/styles/app.css`: the proof-of-concept vanilla UI, which FS-CC does not reuse
- `server/*` and `tests/unit/sip-via.test.ts`: the WSS proxy and its test (that test imports `../../server/sip-via.mjs`). They belong to Phase 4 (the relay)

## SHA-256 of every copied file

Verified equal to `git show 23ab1ce:<path> | sha256sum` for each file.

```
8e932dbd1869e05bf0c8697db42ba8ab80d39e84306b37842b2b3fc1a488f55c  src/audio/devices.ts
0f7e981729c5a9fa1c3cbeb71ad0049bafda52b14ed0d715c1411a0da0a5eec1  src/audio/remote-audio.ts
c7dadc15ab9a777972089d21887a000559feb3d11b186920cf55f74cb4544aa0  src/audio/ringtone.ts
ca1a124cf44ac394e7385196bdd0ac373847ad58c923f073e8aa58f48db340c1  src/config/config.ts
255b97100260acb81b0c6406edfecccceb7b4ebc88f0096bfc17f16f343d0641  src/services/call-state.ts
e445883903756dfc150c926f9082143fb2dde8179665e5ca927d9334510e6ec1  src/services/phone-service.ts
1751060caa39055fff4574b7c939814be51c87435774aee74b4b7119d7f529ae  src/services/reconnect.ts
893ac105652f0e80f2c9ba4cb98d8d0e991832ac0fc6bebf459ada8cfb53963a  src/services/store.ts
ae13a84a5cc8d8c9a4e652d8050de0fed38b27acd6af8a2cba72b1329058eec9  src/sip/call-session.ts
31bc2f83dc7a0d55a1b75c4ede353b4b9b768af976fab4663c1c3bff863736ca  src/sip/sip-client.ts
67c2b26fa5e8efb4769aa781d10fc2d1fd3cd70b59c130abc11d790c5257ea8d  src/types/phone.ts
00f53a27f96ec8d7ed1e7cb0962b4c8c219405b29b993c9f0bd5266c2f172730  src/utils/logger.ts
5713756fa2aa54690b046735254880bd79b6231bb642495706a86753aff3b297  src/utils/time.ts
096d3f0e7ba8dc5a7f9d29888e2f074a975a5b1c4790ed9022ee90f3ec4ec472  src/utils/validation.ts
11bf014fe763a1d4b287ce8f3f0b6d7f25216e2d7f9905a5946a1c9c70be2b0f  src/vite-env.d.ts
5e970b651642f31847ff4e26fdf543436f5a0655a6991f0ed38ee94391d1f9ea  tests/unit/call-state.test.ts
29ff25b250f4b4ae81c21362f085ddcf563e917c7a11c9563e157c44e3bae1c2  tests/unit/logger-time-store.test.ts
01a78b59c004a3fc99714f50244293851334cc8db748554c2b0f8226091e28dc  tests/unit/reconnect.test.ts
75e2a5b0535944d1a84c699b30967601fbf14ee98b96c941f5a6ad5e78688db1  tests/unit/validation.test.ts
```
