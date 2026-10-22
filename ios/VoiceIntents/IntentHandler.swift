import Intents

final class IntentHandler: INExtension, INStartCallIntentHandling {
    override func handler(for intent: INIntent) -> Any { self }
    func resolveContacts(for intent: INStartCallIntent, with completion: @escaping ([INPersonResolutionResult]) -> Void) {
        guard let contacts = intent.contacts, contacts.count == 1 else { completion([.needsValue()]); return }
        let person = contacts[0]
        let name = (person.personHandle?.value ?? person.displayName).lowercased()
        guard ["nearby drivers", "automaps-nearby"].contains(name) else { completion([.unsupported()]); return }
        completion([.success(with: person)])
    }
    func handle(intent: INStartCallIntent, completion: @escaping (INStartCallIntentResponse) -> Void) {
        guard intent.callCapability != .videoCall, let contacts = intent.contacts, contacts.count == 1,
              ["nearby drivers", "automaps-nearby"].contains((contacts[0].personHandle?.value ?? contacts[0].displayName).lowercased()) else {
            completion(INStartCallIntentResponse(code: .failure, userActivity: nil)); return
        }
        // The host checks session consent, microphone permission and fresh proximity before joining.
        completion(INStartCallIntentResponse(code: .continueInApp, userActivity: NSUserActivity(activityType: "INStartCallIntent")))
    }
}
