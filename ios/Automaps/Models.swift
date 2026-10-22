import Foundation
import CoreLocation

struct SessionResponse: Decodable { let token: String; let id: String }
struct OK: Decodable { let ok: Bool }
struct Profile: Codable {
    var mode = "ghost"
    var name = ""
    var make = ""
    var model = ""
    var radius = 30
}
struct Driver: Decodable, Identifiable {
    let id: String
    let mode: String
    let name: String
    let make: String?
    let model: String?
    let lat: Double?
    let lng: Double?
    let distanceFt: Int?
    var subtitle: String { mode == "ghost" ? "Identity hidden" : "\(make ?? "") \(model ?? "")" }
    var coordinate: CLLocationCoordinate2D? {
        guard let lat, let lng else { return nil }
        return .init(latitude: lat, longitude: lng)
    }
}
struct RoadReport: Decodable, Identifiable {
    let id: String
    let type: String
    let lat: Double
    let lng: Double
}
struct NearbyResponse: Decodable {
    let peers: [Driver]
    let reports: [RoadReport]
    let locationFresh: Bool
    let accuracyLimited: Bool
}
struct ChatMessage: Decodable, Identifiable {
    let id: String
    let from: String
    let to: String
    let text: String
    let sender: Driver
}
struct SpeedLimit: Decodable {
    let value: Double
    let unit: String
    var mph: Int { Int((value * (unit == "mph" ? 1 : 0.621371)).rounded()) }
}
struct LimitResponse: Decodable { let limit: SpeedLimit? }

enum ServiceError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let message) = self { return message }; return nil }
}
