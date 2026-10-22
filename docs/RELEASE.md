# Release work that remains

This list distinguishes runnable prototype behavior from a road-ready CarPlay product.

## Required before claiming CarPlay compatibility

- Compile on supported Xcode/SDK and fix any SDK-specific issues. CI includes a macOS build job, but a workflow file alone is not a passing build.
- Obtain Apple's navigation entitlement, provision/sign the app, and verify approved template use. Apple decides category eligibility and review acceptance.
- Validate and obtain approval for the new native WebRTC/CallKit room and SiriKit calling extension. CarPlay now exposes Voice controls; no incoming-call push service or Siri text-messaging extension is included. Siri room calling currently requires an unlocked phone and previously prepared live session.
- Implement full route-progress matching, maneuver speech, ETA updates, off-route rerouting and verified arrival; test across cities and poor GPS conditions.
- Validate touch and rotary displays, safe-area constraints, reconnects, phone locks, permission changes, audio interruptions and accessibility. Verify every CarPlay template behavior on real hardware.
- Add app icons, a signed distribution configuration, privacy disclosures, location background justification and App Store assets.

## Location and speed-limit reliability

- 10–30 feet is smaller than common phone GPS error. The uncertainty check is conservative, but not a certified ranging guarantee.
- Evaluate compatible ranging technology if physical car adjacency is essential. Do not claim lane-level precision from GPS alone.
- Replace the optional OSM heuristic with a contracted road-matching provider. Support heading, divided highways, ramps, intersections, directional/conditional limits, school zones and unit changes.
- Variable speed signs and new posted limits are not automatically detected by this app. Unknown must remain unknown; do not invent a numeric limit.

## Production service

- Deploy HTTPS with a configured origin, provider credentials/agreements, health monitoring, bounded request processing, distributed rate limits and capacity testing.
- Add account/device authentication, verified consent and revocation, abuse resistance, anti-spoofing, and appropriate protections against repeated anonymous blocking evasion.
- Replace in-memory full scans with spatial indexes and a TTL presence store. Design retention, encryption, deletion and incident response deliberately.
- Add robust multilingual name/message moderation, spam/scam defenses, a staffed report queue, audit/access controls and an appeal process. The basic word list is not a guarantee that names are appropriate.
- Define policy for community road reports, confidence, corroboration, malicious submissions and locally applicable restrictions.
- Review precise-location exposure, pseudonym rotation and stalking risks. Ghost is identity masking, not invisibility or anonymity from the service.
- Verify map-provider licenses and terms, attribution and service limits. Apple/Google Maps content must be used through their supported APIs and agreements.

## Testing needed beyond the included tests

- Multi-device, shared-server tests on real GPS traces at the 10/20/30-foot boundaries.
- Slow/disconnected network behavior, actual vehicle motion, stale clocks, permission revocation and battery impact.
- Background and CarPlay lifecycle testing on physical iPhones/head units.
- Security review, abuse simulation, load tests and accessibility audit.

The current source is a useful foundation, not evidence that these release gates have passed.


## Native voice hardware acceptance checks

Run with two physical iPhones (and a browser peer for interoperability), the same HTTPS backend, and a trusted TURN service. Do not treat the compile job or backend tests as proof of audio behavior.

- Set up voice while stationary; deny microphone permission and verify no call starts. Grant permission, join, and verify microphone mute in both the app and system call UI.
- Unmute one phone; confirm audio arrives only at opted-in, eligible peers. Adjust receive volume and end the room; verify capture and playback both stop.
- Test a peer joining later, bidirectional blocking, range loss, stale GPS, token expiry, server outage, delayed signaling responses, and cancel during startup. Ensure no late response reactivates an ended call.
- Test cellular-to-Wi-Fi changes, relay-only networks, incoming cellular calls, Siri, navigation prompts, route changes, app backgrounding and CarPlay disconnection.
- Invoke Siri with “call Nearby drivers using Automaps” after phone setup. Verify unsupported contacts/video calls are rejected. The current extension restricts calling while locked; locked-phone hands-free use remains a release gap.
- Check the actual Apple-granted provisioning profile and allowed template/capability combination. The checked-in entitlement declarations alone cannot authorize CarPlay distribution.
