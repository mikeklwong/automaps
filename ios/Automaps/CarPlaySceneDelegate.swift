import CarPlay
import MapKit
import Combine

/// Requires Apple's granted navigation entitlement. Browser UI is never projected into CarPlay.
@MainActor
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate, CPMapTemplateDelegate {
    private var controller: CPInterfaceController?
    private var mapController: MapController?
    private let template = CPMapTemplate()
    private var subscriptions = Set<AnyCancellable>()
    private var nearbyTemplate: CPListTemplate?
    private var voiceTemplate: CPListTemplate?
    private var navigation: CPNavigationSession?
    private var maneuvers: [CPManeuver] = []
    private var stepIndex = 0

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController, to window: CPWindow) {
        controller = interfaceController
        let store = DriveStore.shared; store.carPlayConnected = true
        let map = MapController(); mapController = map; window.rootViewController = map
        template.mapDelegate = self
        template.automaticallyHidesNavigationBar = false
        template.trailingNavigationBarButtons = [
            CPBarButton(title: "Nearby") { [weak self] _ in self?.showNearby() },
            CPBarButton(title: "Report") { [weak self] _ in self?.showReports() }
        ]
        let recenter = CPMapButton { [weak self] _ in self?.mapController?.map.setUserTrackingMode(.followWithHeading, animated: true) }
        recenter.image = UIImage(systemName: "location.fill")
        template.mapButtons = [recenter]
        interfaceController.setRootTemplate(template, animated: false, completion: nil)
        store.$peers.sink { [weak self] _ in self?.refreshNearby() }.store(in: &subscriptions)
        store.$route.sink { [weak self] route in if let route { self?.preview(route) } }.store(in: &subscriptions)
        store.$location.sink { [weak self] location in self?.updateProgress(location) }.store(in: &subscriptions)
        NativeVoice.shared.$status.combineLatest(NativeVoice.shared.$active, NativeVoice.shared.$muted)
            .receive(on: DispatchQueue.main).sink { [weak self] _ in self?.refreshVoice() }.store(in: &subscriptions)
        if !store.live { notice("Connect on your iPhone while parked", detail: "Review location sharing and tap Go live to enable nearby drivers.") }
    }
    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didDisconnect interfaceController: CPInterfaceController, from window: CPWindow) {
        navigation?.finishTrip(); navigation = nil; subscriptions.removeAll()
        DriveStore.shared.carPlayConnected = false; DriveStore.shared.stop()
        controller = nil; mapController = nil; window.rootViewController = nil
    }
    private func nearbyItems() -> [CPListItem] {
        let peers = DriveStore.shared.peers
        guard !peers.isEmpty else { return [CPListItem(text: "No drivers confirmed nearby", detailText: DriveStore.shared.status)] }
        return peers.prefix(20).map { peer in
            let item = CPListItem(text: peer.name, detailText: "\(peer.subtitle) · \(peer.distanceFt ?? 0) ft", image: UIImage(systemName: "car.fill"))
            item.handler = { [weak self] _, completion in
                self?.showVoice()
                completion()
            }
            return item
        }
    }
    private func showNearby() {
        let list = CPListTemplate(title: "Nearby · \(DriveStore.shared.profile.radius) ft", sections: [CPListSection(items: nearbyItems())])
        nearbyTemplate = list; controller?.pushTemplate(list, animated: true, completion: nil)
    }
    private func refreshNearby() { nearbyTemplate?.updateSections([CPListSection(items: nearbyItems())]) }
    private func voiceItems() -> [CPListItem] {
        let voice = NativeVoice.shared
        let status = CPListItem(text: "Nearby voice", detailText: voice.status)
        let join = CPListItem(text: voice.active ? (voice.muted ? "Unmute microphone" : "Mute microphone") : "Join nearby voice", detailText: "All eligible opted-in drivers · starts muted")
        join.handler = { [weak self] _, completion in
            if voice.active { voice.toggleMute() }
            else if voice.prepared { voice.join() }
            else { self?.notice("Set up voice while parked", detail: "Use the iPhone Voice tab to review consent and allow the microphone first.") }
            completion()
        }
        let end = CPListItem(text: "End voice completely", detailText: "Disconnect everyone and stop microphone audio")
        end.handler = { _, completion in voice.leave(); completion() }
        return [status, join, end]
    }
    private func showVoice() {
        let list = CPListTemplate(title: "Automaps voice", sections: [CPListSection(items: voiceItems())])
        voiceTemplate = list; controller?.pushTemplate(list, animated: true, completion: nil)
    }
    private func refreshVoice() { voiceTemplate?.updateSections([CPListSection(items: voiceItems())]) }
    private func showReports() {
        let items = [("Road hazard", "hazard"), ("Red-light camera", "camera"), ("Police presence", "police")].map { title, type in
            let item = CPListItem(text: title, detailText: "Report at your current location")
            item.handler = { [weak self] _, completion in
                Task { @MainActor in
                    do { try await DriveStore.shared.report(type); self?.controller?.popTemplate(animated: true, completion: nil) }
                    catch { self?.notice("Report unavailable", detail: error.localizedDescription) }
                    completion()
                }
            }
            return item
        }
        controller?.pushTemplate(CPListTemplate(title: "Report road condition", sections: [CPListSection(items: items)]), animated: true, completion: nil)
    }
    private func preview(_ route: MKRoute) {
        let store = DriveStore.shared
        guard let destination = store.destination, let origin = store.origin else { return }
        let choice = CPRouteChoice(summaryVariants: ["\(Int(route.expectedTravelTime / 60)) min"], additionalInformationVariants: [route.name], selectionSummaryVariants: ["\(String(format: "%.1f", route.distance / 1609.34)) mi"])
        let trip = CPTrip(origin: origin, destination: destination, routeChoices: [choice])
        template.showTripPreviews([trip], textConfiguration: CPTripPreviewTextConfiguration(startButtonTitle: "Start", additionalRoutesButtonTitle: nil, overviewButtonTitle: "Overview"))
    }
    func mapTemplate(_ mapTemplate: CPMapTemplate, startedTrip trip: CPTrip, using routeChoice: CPRouteChoice) {
        mapTemplate.hideTripPreviews(); navigation?.finishTrip()
        navigation = mapTemplate.startNavigationSession(for: trip); stepIndex = 0
        maneuvers = (DriveStore.shared.route?.steps ?? []).filter { !$0.instructions.isEmpty }.map { step in
            let m = CPManeuver(); m.instructionVariants = [step.instructions]
            m.initialTravelEstimates = CPTravelEstimates(distanceRemaining: Measurement(value: step.distance, unit: UnitLength.meters), timeRemaining: 0)
            return m
        }
        navigation?.upcomingManeuvers = Array(maneuvers.prefix(2))
        mapController?.map.setUserTrackingMode(.followWithHeading, animated: true)
    }
    private func updateProgress(_ location: CLLocation?) {
        let store = DriveStore.shared
        let speed = store.mph.map(String.init) ?? "—"
        let limit = store.speedLimit.map { String($0.mph) } ?? "—"
        template.leadingNavigationBarButtons = [CPBarButton(title: "\(speed) mph · Limit \(limit)") { [weak self] _ in
            self?.notice("Speed information", detail: "GPS estimate. Map limits may be missing or outdated; follow posted signs.")
        }, CPBarButton(title: "Voice") { [weak self] _ in self?.showVoice() }]
        guard navigation != nil, let location, let route = store.route else { return }
        let steps = route.steps.filter { !$0.instructions.isEmpty }
        if stepIndex + 1 < steps.count {
            let c = steps[stepIndex + 1].polyline.coordinate
            if location.distance(from: CLLocation(latitude: c.latitude, longitude: c.longitude)) < 15 { stepIndex += 1 }
        }
        navigation?.upcomingManeuvers = Array(maneuvers.dropFirst(stepIndex).prefix(2))
        // Production requires map matching, off-route rerouting, voice guidance and arrival verification.
    }
    func mapTemplateDidCancelNavigation(_ mapTemplate: CPMapTemplate) { navigation?.cancelTrip(); navigation = nil }
    private func notice(_ title: String, detail: String) {
        let action = CPAlertAction(title: "OK", style: .default) { [weak self] _ in self?.controller?.dismissTemplate(animated: true, completion: nil) }
        controller?.presentTemplate(CPAlertTemplate(titleVariants: ["\(title). \(detail)"], actions: [action]), animated: true, completion: nil)
    }
}
