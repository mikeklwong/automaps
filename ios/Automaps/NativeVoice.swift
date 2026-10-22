import AVFoundation
import CallKit
import Combine
import WebRTC

/// Explicitly joined room; no unsolicited incoming calls or automatic microphone activation.
@MainActor
final class NativeVoice: NSObject, ObservableObject, CXProviderDelegate {
    static let shared = NativeVoice()
    @Published private(set) var active = false { didSet { if oldValue != active { DriveStore.shared.updateBackgroundUse() } } }
    @Published private(set) var starting = false
    @Published private(set) var muted = true
    @Published private(set) var participants: [Driver] = []
    @Published private(set) var status = "Voice is off"
    @Published private(set) var prepared = false
    @Published var volume = 0.65 { didSet { for peer in peers.values { peer.volume = min(1, max(0, volume)) } } }
    private let provider: CXProvider
    private let calls = CXCallController()
    private var callID: UUID?
    private var generation = UUID()
    private var peers: [String: VoicePeer] = [:]
    private var servers: [RTCIceServer] = []
    private var polling: Task<Void, Never>?
    private var watchdog: Task<Void, Never>?
    private var lastSuccess = Date.distantPast
    private var stopping = false
    private var startingRequest = false
    private var connectedReported = false
    private var interrupted = false

