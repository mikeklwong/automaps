import UIKit
import MapKit
import Combine

@MainActor
final class MapController: UIViewController, MKMapViewDelegate {
    let map = MKMapView()
    private var subscriptions = Set<AnyCancellable>()
    private var centered = false
    private var displayedRoute: MKRoute?
    override func loadView() {
        view = map; map.delegate = self
        map.preferredConfiguration = MKStandardMapConfiguration(elevationStyle: .realistic)
        map.showsCompass = true
        map.setRegion(MKCoordinateRegion(center: .init(latitude: 37.7955, longitude: -122.3935), latitudinalMeters: 600, longitudinalMeters: 600), animated: false)
        let store = DriveStore.shared
        store.$peers.combineLatest(store.$reports).sink { [weak self] peers, reports in self?.draw(peers, reports) }.store(in: &subscriptions)
        store.$live.sink { [weak self] live in self?.map.showsUserLocation = live }.store(in: &subscriptions)
        store.$location.sink { [weak self] p in
            guard let self, let p, !centered else { return }
            centered = true
            map.setRegion(.init(center: p.coordinate, latitudinalMeters: 150, longitudinalMeters: 150), animated: true)
            map.setUserTrackingMode(.followWithHeading, animated: true)
        }.store(in: &subscriptions)
        store.$route.sink { [weak self] route in
            guard let self else { return }
            map.removeOverlays(map.overlays)
            if let route {
                displayedRoute = route; map.addOverlay(route.polyline)
                map.setVisibleMapRect(route.polyline.boundingMapRect, edgePadding: .init(top: 100, left: 40, bottom: 80, right: 40), animated: true)
            }
        }.store(in: &subscriptions)
    }
    private func draw(_ peers: [Driver], _ reports: [RoadReport]) {
        map.removeAnnotations(map.annotations.filter { !($0 is MKUserLocation) })
        for peer in peers {
            guard let coordinate = peer.coordinate else { continue }
            let pin = MKPointAnnotation(); pin.coordinate = coordinate; pin.title = peer.name; pin.subtitle = peer.subtitle
            map.addAnnotation(pin)
        }
        for report in reports {
            let pin = MKPointAnnotation(); pin.coordinate = .init(latitude: report.lat, longitude: report.lng)
            pin.title = "\(report.type.capitalized) · unverified"; pin.subtitle = "Community road report"
            map.addAnnotation(pin)
        }
    }
    func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
        if annotation is MKUserLocation { return nil }
        let view = MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: "driver")
        let report = annotation.subtitle == "Community road report"
        view.markerTintColor = report ? .systemOrange : .systemGreen
        view.glyphImage = UIImage(systemName: report ? "exclamationmark.triangle.fill" : "car.fill")
        view.canShowCallout = true
        return view
    }
    func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
        guard let line = overlay as? MKPolyline else { return MKOverlayRenderer(overlay: overlay) }
        let renderer = MKPolylineRenderer(polyline: line); renderer.strokeColor = .systemGreen; renderer.lineWidth = 6
        return renderer
    }
}
