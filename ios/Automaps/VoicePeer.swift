import Foundation
import WebRTC

/// One audio-only connection. Delegate callbacks cross back to the main actor.
@MainActor
final class VoicePeer: NSObject, RTCPeerConnectionDelegate {
    let id: String
    let created = Date()
    private let pc: RTCPeerConnection
    private let local: RTCAudioTrack
    private var pending: [RTCIceCandidate] = []
    var onCandidate: (([String: Any]) -> Void)?
    var onState: ((RTCIceConnectionState) -> Void)?
    var closed = false
    var connected = false
    var volume: Double = 0.65 { didSet { updateVolume() } }
    static let factory: RTCPeerConnectionFactory = { RTCInitializeSSL(); return RTCPeerConnectionFactory() }()

    init(id: String, servers: [RTCIceServer], muted: Bool) throws {
        self.id = id
        let config = RTCConfiguration(); config.iceServers = servers
        config.sdpSemantics = .unifiedPlan
        config.continualGatheringPolicy = .gatherContinually
        guard let connection = Self.factory.peerConnection(with: config, constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil), delegate: nil) else {
            throw ServiceError.message("Could not create an audio connection.")
        }
        pc = connection
        local = Self.factory.audioTrack(with: Self.factory.audioSource(with: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)), trackId: "microphone")
        local.isEnabled = !muted
        super.init()
        pc.delegate = self; pc.add(local, streamIds: ["automaps-audio"])
    }
    func mute(_ value: Bool) { local.isEnabled = !value && !closed }
    func close() { closed = true; local.isEnabled = false; pc.delegate = nil; pc.close(); pending.removeAll() }
    private func updateVolume() {
        for receiver in pc.receivers { (receiver.track as? RTCAudioTrack)?.source.volume = volume }
    }
    func description(offer: Bool) async throws -> String {
        let sdp: RTCSessionDescription = try await withCheckedThrowingContinuation { continuation in
            let done: (RTCSessionDescription?, Error?) -> Void = { value, error in
                if let error { continuation.resume(throwing: error) }
                else if let value { continuation.resume(returning: value) }
                else { continuation.resume(throwing: ServiceError.message("Missing audio description.")) }
            }
            let constraints = RTCMediaConstraints(mandatoryConstraints: ["OfferToReceiveAudio": "true", "OfferToReceiveVideo": "false"], optionalConstraints: nil)
            if offer { pc.offer(for: constraints, completionHandler: done) } else { pc.answer(for: constraints, completionHandler: done) }
        }
        guard !closed else { throw CancellationError() }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            pc.setLocalDescription(sdp) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
        return sdp.sdp
    }
    func receive(type: String, data: VoiceSignal.Payload) async throws {
        guard !closed else { throw CancellationError() }
        if type == "candidate", let candidate = data.candidate, !candidate.isEmpty {
            let ice = RTCIceCandidate(sdp: candidate, sdpMLineIndex: data.sdpMLineIndex ?? 0, sdpMid: data.sdpMid)
            if pc.remoteDescription == nil {
                guard pending.count < 64 else { throw ServiceError.message("Too many pending audio candidates.") }
                pending.append(ice)
            } else { try await add(ice) }
        } else if let sdp = data.sdp, ["offer", "answer"].contains(type) {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                pc.setRemoteDescription(RTCSessionDescription(type: type == "offer" ? .offer : .answer, sdp: sdp)) { error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume() }
                }
            }
            guard !closed else { throw CancellationError() }
            let queued = pending; pending.removeAll()
            for ice in queued { try await add(ice) }
            updateVolume()
        }
    }
    private func add(_ ice: RTCIceCandidate) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            pc.add(ice) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        Task { @MainActor in
            guard !self.closed else { return }
            var data: [String: Any] = ["candidate": candidate.sdp, "sdpMLineIndex": candidate.sdpMLineIndex]
            if let mid = candidate.sdpMid { data["sdpMid"] = mid }
            self.onCandidate?(data)
        }
    }
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        Task { @MainActor in
            guard !self.closed else { return }
            self.connected = newState == .connected || newState == .completed
            self.updateVolume(); self.onState?(newState)
        }
    }
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) { Task { @MainActor in self.updateVolume() } }
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    nonisolated func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) { dataChannel.close() }
}

struct VoiceState: Decodable { let enabled: Bool }
struct VoicePoll: Decodable { let peers: [Driver]; let signals: [VoiceSignal] }
struct VoiceSignal: Decodable {
    let from: String; let type: String; let data: Payload
    struct Payload: Decodable { let sdp: String?; let candidate: String?; let sdpMid: String?; let sdpMLineIndex: Int32? }
}
struct VoiceConfig: Decodable {
    let iceServers: [Server]
    struct Server: Decodable {
        let urls: [String]; let username: String?; let credential: String?
        enum CodingKeys: String, CodingKey { case urls, username, credential }
        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            if let single = try? values.decode(String.self, forKey: .urls) { urls = [single] }
            else { urls = try values.decode([String].self, forKey: .urls) }
            username = try values.decodeIfPresent(String.self, forKey: .username)
            credential = try values.decodeIfPresent(String.self, forKey: .credential)
        }
        var rtc: RTCIceServer { RTCIceServer(urlStrings: urls, username: username, credential: credential) }
    }
}
