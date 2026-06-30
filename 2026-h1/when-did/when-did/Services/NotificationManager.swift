import Foundation
import UserNotifications

enum NotificationManager {
    static func isAuthorized() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()

        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .denied, .notDetermined:
            return false
        @unknown default:
            return false
        }
    }

    /// 通知の利用許可を確認し、未確認なら許可ダイアログを表示する
    static func requestAuthorization() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()

        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .denied:
            return false
        case .notDetermined:
            return (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        @unknown default:
            return false
        }
    }

    /// 項目の状態に合わせて通知を予約し直す。
    /// 履歴の追加・編集・削除や項目設定の変更後に呼ぶ。
    @MainActor
    @discardableResult
    static func sync(_ tracker: Tracker) async -> Bool {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [tracker.notificationId])

        guard tracker.isNotificationEnabled,
              let dueDate = tracker.nextDueDate else { return true }

        guard await isAuthorized() else { return false }

        // 目安日の朝9時に通知する。すでに過ぎている場合は予約しない。
        var components = Calendar.current.dateComponents([.year, .month, .day], from: dueDate)
        components.hour = 9
        components.minute = 0

        guard let fireDate = Calendar.current.date(from: components), fireDate > Date() else { return true }

        let content = UNMutableNotificationContent()
        content.title = tracker.title
        content.body = "前回から\(tracker.normalizedIntervalValue)\(tracker.intervalUnitLabel)が経ちました。そろそろ実施の目安日です。"
        content.sound = .default

        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        let request = UNNotificationRequest(
            identifier: tracker.notificationId,
            content: content,
            trigger: trigger
        )

        do {
            try await add(request, to: center)
            return true
        } catch {
            return false
        }
    }

    /// 項目の削除時に呼び、予約済みの通知を取り消す
    static func cancel(_ trackers: [Tracker]) {
        cancel(ids: trackers.map(\.notificationId))
    }

    static func cancel(ids: [String]) {
        guard !ids.isEmpty else { return }
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids)
    }

    private static func add(_ request: UNNotificationRequest, to center: UNUserNotificationCenter) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            center.add(request) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }
}
