import SwiftUI
import MapKit

struct PhoneView: View {
    @ObservedObject private var store = DriveStore.shared
    @State private var consent = false
    @State private var showProfile = false
    @State private var start = ""
    @State private var end = ""
    @State private var planning = false
    @State private var error = ""
    var body: some View {
        NavigationStack {
            TabView {
                VStack(spacing: 0) {
                    NativeMapView().overlay(alignment: .topLeading) {
                        HStack {
                            Label("\(store.mph.map(String.init) ?? "—") mph", systemImage: "speedometer")
                            Text("LIMIT \(store.speedLimit.map { String($0.mph) } ?? "—")")
                        }.font(.headline).padding().background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12)).padding()
                    }
                    VStack {
                        TextField("Start (blank = current location)", text: $start)
                            .disabled(store.live && !store.parked)
                        TextField("Destination", text: $end)
                            .disabled(store.live && !store.parked)
                        Button(planning ? "Finding route…" : "Plan route") {
                            planning = true
                            Task { do { try await store.plan(start: start, end: end) } catch { self.error = error.localizedDescription }; planning = false }
                        }.disabled(end.isEmpty || planning || (store.live && !store.parked))
                        if let route = store.route {
                            Text("\(Int(route.expectedTravelTime / 60)) min · \(String(format: "%.1f", route.distance / 1609.34)) mi")
                            Button("Continue in Apple Maps") { store.destination?.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving]) }
                        }
                    }.textFieldStyle(.roundedBorder).padding()
                }.tabItem { Label("Map", systemImage: "map") }
                List {
                    Section("Nearby · scans every 2 seconds") {
                        if store.peers.isEmpty { Text("No drivers confirmed within your GPS radius.").foregroundStyle(.secondary) }
                        ForEach(store.peers) { peer in
                            NavigationLink(destination: ChatView(peer: peer)) {
                                HStack {
                                    Image(systemName: peer.mode == "ghost" ? "person.crop.circle.dashed" : "car.fill").foregroundStyle(.green)
                                    VStack(alignment: .leading) { Text(peer.name); Text(peer.subtitle).font(.caption).foregroundStyle(.secondary) }
                                    Spacer(); Text("\(peer.distanceFt ?? 0) ft").font(.caption)
                                }.padding(.vertical, 8)
                            }
                        }
                    }
                    Section("Community road reports · unverified") {
                        ForEach(["hazard", "camera", "police"], id: \.self) { type in
                            Button(type == "camera" ? "Report red-light camera" : "Report \(type)") {
                                Task { do { try await store.report(type) } catch { self.error = error.localizedDescription } }
                            }.disabled(!store.live)
                        }
                    }
                }.tabItem { Label("Nearby", systemImage: "car.2") }
                VoiceView().tabItem { Label("Voice", systemImage: "waveform") }
            }
            .navigationTitle("Automaps")
            .safeAreaInset(edge: .bottom) { Text(store.status).font(.caption).padding(8).frame(maxWidth: .infinity).background(.regularMaterial) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button(store.profile.mode == "ghost" ? "Ghost" : "Active") { showProfile = true } }
                ToolbarItem(placement: .topBarTrailing) { Button(store.live ? "Stop" : "Go live") { if store.live { store.stop() } else { consent = true } }.disabled(store.connecting) }
            }
            .sheet(isPresented: $showProfile) { ProfileView() }
            .alert("Share live location?", isPresented: $consent) {
                Button("Connect") { Task { await store.start() } }
                Button("Cancel", role: .cancel) {}
            } message: { Text("Your coordinates, accuracy and speed go to the configured Automaps server. Nearby drivers can see your position. Ghost hides your identity, not your position. Presence expires in 12 seconds; messages in 5 minutes. GPS may be too imprecise for this radius.") }
            .alert("Automaps", isPresented: Binding(get: { !error.isEmpty }, set: { if !$0 { error = "" } })) { Button("OK") { error = "" } } message: { Text(error) }
        }.tint(Color(red: 0.28, green: 0.55, blue: 0.36))
    }
}

struct ProfileView: View {
    @ObservedObject private var store = DriveStore.shared
    @Environment(\.dismiss) private var dismiss
    @State private var profile = Profile()
    @State private var backend = ""
    @State private var error = ""
    var body: some View {
        NavigationStack {
            Form {
                Picker("Presence", selection: $profile.mode) { Text("Ghost (anonymous)").tag("ghost"); Text("Active").tag("active") }
                if profile.mode == "active" {
                    TextField("Appropriate display name", text: $profile.name)
                    TextField("Make", text: $profile.make)
                    TextField("Model", text: $profile.model)
                }
                Picker("Chat radius", selection: $profile.radius) { ForEach([10,20,30], id: \.self) { Text("\($0) feet").tag($0) } }
                Section("Development server") {
                    TextField("HTTPS backend URL", text: $backend).textInputAutocapitalization(.never).autocorrectionDisabled().disabled(store.live)
                    Text("Use localhost in Simulator or your own HTTPS server on a device. No server is deployed automatically.").font(.caption)
                }
                if !error.isEmpty { Text(error).foregroundStyle(.red) }
                Button("Save") {
                    if profile.mode == "active" && [profile.name,profile.make,profile.model].contains(where: { $0.trimmingCharacters(in: .whitespaces).isEmpty }) { error = "Enter a name, make and model."; return }
                    let old = store.profile
                    store.profile = profile
                    if !store.live { store.backend = backend; dismiss(); return }
                    Task { do { try await store.saveProfile(); dismiss() } catch { store.profile = old; self.error = error.localizedDescription } }
                }
            }.disabled(store.live && !store.parked).navigationTitle("Your presence").onAppear { profile = store.profile; backend = store.backend }
        }
    }
}

struct ChatView: View {
    let peer: Driver
    @ObservedObject private var store = DriveStore.shared
    @State private var text = ""
    @State private var error = ""
    var body: some View {
        List {
            ForEach(store.messages.filter { $0.from == peer.id || $0.to == peer.id }) { message in
                VStack(alignment: .leading) {
                    Text(message.from == store.userID ? "You" : message.sender.name).font(.caption).foregroundStyle(.secondary)
                    Text(message.text)
                    if message.from == peer.id { Button("Report & block", role: .destructive) { Task { do { try await store.flag(message.id) } catch { self.error = error.localizedDescription } } } }
                }
            }
            Section("Quick replies") {
                ForEach(DriveStore.phrases, id: \.self) { phrase in Button(phrase) { send(phrase) }.disabled(!store.peers.contains { $0.id == peer.id }) }
            }
            Section(store.parked ? "Message" : "Typed chat is locked while moving or speed is unknown") {
                TextField("Message", text: $text).disabled(!store.parked)
                Button("Send") { send(text) }.disabled(!store.parked || text.isEmpty)
            }
            Button("Block driver", role: .destructive) { Task { do { try await store.block(peer.id) } catch { self.error = error.localizedDescription } } }
            if !error.isEmpty { Text(error).foregroundStyle(.red) }
        }.navigationTitle(peer.name)
    }
    private func send(_ message: String) { Task { do { try await store.send(to: peer.id, text: message); text = "" } catch { self.error = error.localizedDescription } } }
}

struct NativeMapView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> MapController { MapController() }
    func updateUIViewController(_ controller: MapController, context: Context) {}
}
