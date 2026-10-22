import Foundation
import Combine
import CoreLocation
import MapKit
import UIKit

@MainActor
final class DriveStore: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let shared = DriveStore()
    static let phrases = ["Nice car! 👍", "Hello, neighbor! 👋", "Thanks, neighbor!", "You can merge ahead.", "Your lights are off.", "Your trunk is open.", "Your tire looks low.", "Safe travels!", "Hazard ahead."]
    @Published var profile = Profile()
    @Published var peers: [Driver] = []
    @Published var reports: [RoadReport] = []
    @Published var messages: [ChatMessage] = []
    @Published var location: CLLocation?
    @Published var speedLimit: SpeedLimit?
    @Published var status = "Offline · Ghost by default"
    @Published var live = false
    @Published var connecting = false
    @Published var route: MKRoute?
    @Published var destination: MKMapItem?
    @Published var origin: MKMapItem?
    @Published var backend = "http://localhost:4173"
    var carPlayConnected = false { didSet { updateBackgroundUse() } }
    private var scanning = false
    var freshLocation: Bool { live && location.map { $0.horizontalAccuracy >= 0 && abs($0.timestamp.timeIntervalSinceNow) < 12 } == true }
    func updateBackgroundUse() {
        manager.allowsBackgroundLocationUpdates = live && (carPlayConnected || NativeVoice.shared.active)
        if live && !carPlayConnected && !NativeVoice.shared.active && UIApplication.shared.applicationState == .background { stop() }
    }
    private(set) var userID = ""
    private var token: String?
    private let manager = CLLocationManager()
    private var loop: Task<Void, Never>?
    private var lastLimit = Date.distantPast
    private var limitLocation: CLLocation?
    var parked: Bool {
        guard let location, abs(location.timestamp.timeIntervalSinceNow) < 12 else { return false }
        return location.speed >= 0 && location.speed <= 0.5
    }
    var mph: Int? {
        guard let location, location.speed >= 0, abs(location.timestamp.timeIntervalSinceNow) < 12 else { return nil }
        return Int((location.speed * 2.23694).rounded())
    }
    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .automotiveNavigation
    }
    func request<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        guard let base = URL(string: backend), let scheme = base.scheme,
              scheme == "https" || (scheme == "http" && ["localhost", "127.0.0.1"].contains(base.host ?? "")),
              let url = URL(string: "/api/\(path)", relativeTo: base) else {
            throw ServiceError.message("Use an HTTPS server, or localhost for Simulator development.")
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 15
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            if (response as? HTTPURLResponse)?.statusCode == 401 { stop() }
            let error = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw ServiceError.message(error?["error"] as? String ?? "Server unavailable.")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
    func start() async {
        guard !live && !connecting else { return }
        connecting = true
        defer { connecting = false }
        do {
            let s: SessionResponse = try await request("session", method: "POST", body: [:])
            token = s.token; userID = s.id
            try await saveProfile()
            live = true
            manager.requestWhenInUseAuthorization()
            manager.allowsBackgroundLocationUpdates = carPlayConnected
            manager.startUpdatingLocation()
            status = "Waiting for a precise GPS fix"
            loop = Task { [weak self] in
                while !Task.isCancelled {
                    await self?.scan()
                    try? await Task.sleep(for: .seconds(2))
                }
            }
        } catch { status = error.localizedDescription }
    }
    func stop() {
        live = false; manager.stopUpdatingLocation(); manager.allowsBackgroundLocationUpdates = false
        NativeVoice.shared.revoke()
        loop?.cancel(); loop = nil; peers = []; reports = []; messages = []; location = nil; speedLimit = nil
        let oldToken = token; let oldBackend = backend
        token = nil; status = "Offline · presence expires within 12 seconds"
        Task {
            guard let oldToken, let url = URL(string: "\(oldBackend)/api/session") else { return }
            var req = URLRequest(url: url); req.httpMethod = "DELETE"
            req.setValue("Bearer \(oldToken)", forHTTPHeaderField: "Authorization")
            _ = try? await URLSession.shared.data(for: req)
        }
    }
    func saveProfile() async throws {
        let _: Driver = try await request("profile", method: "PUT", body: ["mode": profile.mode, "name": profile.name, "make": profile.make, "model": profile.model, "radius": profile.radius])
        if profile.mode == "ghost" { profile.name = ""; profile.make = ""; profile.model = "" }
    }
    private func scan() async {
        guard live, !scanning else { return }
        scanning = true
        defer { scanning = false }
        let currentToken = token
        do {
            if let p = location, abs(p.timestamp.timeIntervalSinceNow) < 12 {
                let speed: Any = p.speed >= 0 ? p.speed as Any : NSNull()
                let _: OK = try await request("location", method: "PUT", body: ["lat": p.coordinate.latitude, "lng": p.coordinate.longitude, "accuracy": p.horizontalAccuracy, "timestamp": p.timestamp.timeIntervalSince1970 * 1000, "speed": speed])
            }
            let nearby: NearbyResponse = try await request("nearby")
            let inbox: [ChatMessage] = try await request("messages")
            guard live, currentToken == token else { return }
            peers = nearby.peers; reports = nearby.reports; messages = inbox
            status = !nearby.locationFresh ? "Waiting for fresh GPS" : nearby.accuracyLimited ? "GPS uncertainty exceeds your radius" : "Nearby refreshed · every 2 seconds"
            if let p = location, p.horizontalAccuracy <= 10, abs(p.timestamp.timeIntervalSinceNow) < 12, Date().timeIntervalSince(lastLimit) > 30 {
                lastLimit = Date()
                let response: LimitResponse = try await request("speed-limit", method: "POST", body: ["lat": p.coordinate.latitude, "lng": p.coordinate.longitude])
                guard live, currentToken == token else { return }
                speedLimit = response.limit; limitLocation = p
            }
        } catch {
            guard live, currentToken == token else { return }
            peers = []; status = error.localizedDescription
        }
    }
    func send(to: String, text: String) async throws {
        let _: ChatMessage = try await request("messages", method: "POST", body: ["to": to, "text": text])
        await scan()
    }
    func report(_ type: String) async throws {
        let _: RoadReport = try await request("reports", method: "POST", body: ["type": type])
        await scan()
    }
    func block(_ id: String) async throws {
        let _: OK = try await request("block", method: "POST", body: ["id": id])
        NativeVoice.shared.block(id)
        await scan()
    }
    func flag(_ id: String) async throws {
        let _: OK = try await request("flag", method: "POST", body: ["id": id])
        await scan()
    }
    func plan(start: String, end: String) async throws {
        func search(_ query: String) async throws -> MKMapItem {
            let request = MKLocalSearch.Request(); request.naturalLanguageQuery = query
            let response = try await MKLocalSearch(request: request).start()
            guard let item = response.mapItems.first else { throw ServiceError.message("Place not found.") }
            return item
        }
        let source: MKMapItem
        if start.trimmingCharacters(in: .whitespaces).isEmpty {
            guard let location else { throw ServiceError.message("Enter a start location or connect GPS.") }
            source = MKMapItem(placemark: MKPlacemark(coordinate: location.coordinate)); source.name = "Current location"
        } else { source = try await search(start) }
        let target = try await search(end)
        let request = MKDirections.Request(); request.source = source; request.destination = target; request.transportType = .automobile
        let response = try await MKDirections(request: request).calculate()
        guard let result = response.routes.first else { throw ServiceError.message("No driving route found.") }
        origin = source; destination = target; route = result
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard live, let p = locations.last, p.horizontalAccuracy >= 0 else { return }
        location = p
        if let limitLocation, p.distance(from: limitLocation) > 30 { speedLimit = nil }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { status = error.localizedDescription }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if [.denied, .restricted].contains(manager.authorizationStatus) { stop(); status = "Enable location access in Settings to connect." }
    }
}
