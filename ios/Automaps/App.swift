import UIKit
import SwiftUI
import Intents

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {}

final class PhoneSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.rootViewController = UIHostingController(rootView: PhoneView())
        self.window = window; window.makeKeyAndVisible()
        for activity in connectionOptions.userActivities { handle(activity) }
    }
    func sceneDidEnterBackground(_ scene: UIScene) {
        if !DriveStore.shared.carPlayConnected && !NativeVoice.shared.active { DriveStore.shared.stop() }
    }
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) { handle(userActivity) }
    private func handle(_ activity: NSUserActivity) {
        guard let intent = activity.interaction?.intent as? INStartCallIntent,
              intent.callCapability != .videoCall,
              let contacts = intent.contacts, contacts.count == 1,
              ["automaps-nearby", "nearby drivers"].contains((contacts[0].personHandle?.value ?? contacts[0].displayName).lowercased()) else { return }
        NativeVoice.shared.join()
    }
}