    override init() {
        let config = CXProviderConfiguration(localizedName: "Automaps")
        config.supportsVideo = false; config.maximumCallGroups = 1; config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]; config.includesCallsInRecents = false
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: .main)
        RTCAudioSession.sharedInstance().useManualAudio = true
        RTCAudioSession.sharedInstance().isAudioEnabled = false
    }
    /// Must be invoked from the phone consent sheet, never from a proximity scan.
    func prepare() async {
        guard DriveStore.shared.parked else { status = "Stop and obtain a fresh stationary GPS fix before setup."; return }
        let sessionID = DriveStore.shared.userID
        let allowed = await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) }
        }
        prepared = allowed && DriveStore.shared.live && DriveStore.shared.userID == sessionID
        status = prepared ? "Ready. Join explicitly; your microphone starts muted." : "Microphone permission and a live session are required."
    }
    func join() {
        guard callID == nil, !starting, !startingRequest, !stopping else { return }
        guard prepared, AVAudioSession.sharedInstance().recordPermission == .granted else {
            status = "Set up voice on the iPhone while parked first."; return
        }
        guard DriveStore.shared.freshLocation else { status = "Fresh live GPS is required."; return }
        let id = UUID(); callID = id; starting = true; generation = UUID(); muted = true
        status = "Starting nearby voice…"
        let action = CXStartCallAction(call: id, handle: CXHandle(type: .generic, value: "automaps-nearby"))
        action.isVideo = false
        calls.request(CXTransaction(action: action)) { error in
            Task { @MainActor in
                if let error, self.callID == id { self.starting = false; self.end(reason: error.localizedDescription) }
            }
        }
    }
    func toggleMute() {
        guard let id = callID, active else { return }
        calls.request(CXTransaction(action: CXSetMutedCallAction(call: id, muted: !muted))) { error in
            if let error { Task { @MainActor in self.status = error.localizedDescription } }
        }
    }
    func leave() {
        guard let id = callID else { return }
        // Stop media immediately even when CallKit takes time to process the transaction.
        end(reason: "Voice disabled", report: false)
        let provider = self.provider
        calls.request(CXTransaction(action: CXEndCallAction(call: id))) { error in
            if error != nil { provider.reportCall(with: id, endedAt: Date(), reason: .failed) }
        }
    }
    func revoke() { prepared = false; end(reason: "Voice disabled · session ended") }
    func block(_ id: String) { peers.removeValue(forKey: id)?.close(); participants.removeAll { $0.id == id } }
    func end(reason: String, report: Bool = true) {
        generation = UUID(); active = false; starting = false; muted = true; participants = []; status = reason
        polling?.cancel(); polling = nil; watchdog?.cancel(); watchdog = nil
        for peer in peers.values { peer.close() }; peers.removeAll()
        RTCAudioSession.sharedInstance().isAudioEnabled = false
        let old = callID; callID = nil; connectedReported = false
        if report, let old { provider.reportCall(with: old, endedAt: Date(), reason: .remoteEnded) }
        guard !stopping else { return }
        stopping = true
        Task {
            if DriveStore.shared.live { let _: VoiceState? = try? await DriveStore.shared.request("voice", method: "PUT", body: ["enabled": false]) }
            stopping = false
        }
    }
    private func start(_ action: CXStartCallAction) async {
        guard action.callUUID == callID else { action.fail(); return }
        startingRequest = true
        let version = generation
        defer { starting = false; startingRequest = false }
        do {
            guard prepared, DriveStore.shared.freshLocation else { throw ServiceError.message("Reconnect GPS and prepare voice first.") }
            let config: VoiceConfig = try await DriveStore.shared.request("config")
            guard version == generation else { action.fail(); return }
            servers = config.iceServers.map(\.rtc)
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
            let _: VoiceState = try await DriveStore.shared.request("voice", method: "PUT", body: ["enabled": true])
            guard version == generation, DriveStore.shared.freshLocation else {
                let _: VoiceState? = try? await DriveStore.shared.request("voice", method: "PUT", body: ["enabled": false])
                action.fail(); if version == generation { end(reason: "GPS became unavailable") }; return
            }
            active = true; lastSuccess = Date(); status = "Listening · microphone muted"
            let update = CXCallUpdate(); update.localizedCallerName = "Nearby drivers"; update.hasVideo = false
            update.supportsHolding = false; update.supportsGrouping = false; update.supportsUngrouping = false; update.supportsDTMF = false
            provider.reportCall(with: action.callUUID, updated: update)
            provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())
            action.fulfill()
            // Set system mute as well as track mute; outgoing audio remains disabled if it fails.
            calls.request(CXTransaction(action: CXSetMutedCallAction(call: action.callUUID, muted: true))) { _ in }
            polling = Task { [weak self] in
                while !Task.isCancelled, let self, self.active, self.generation == version {
                    await self.poll(version)
                    try? await Task.sleep(for: .seconds(1))
                }
            }
            watchdog = Task { [weak self] in
                while !Task.isCancelled, let self, self.active, self.generation == version {
                    if !DriveStore.shared.freshLocation || Date().timeIntervalSince(self.lastSuccess) > 6 {
                        self.end(reason: "Voice stopped · GPS or signaling expired"); return
                    }
                    try? await Task.sleep(for: .seconds(1))
                }
            }
        } catch {
            action.fail()
            if version == generation { end(reason: error.localizedDescription) }
        }
    }
    private func signal(_ id: String, type: String, data: [String: Any], version: UUID) async throws {
        guard active, generation == version else { throw CancellationError() }
        let _: OK = try await DriveStore.shared.request("voice/signal", method: "POST", body: ["to": id, "type": type, "data": data])
    }
    private func peer(_ id: String, version: UUID) throws -> VoicePeer {
        if let peer = peers[id] { return peer }
        let peer = try VoicePeer(id: id, servers: servers, muted: muted || interrupted)
        peer.volume = volume
        peer.onCandidate = { [weak self, weak peer] data in
            Task { @MainActor in
                guard let self, let peer, self.peers[id] === peer else { return }
                do { try await self.signal(id, type: "candidate", data: data, version: version) }
                catch { if self.generation == version, self.peers[id] === peer { self.peers.removeValue(forKey: id)?.close() } }
            }
        }
        peer.onState = { [weak self, weak peer] state in
            guard let self, let peer, self.generation == version, self.peers[id] === peer else { return }
            if [.failed, .closed].contains(state) { self.peers.removeValue(forKey: id)?.close() }
            if peer.connected, !self.connectedReported, let id = self.callID {
                self.connectedReported = true; self.provider.reportOutgoingCall(with: id, connectedAt: Date())
            }
        }
        peers[id] = peer; return peer
    }
    private func poll(_ version: UUID) async {
        do {
            let result: VoicePoll = try await DriveStore.shared.request("voice")
            guard generation == version, active else { return }
            lastSuccess = Date(); participants = result.peers
            let allowed = Set(result.peers.map(\.id))
            for id in Array(peers.keys) where !allowed.contains(id) { peers.removeValue(forKey: id)?.close() }
            for message in result.signals where allowed.contains(message.from) {
                guard generation == version, active else { return }
                let connection = try peer(message.from, version: version)
                try await connection.receive(type: message.type, data: message.data)
                if message.type == "offer" {
                    let sdp = try await connection.description(offer: false)
                    try await signal(message.from, type: "answer", data: ["type": "answer", "sdp": sdp], version: version)
                }
            }
            for driver in result.peers where peers[driver.id] == nil && DriveStore.shared.userID < driver.id {
                guard generation == version, active else { return }
                let connection = try peer(driver.id, version: version)
                let sdp = try await connection.description(offer: true)
                try await signal(driver.id, type: "offer", data: ["type": "offer", "sdp": sdp], version: version)
            }
            for (id, connection) in Array(peers) where !connection.connected && Date().timeIntervalSince(connection.created) > 20 {
                peers.removeValue(forKey: id)?.close()
                status = "Audio connection timed out. Check the TURN service."
            }
        } catch {
            if generation == version { end(reason: "Voice stopped · connection interrupted") }
        }
    }
    nonisolated func providerDidReset(_ provider: CXProvider) { Task { @MainActor in self.end(reason: "System reset voice") } }
    nonisolated func provider(_ provider: CXProvider, perform action: CXStartCallAction) { Task { @MainActor in await self.start(action) } }
    nonisolated func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        Task { @MainActor in
            // A delayed end action for a previous room must not end a newer call.
            if action.callUUID == self.callID { self.end(reason: "Voice ended", report: false) }
            action.fulfill()
        }
    }
    nonisolated func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        Task { @MainActor in
            guard action.callUUID == self.callID, self.active else { action.fail(); return }
            self.muted = action.isMuted
            for peer in self.peers.values { peer.mute(self.muted || self.interrupted) }
            self.status = self.muted ? "Listening · microphone muted" : "Microphone live · nearby participants can hear you"
            action.fulfill()
        }
    }
    nonisolated func provider(_ provider: CXProvider, timedOutPerforming action: CXAction) {
        Task { @MainActor in
            guard let call = action as? CXCallAction, call.callUUID == self.callID else { return }
            self.end(reason: "Call action timed out")
        }
    }
    nonisolated func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        RTCAudioSession.sharedInstance().audioSessionDidActivate(audioSession)
        Task { @MainActor in
            self.interrupted = false
            RTCAudioSession.sharedInstance().isAudioEnabled = self.callID != nil
            for peer in self.peers.values { peer.mute(self.muted) }
        }
    }
    nonisolated func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        RTCAudioSession.sharedInstance().audioSessionDidDeactivate(audioSession)
        RTCAudioSession.sharedInstance().isAudioEnabled = false
        Task { @MainActor in self.interrupted = true; for peer in self.peers.values { peer.mute(true) } }
    }
}
