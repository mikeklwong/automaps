# Vehicle display support and CarPlay voice

## What this release adds

The browser client has a Display button with Standard, Wide EV, Compact EV and Portrait EV layouts, larger controls, a parked-use banner, optional browser fullscreen, and a non-invasive compatibility panel. Open `/?display=wide`, `/?display=compact` or `/?display=portrait` to select a preset. The choice persists locally. These are screen presets, not vehicle detection or OEM certification.

The panel checks secure context, geolocation, microphone capture, WebRTC, network hints and fullscreen. Permission queries never request location or microphone access. API availability does not prove hardware access. Existing Go live and Enable voice consent flows remain responsible for permissions. Unsupported voice remains unavailable; GPS is never replaced with invented coordinates. Display settings do not bypass OEM restrictions, expose vehicle telemetry, keep a browser running in the background, or relay a phone session.

## Tesla and other EV deployment

1. Host the existing Node service and assets at your own HTTPS origin; configure PUBLIC_ORIGIN and a trusted TURN service. A localhost address cannot be used from the vehicle. This change does not deploy a public service.
2. While parked, open that HTTPS address in a vehicle browser and select a display preset. A current browser with ES modules, HTML dialogs and the app's other web APIs is required. Fullscreen is optional.
3. Check compatibility. Try explicit GPS and microphone consent only if the browser exposes them. Test audio playback and permission denial on that exact model, firmware and region. Internet connectivity and manufacturer policies can restrict access.
4. If GPS or microphone is unavailable, use the app on a phone with the same backend instead. The phone is a separate participant; no pairing, mirrored session, or GPS relay is implemented. Normal Bluetooth audio routing depends on the phone/car; it is not a custom display integration.
5. Test layout, permission revocation, sleep/background behavior, connectivity changes and audio interruptions on hardware before making any vehicle-support claim. This browser prototype is for parked use and cannot reliably determine the vehicle's gear state.

Tesla browser access is a possible web delivery surface, not a native Tesla SDK or certified app-store integration. No Tesla credentials, Fleet API, vehicle commands or vehicle-data access are needed or included. Do not infer web microphone access from Tesla's built-in calling features.

There is no single “Chinese EV” platform. Choose a manufacturer, model year, market and firmware first. A vehicle with a suitable browser can try this web version. Android Auto projects a supported Android phone app; Android Automotive OS runs apps in the vehicle. Neither is implied by an Android-based head unit. Native distribution for other systems needs that OEM's SDK, approved app category, distribution channel and permissions. No Android Automotive, BYD, NIO, XPeng, Zeekr or HarmonyOS native package is supplied here.

## Can we omit Apple's navigation entitlement?

- **Own map/navigation UI on CarPlay:** no supported production route without Apple's granted `com.apple.developer.carplay-maps` entitlement. The current CPMapTemplate-based source is this kind of app. Adding a key to a plist does not grant permission.
- **Communication-only CarPlay app:** potentially yes without the *navigation* entitlement, using Apple's granted `com.apple.developer.carplay-communication` entitlement and the appropriate communications integration. Remove the custom navigation scene and use supported communication UI. Users can navigate with Apple Maps separately.
- **No CarPlay app entitlement:** an ordinary phone app can be developed independently, and system audio/call routing may still be usable where supported. That does not grant a custom CarPlay icon, custom map or unrestricted screen UI. Newer CarPlay widgets/Live Activities are limited system surfaces, not a workaround for a full map or proximity-chat application.

Apple decides eligibility. An automatically joined, always-open room of nearby strangers should not be assumed to qualify as a calling app. Present the actual interaction to Apple before investing in that product path. Prefer explicit invitation/acceptance, visible participants, mute/end-call controls, and blocking. Do not classify human-to-human calling as a voice-assistant app simply to obtain a different category.

## Native voice implementation work

