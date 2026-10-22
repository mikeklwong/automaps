# Automaps

**A little closer.** A runnable proximity-chat prototype with an interactive road map, anonymous-by-default presence, and a native iPhone / CarPlay foundation.

**Status: development prototype, not a released driving app.** The browser app and Node service run today. Native Swift sources and an XcodeGen project are included; the WebRTC/CallKit app and Siri extension passed an unsigned iOS Simulator compile on GitHub macOS CI. Physical-device audio and CarPlay tests are still outstanding. Real CarPlay distribution needs Apple's granted navigation entitlement, signing, simulator/head-unit validation and App Review. Native voice now has a development implementation using WebRTC, CallKit and SiriKit; device validation and Apple approval are still required. The browser interface is not CarPlay-compatible merely because it has large controls.

## Run locally

Install Node.js 22 or newer. No package installation is required; Leaflet 1.9.4 is vendored.

```sh
node server/index.mjs
# Open http://localhost:4173
node --test test/*.test.mjs
```

Optional configuration:

```sh
cp .env.example .env
node --env-file=.env server/index.mjs
```

The service listens on loopback by default. Demo mode starts without requesting GPS or uploading presence. Three explicitly simulated drivers illustrate the UI. Demo chat and reports stay in the browser's memory and reset on reload. Demo peers do not send fabricated replies. The demo uses an original illustrative SVG road map, not real lane geometry.

Choose **Go live → Share location & connect** to use real GPS. Live participants must connect to the **same server**. For real phones, deploy your own HTTPS backend and open that URL; `localhost` on one device is not another device's server. Browser geolocation requires HTTPS or localhost. The app deliberately stops browser location sharing when backgrounded; mobile browsers cannot guarantee a two-second background scan. Native CarPlay has a separate lifecycle.

## What works

| Feature | Implementation / limit |
|---|---|
| Interactive map | Pan, zoom, recenter, selectable car markers, green presence dots, report pins, route overlays. Native app uses Apple MapKit; browser uses Leaflet + OpenStreetMap. |
| Ghost by default | Session pseudonym; name, make and model are not sent to peers. Switching back to Ghost also changes sender identity on retained chat messages. |
| Active profiles | Display name, make and model, with server-side length and basic word filtering. This is not comprehensive moderation. |
| 10–30 ft range | 10/20/30 ft selector. Both users' radii and horizontal GPS uncertainty are enforced server-side. |
| Two-second list scan | Sequential polling while active; stale presence removed after 12 seconds. Network requests never overlap. No guarantee of two-second results on a slow network. |
| Real nearby chat | Ephemeral bearer sessions, targeted messages, quick replies, blocking and message flags. Message history expires after five minutes. |
| Driver interaction | Free text rejected server-side above 0.5 m/s or when speed is unknown. Browser interface is for parked development testing. |
| Reports | Road hazard, red-light camera and police presence. Reports use the reporter's current GPS, are unverified, and expire (15 minutes; cameras one hour). |
| A-to-B routing | Start/destination search, coordinate input, driving route line, distance, estimated duration and basic maneuver display. Native route search uses MapKit. |
| Map handoff | Apple Maps and Google Maps deep links for selected endpoints. No proprietary tile/data scraping or import. |
| Speed | GPS speed in mph; unknown/stale fixes display a dash. |
| Speed limits | Optional Overpass/OSM posted-limit adapter. Missing/ambiguous/directional/conditional limits stay unknown. Updates are polled, **not live traffic-sign detection**. |
| CarPlay foundation | `CPMapTemplate`, native map, route previews, navigation session, nearby list, report list and speed status. Requires Apple approval and further validation. |

### Proximity is intentionally conservative

GPS is often inaccurate by more than the entire requested radius. We admit a peer only when:

```text
distance + your horizontal accuracy + their horizontal accuracy
    <= min(your radius, their radius)
```

At a 10-foot radius, ordinary GPS may admit no one. This rule reduces false matches but **does not guarantee physical proximity**: reported horizontal accuracy is an estimate, not a strict bound. A backend cannot prove client-provided coordinates. Production needs anti-spoofing measures and potentially compatible ranging hardware (subject to platform support and user consent). The prototype cannot identify a specific physical car or lane from GPS alone.

### Privacy model

