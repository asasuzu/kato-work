//
//  WhenDidApp.swift
//  WhenDid
//
//  Created by あさすず on 2026/01/07.
//

import SwiftUI
import SwiftData
import UserNotifications

// アプリを開いたままでも通知バナーを表示する
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}

@main
struct WhenDidApp: App {
    private let notificationDelegate = NotificationDelegate()

    init() {
        UNUserNotificationCenter.current().delegate = notificationDelegate
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: [TrackerCategory.self, Tracker.self, TrackerEvent.self])
    }
}