1. Choose communication-only versus combined navigation/communication, enroll in the Apple Developer Program, and request the applicable CarPlay capabilities with an honest demonstration of the intended experience. Have Apple confirm the proposed combination and proximity group-call behavior.
2. Integrate a maintained native iOS WebRTC/media SDK with the backend. The browser implementation cannot run inside a CarPlay template. Add production authentication, short-lived TURN credentials and a server-controlled media service if hard proximity revocation is required. Preserve mutual opt-in, expiry, blocking and range checks.
3. Add a CallKit `CXProvider`/`CXCallController` call lifecycle: outgoing/incoming call, answer, mute and end, with correct audio activation/deactivation callbacks. Configure `AVAudioSession` for two-way voice, route changes and interruptions; test calls, Siri, navigation prompts and music. A web volume slider cannot implement system-wide audio ducking.
4. Implement SiriKit calling support including `INStartCallIntent` and the required intent handling/configuration. If adding Siri messages, implement the relevant messaging intents too. Resolve the selected peer safely and require an explicit accepted call; never start microphone capture from a location scan.
5. Use PushKit only for genuine incoming VoIP calls and comply with CallKit reporting requirements. Do not use VoIP pushes as a general presence poll or keepalive. Include microphone/location purpose strings and only justified background modes.
6. Build on macOS/Xcode, configure signed provisioning containing the granted capabilities, and test the CarPlay Simulator plus real supported head units. Test touch and rotary input, denied permissions, loss of range, call cancellation, audio interruptions and reconnection. Complete App Review before distribution.

The checklist above describes the production path. The native development implementation below now supplies voice transport, CallKit controls and an Intents extension; granted entitlements, phone/display pairing and OEM certification remain outstanding.

## Official references (checked October 14, 2026)

- [Apple CarPlay overview and entitlement request](https://developer.apple.com/carplay/)
- [Requesting CarPlay entitlements](https://developer.apple.com/documentation/carplay/requesting-carplay-entitlements)
- [CarPlay communication entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.carplay-communication)
- [CarPlay communication compatibility and calling intents](https://developer.apple.com/documentation/carplay/supporting-previous-versions-of-ios)
- [CallKit](https://developer.apple.com/documentation/callkit)
- [Android for Cars platform and supported categories](https://developer.android.com/training/cars)
- [Tesla voice commands, including opening the browser](https://www.tesla.com/en_GB/support/voice-commands)

## Native voice build (CarPlay-first milestone)

The iOS target now includes audio-only WebRTC 154.0.0, a CallKit-controlled nearby room, phone consent/setup, mute and end controls, independent receive volume, and a SiriKit `INStartCallIntent` extension. CarPlay has a Voice control and native list actions. Participants explicitly join the shared proximity room; this is not individual ringing or an incoming-call service. Nearby users who opted in can join later. The existing server still checks mutual opt-in, location freshness, blocking and radius before signaling.

On the phone, connect live GPS while stationary, open Voice, review consent, allow microphone access, and tap Join. The microphone starts muted. CallKit controls unmute/end. Setup is session-only and resets on disconnect. No proximity scan requests microphone permission. Fresh GPS and successful signaling are required; a watchdog ends media when either lease expires. Foreground-only sessions stop on background; an active native call or connected CarPlay session can continue location updates using the declared background modes. This must be validated on hardware; background execution is not guaranteed by declarations alone.

Siri supports the room name “Nearby drivers” and hands the call intent to the host app, which rechecks prepared consent and fresh GPS. Other contacts/video calls are rejected. The extension does not access tokens, GPS or the microphone. End-to-end Siri recognition and locked-device/CarPlay delivery remain hardware test requirements. No PushKit or unsolicited incoming calls are implemented.

WebRTC is pinned through XcodeGen to the third-party [stasel/WebRTC 154.0.0 package](https://github.com/stasel/WebRTC/tree/154.0.0), which packages WebRTC binaries and declares a checksum. The package is downloaded by Xcode/CI and retains its upstream licenses. Review its provenance and update policy before shipping. Native and browser clients share the same signaling format. TURN credentials must be short-lived in production; the current server's static configuration is for development. Direct peer media cannot forcibly revoke a modified client; use an authorized media relay for hard revocation.

The entitlement file now *declares* navigation, communication and Siri capabilities; it does not grant them. Have Apple approve the actual combined navigation/open-room design. No assertion of App Review eligibility or real CarPlay audio success is made. Tesla and Android remain later milestones.