- Ghost anonymizes identity **to nearby users**, not to the service operator. The server receives exact coordinates, accuracy and speed during a live session.
- Nearby peers receive exact coordinates only after the server proximity check. There is no global user-location endpoint.
- Session tokens are random, expire after one hour and stay in memory. Reloading resets presence to Ghost.
- Location fixes stop being used after 12 seconds and are purged by the cleanup loop. Explicit disconnect removes the session. No database or analytics is included.
- Road reports reveal their reported location to drivers within 5 km. They omit reporter identity and can remain after disconnect until expiry.
- Chat is not end-to-end encrypted. HTTPS is required outside local development. The service operator can read messages.
- Block/flag records are session-scoped and temporary. Flags do not reach a human moderator; no moderation dashboard exists yet.
- OSM tile requests reveal the viewed map area to the tile provider. Place search and route endpoints are sent to the configured providers. Native MapKit communicates with Apple.

## Map providers and limits

Development defaults use public Nominatim search and the OSRM demo routing service. Search is explicit (no autocomplete), globally rate limited to roughly one request/second, with bounded caching. Configure dedicated/contracted providers before serving multiple users. The OSM tile attribution is always shown with real tiles. Never bulk-download or prefetch public tiles.

Configure `OVERPASS_URL` to enable posted speed limits. It is intentionally unset by default. The adapter performs at most one provider lookup every 15 seconds per process; each client requests every 30 seconds. At intersections or missing/conditional limits it returns unknown. A limit is cleared after moving more than 30 m away from its lookup point. This is a development fallback, not lane-level map matching, variable-sign detection or comprehensive road-limit coverage. Use a licensed road-matching/speed-limit provider for production; obey posted signs.

Routing is **not yet a complete navigation engine**: no reliable rerouting, lane guidance, traffic-aware ETA, offline navigation or full voice guidance. The native app can hand off to Apple Maps for normal turn-by-turn navigation. Browser maneuver hints are approximate and are not safe to rely on while driving.

## iPhone and CarPlay

On a Mac with Xcode and XcodeGen installed:

```sh
xcodegen generate --spec ios/project.yml
open ios/Automaps.xcodeproj
# Unsigned compile check:
xcodebuild -project ios/Automaps.xcodeproj -scheme Automaps \
  -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

1. Choose a unique bundle identifier and your Apple development team.
2. Request and obtain the **CarPlay navigation entitlement** from Apple. The checked-in entitlement declaration does not grant access.
3. Set the backend URL in the iPhone app's profile. Simulator can use `http://localhost:4173`; devices require your HTTPS server.
4. Connect from the phone after reviewing location sharing. Enter a start and destination while parked. The route can be previewed on CarPlay.
5. Test CarPlay Simulator and actual supported touch/rotary head units, location errors, disconnections, rotations, localization and accessibility.

CarPlay uses system templates and touch targets, not the custom browser dashboard. It includes nearby information and reports, but deliberately does not add a keyboard or arbitrary chat stream. Native voice uses CallKit and a SiriKit Intents extension. The code remains a development implementation pending granted capabilities, audio hardware tests and review of the open-room experience.

## Project layout

```text
public/                 Browser interface, illustrative demo map, vendored Leaflet
server/domain.mjs       Privacy, presence, proximity, chat and report rules
server/providers.mjs    Geocoding, routing and posted speed-limit adapter
server/index.mjs        Dependency-free HTTP API and static file server
ios/                    XcodeGen manifest, SwiftUI iPhone app, MapKit/CarPlay sources
test/                   Domain tests and real HTTP integration tests
docs/                   API contract, release checklist and verification record
.github/workflows/      Node tests and macOS unsigned iOS build check
```

See [API](docs/API.md), [release work](docs/RELEASE.md), and [verification](docs/VERIFICATION.md).

## Voice, themes, Quick Chat and weather

The browser prototype now includes opt-in WebRTC proximity voice, a microphone mute button, independent voice-playback volume, a full voice-disable switch, and a Quiet Cabin preset. Voice defaults off on every visit; when enabled, the microphone starts muted. Both participants must be live, explicitly voice-enabled, unblocked and within the conservative GPS radius. Leaving live mode, backgrounding, stale GPS or prolonged signaling failure closes connections and releases the microphone. Blocking or leaving range closes compliant clients' peer connections on the next scan. Peer-to-peer transport cannot forcibly disconnect a modified/malicious client; production needs a server-controlled media relay/SFU with authorization leases if hard revocation is required.

WebRTC encrypts media in transit. Automaps does not record it; recipients may. Direct connections can reveal network addresses. `ICE_SERVERS` is an optional JSON array of RTCIceServer configurations. With the default empty array, only networks that permit direct connectivity will work. Configure a trusted STUN/TURN service for mobile-network use; production TURN credentials must be short-lived and issued per authenticated client. Do not commit secrets. Voice volume does not change another app's music volume or provide OS-level audio ducking. Native voice and audio-session integration now have a development implementation; see the native voice milestone below.

