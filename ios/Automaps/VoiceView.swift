import SwiftUI

struct VoiceView: View {
    @ObservedObject private var voice = NativeVoice.shared
    @ObservedObject private var store = DriveStore.shared
    @State private var consent = false
    var body: some View {
        List {
            Section("Nearby voice") {
                Label(voice.active ? "Room enabled" : "Room off", systemImage: "waveform")
                Text(voice.status).foregroundStyle(.secondary)
                if !voice.prepared {
                    Button("Set up voice while parked") { consent = true }.disabled(!store.parked || !store.live)
                }
                Button(voice.starting ? "Connecting…" : "Join nearby voice") { voice.join() }
                    .disabled(!voice.prepared || !store.freshLocation || voice.active || voice.starting)
                Button(voice.muted ? "Unmute microphone" : "Mute microphone") { voice.toggleMute() }.disabled(!voice.active)
                Button("End voice completely", role: .destructive) { voice.leave() }.disabled(!voice.active && !voice.starting)
                Text("You join all nearby drivers who enabled voice. New eligible drivers can join while the room is enabled. Your microphone starts muted.").font(.caption)
            }
            Section("Voice playback") {
                Slider(value: $voice.volume, in: 0...1) { Text("Voice volume") }
                Text("Music and navigation prompts follow the system's call audio policy. This slider controls received voice only.").font(.caption)
            }
            Section("Eligible voice participants · audio may still be connecting") {
                if voice.participants.isEmpty { Text("No voice participants in confirmed range.") }
                ForEach(voice.participants) { peer in
                    VStack(alignment: .leading) {
                        Text(peer.name)
                        Text(peer.subtitle).font(.caption)
                        Button("Block", role: .destructive) { Task { try? await store.block(peer.id) } }
                    }
                }
            }
        }.navigationTitle("Nearby voice")
        .alert("Enable nearby conversations?", isPresented: $consent) {
            Button("Allow voice setup") { Task { await voice.prepare() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Joining connects you to nearby drivers who opted in, including new arrivals. They may record what they hear. Direct WebRTC connections may expose network addresses. Microphone access is requested now, but voice starts only after you tap Join. CallKit controls mute and end. This is an unvalidated development build.")
        }
    }
}
