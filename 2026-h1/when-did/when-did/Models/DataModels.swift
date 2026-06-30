import Foundation
import SwiftData
import SwiftUI

// MARK: - Category Color

enum CategoryColor: Int, Codable, CaseIterable {
    case red = 0
    case blue = 1
    case green = 2
    case yellow = 3
    case purple = 4
    case gray = 5

    var label: String {
        switch self {
        case .red: return "赤"
        case .blue: return "青"
        case .green: return "緑"
        case .yellow: return "黄"
        case .purple: return "紫"
        case .gray: return "灰"
        }
    }

    var color: Color {
        switch self {
        case .red: return .red
        case .blue: return .blue
        case .green: return .green
        case .yellow: return .yellow
        case .purple: return .purple
        case .gray: return .gray
        }
    }
}

// MARK: - Models

enum TrackerInterval {
    static let allowedRange = 1...999

    static func clamped(_ value: Int) -> Int {
        min(max(value, allowedRange.lowerBound), allowedRange.upperBound)
    }
}

@Model
final class TrackerCategory {
    var title: String
    var colorRaw: Int
    var createdAt: Date

    @Relationship(deleteRule: .cascade, inverse: \Tracker.category)
    var trackers: [Tracker] = []

    init(title: String, color: CategoryColor) {
        self.title = title
        self.colorRaw = color.rawValue
        self.createdAt = Date()
    }

    var uiColor: CategoryColor {
        CategoryColor(rawValue: colorRaw) ?? .gray
    }

    var totalAmountYen: Int {
        trackers.reduce(0) { $0 + $1.totalAmountYen }
    }
}

@Model
final class Tracker {
    var title: String
    var createdAt: Date

    var hasDue: Bool
    var intervalValue: Int
    var intervalUnitRaw: Int
    var isNotificationEnabled: Bool

    // ローカル通知の予約・取消に使う安定した識別子
    var notificationId: String = UUID().uuidString

    var category: TrackerCategory?

    @Relationship(deleteRule: .cascade, inverse: \TrackerEvent.tracker)
    var events: [TrackerEvent] = []

    init(
        title: String,
        category: TrackerCategory? = nil,
        hasDue: Bool = false,
        intervalValue: Int = 30,
        intervalUnitRaw: Int = 0,
        isNotificationEnabled: Bool = false
    ) {
        self.title = title
        self.category = category
        self.createdAt = Date()
        self.hasDue = hasDue
        self.intervalValue = intervalValue
        self.intervalUnitRaw = intervalUnitRaw
        self.isNotificationEnabled = isNotificationEnabled
    }

    var totalAmountYen: Int {
        events.reduce(0) { $0 + $1.amountYen }
    }

    var lastEventDate: Date? {
        events.map(\.date).max()
    }

    /// 最後の実施日から今日までの経過日数。履歴がなければnil。
    /// 未来日の履歴は許容しているため、負の値になることもある。
    var daysSinceLastEvent: Int? {
        guard let lastDate = lastEventDate else { return nil }
        return Calendar.current.dateComponents(
            [.day],
            from: lastDate.startOfDay,
            to: Date().startOfDay
        ).day
    }

    var nextDueDate: Date? {
        guard hasDue, let lastDate = lastEventDate else { return nil }
        let calendar = Calendar.current
        let baseDate = lastDate.startOfDay
        let value = normalizedIntervalValue
        switch intervalUnitRaw {
        case 1: return calendar.date(byAdding: .month, value: value, to: baseDate)
        case 2: return calendar.date(byAdding: .year, value: value, to: baseDate)
        default: return calendar.date(byAdding: .day, value: value, to: baseDate)
        }
    }

    var normalizedIntervalValue: Int {
        TrackerInterval.clamped(intervalValue)
    }

    var intervalUnitLabel: String {
        switch intervalUnitRaw {
        case 1: return "ヶ月"
        case 2: return "年"
        default: return "日"
        }
    }

    var intervalDescription: String {
        "\(normalizedIntervalValue)\(intervalUnitLabel)ごと"
    }
}

@Model
final class TrackerEvent {
    var date: Date
    var note: String?
    var amountYen: Int

    var tracker: Tracker?

    init(date: Date, tracker: Tracker? = nil, note: String? = nil, amountYen: Int = 0) {
        self.date = date
        self.tracker = tracker
        self.note = note
        self.amountYen = amountYen
    }
}

// MARK: - Display Helpers

extension Date {
    private static let slashFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "y/M/d"
        return formatter
    }()

    var slashFormat: String {
        Self.slashFormatter.string(from: self)
    }
    
    var startOfDay: Date {
        Calendar.current.startOfDay(for: self)
    }
}

extension Int {
    var yenText: String {
        return "¥\(self.formatted(.number))"
    }
}
