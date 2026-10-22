# Verification record

Authoring environment: Windows, Node.js; October 14, 2026.

- 19 automated tests pass: domain/privacy/proximity, bidirectional blocking, stale location expiry, message retention, typed chat moving-speed checks, road reports, speed-limit ambiguity, voice mutual opt-in, signaling restrictions, voice disable/block/expiry, expanded Quick Chat, and real local HTTP authentication/origin/static-file checks.
- JavaScript syntax checks pass for browser and server modules.
- Browser checks performed: demo map, 10/30-foot filtering, sending a demo message, Active profile editing, nearby list, Quick Chat options/sending, theme palette and light mode, and successful live Open-Meteo forecast loading for the San Francisco demo area (current conditions, humidity, visibility and seven daily forecasts).
- Original demo road illustration renders locally without external tiles. Real map tiles and routing require provider network access.
- Voice signaling tests do not prove audio connectivity. Microphone capture, two-device WebRTC audio, TURN traversal, network transitions and actual GPS motion still require hardware testing. No claim of successful end-to-end audio is made.
- Native iOS/CarPlay source has not been compiled on this Windows machine. A macOS CI build is supplied; check its actual results before treating the Swift code as validated. CarPlay entitlement approval and head-unit testing are outstanding.
- Public-service availability and policy compliance at production scale are not established by these checks. See RELEASE.md.

- EV display update: wide (1280x800), compact (1024x600), and portrait (800x1100) browser layouts inspected; display selection survives reload; capability check reports permission states without requesting access. Existing 19 tests pass. No vehicle hardware or native CarPlay voice validation performed.

### October 19, 2026 native voice verification

- The 19 backend tests pass again, including proximity, voice mutual opt-in, blocking/revocation and HTTP checks.
- Native WebRTC transport, CallKit controls and Siri extension passed the unsigned iOS Simulator build on GitHub macOS CI (run 39347206213, commit 53f4d98). This verifies compilation, not audio behavior. Subsequent call-lifecycle guards are also submitted to the same build workflow; consult the latest Actions run for their result.
- No physical microphone/audio, Siri recognition, locked-phone handoff or CarPlay head-unit tests have been performed. Siri calls are intentionally restricted while locked in the current extension configuration.