Appearance settings offer green (default), blue, red, purple, pink, cyan, yellow and white accents; dark, light or system-following automatic mode; and locally saved preferences. Quick Chat includes “Nice car! 👍”, greetings, courtesy and vehicle-condition messages, all checked by the backend. Quiet Cabin mutes the microphone and voice playback together.

The weather panel loads actual public Open-Meteo forecasts on request, including temperature/feels-like, humidity, hourly rain probability, visibility, wind/gusts, pressure, dew point, daily UV, sunrise/sunset and seven-day high/low temperatures. It supports Fahrenheit/Celsius. The weather service receives coordinates rounded to roughly a 0.02-degree grid, caches for 15 minutes and identifies its source. Demo forecasts use San Francisco; they are real forecasts for that location, not simulated weather. The Open-Meteo public endpoint has usage/licensing limits; review its [terms](https://open-meteo.com/en/terms) and use an appropriate plan for commercial service.

These expanded features are implemented in the browser client. Native iPhone/CarPlay sources now include voice, but do not have feature parity with browser weather/theme settings.

## Legal notices and limitation of liability

**Experimental prototype. Not a certified vehicle, navigation, emergency or safety system. Do not operate browser/phone controls while driving.** GPS, speed limits, routes, weather and community reports may be incomplete, inaccurate or outdated. Follow actual signs, road conditions and applicable law.

**TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THIS SOFTWARE AND ITS DATA/SERVICES ARE PROVIDED “AS IS” AND “AS AVAILABLE,” WITHOUT EXPRESS, IMPLIED OR STATUTORY WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY, SECURITY AND NON-INFRINGEMENT. TO THAT SAME EXTENT, THE PROJECT OWNER, CONTRIBUTORS AND OPERATORS DISCLAIM LIABILITY FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR EXEMPLARY DAMAGES AND LOSS OF DATA, PROFITS OR USE ARISING FROM THE SOFTWARE OR SERVICES.**

Nothing excludes or limits liability that applicable law does not permit to be excluded or limited, or waives non-waivable consumer rights. No disclaimer can guarantee the owner freedom from all liability. Repository notices alone do not establish enforceable user assent. See the fuller [legal draft](LEGAL.md), including safety limitations, third-party information, non-affiliation, and jurisdiction-specific legal review requirements. Have qualified counsel adapt it before public release. [Cornell's explanation of exculpatory clauses](https://www.law.cornell.edu/wex/exculpatory_clause) describes important enforceability limits.

## Reference sources

- [Apple CarPlay program and entitlements](https://developer.apple.com/carplay/)
- [Apple CarPlay navigation integration](https://developer.apple.com/documentation/carplay/integrating-carplay-with-your-navigation-app)
- [Core Location accuracy and speed](https://developer.apple.com/documentation/corelocation/cllocation)
- [OpenStreetMap tile usage](https://operations.osmfoundation.org/policies/tiles/)
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- [OSRM API](https://project-osrm.org/docs/v5.5.1/api/)
- [Leaflet](https://leafletjs.com/) — vendored BSD-2-Clause license in `public/vendor/LEAFLET-LICENSE`.

No application license has been chosen; the repository owner's default copyright applies to original project files. Third-party files retain their own license.

## EV browser displays

Use the new **Display** button for Wide, Compact or Portrait EV layouts, larger controls, optional fullscreen and a browser capability check. Preset links: `/?display=wide`, `/?display=compact`, `/?display=portrait`. Preferences stay on the device; no location or microphone permission is requested by the check. Deploy to your own HTTPS origin to open it from a vehicle.

These are parked-use web layouts for compatible browsers, not certified Tesla/Chinese-EV native apps. GPS, microphone, background access and driving restrictions depend on the exact vehicle. There is no phone/display pairing or vehicle telemetry connection. Read [vehicle deployment and the CarPlay voice implementation plan](docs/VEHICLE-DISPLAYS.md), including the distinction between Apple's navigation and communication entitlements.


## Native voice milestone

iPhone/CarPlay source now includes a WebRTC audio room, CallKit mute/end lifecycle, receive volume, explicit parked setup, and SiriKit handoff for “Nearby drivers.” The microphone starts muted; stale GPS, signaling loss, session stop and blocking disconnect compliant clients. This is source implementation, not a claim of successful device audio or Apple approval. [Setup, architecture and outstanding validation](docs/VEHICLE-DISPLAYS.md#native-voice-build-carplay-first-milestone).

