import SwiftUI
import SwiftData

struct TrackerDetailView: View {
    @Environment(\.modelContext) private var modelContext
    @Bindable var tracker: Tracker
    
    @State private var showingAddEvent = false
    @State private var showingEditTracker = false
    
    @State private var newDate = Date()
    @State private var newAmount = 0
    @State private var newNote = ""
    
    @State private var editingEvent: TrackerEvent?
    @State private var showingDeleteAlert = false
    @State private var eventToDelete: TrackerEvent?
    @State private var showingSaveError = false

    private var sortedEvents: [TrackerEvent] {
        tracker.events.sorted { $0.date > $1.date }
    }

    private var daysStatus: (label: String, value: String)? {
        guard let days = tracker.daysSinceLastEvent else { return nil }
        if days < 0 {
            return ("予定まで", "あと\(abs(days))日")
        }
        if days == 0 {
            return ("実施日", "今日")
        }
        return ("経過", "\(days)日")
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    if let daysStatus {
                        HStack {
                            Text(daysStatus.label)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text(daysStatus.value)
                                .font(.system(size: 40, weight: .bold, design: .rounded))
                                .foregroundStyle(tracker.category?.uiColor.color ?? .primary)
                        }
                    } else {
                        Text("履歴がありません")
                            .font(.headline)
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 10)
                    }
                    
                    if let dueDate = tracker.nextDueDate {
                        Divider()
                        HStack {
                            Text("次の目安")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text(dueDate.slashFormat)
                                .fontWeight(.semibold)
                        }
                    }
                    
                    Divider()
                    HStack {
                        Text("累計金額")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text(tracker.totalAmountYen.yenText)
                            .fontWeight(.medium)
                    }
                }
                .padding(.vertical, 5)
            }
            
            Section(header: Text("履歴")) {
                if sortedEvents.isEmpty {
                    ContentUnavailableView(
                        "履歴がありません",
                        systemImage: "calendar.badge.plus",
                        description: Text("右上の追加ボタンから実施日を記録できます。")
                    )
                }

                ForEach(sortedEvents) { event in
                    Button {
                        editingEvent = event
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(event.date.slashFormat)
                                    .font(.body)
                                    .foregroundStyle(.primary)
                                if let note = event.note, !note.isEmpty {
                                    Text(note)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            Text(event.amountYen.yenText)
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            eventToDelete = event
                            showingDeleteAlert = true
                        } label: {
                            Label("削除", systemImage: "trash")
                        }
                    }
                }
            }
        }
        .navigationTitle(tracker.title)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Menu {
                    Button {
                        showingEditTracker = true
                    } label: {
                        Label("項目を編集", systemImage: "slider.horizontal.3")
                    }
                } label: {
                    Label("その他", systemImage: "ellipsis.circle")
                }
                
                Button {
                    newDate = Date()
                    newAmount = 0
                    newNote = ""
                    showingAddEvent = true
                } label: {
                    Label("履歴を追加", systemImage: "plus")
                }
            }
        }
        .sheet(isPresented: $showingAddEvent) {
            NavigationStack {
                Form {
                    DatePicker("実施日", selection: $newDate, displayedComponents: .date)
                        .datePickerStyle(.wheel)
                        .environment(\.locale, Locale(identifier: "ja_JP"))
                        .labelsHidden()
                    HStack {
                        Text("金額")
                        TextField("0", value: $newAmount, format: .number)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                        Text("円")
                    }
                    TextField("メモ (任意)", text: $newNote)
                }
                .navigationTitle("履歴を追加")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("キャンセル") { showingAddEvent = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("保存") {
                            addEvent()
                        }
                    }
                }
            }
            .presentationDetents([.medium])
        }
        .sheet(item: $editingEvent) { event in
            EditEventView(event: event)
                .presentationDetents([.medium])
        }
        .sheet(isPresented: $showingEditTracker) {
            EditTrackerView(tracker: tracker)
        }
        .alert("履歴を削除しますか？", isPresented: $showingDeleteAlert) {
            Button("削除", role: .destructive) {
                if let event = eventToDelete {
                    modelContext.delete(event)
                    do {
                        try modelContext.save()
                    } catch {
                        modelContext.rollback()
                        showingSaveError = true
                        eventToDelete = nil
                        return
                    }
                    Task { @MainActor in
                        let didSync = await NotificationManager.sync(tracker)
                        if !didSync {
                            tracker.isNotificationEnabled = false
                            do {
                                try modelContext.save()
                            } catch {
                                modelContext.rollback()
                                showingSaveError = true
                            }
                        }
                    }
                }
                eventToDelete = nil
            }
            Button("キャンセル", role: .cancel) {
                eventToDelete = nil
            }
        } message: {
            Text("この操作は取り消せません。")
        }
        .alert("保存できません", isPresented: $showingSaveError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("変更を保存できませんでした。もう一度お試しください。")
        }
    }
    
    private func addEvent() {
        let note = newNote.trimmingCharacters(in: .whitespacesAndNewlines)
        let newEvent = TrackerEvent(
            date: newDate.startOfDay,
            tracker: tracker,
            note: note.isEmpty ? nil : note,
            amountYen: newAmount
        )
        modelContext.insert(newEvent)
        do {
            try modelContext.save()
        } catch {
            modelContext.rollback()
            showingSaveError = true
            return
        }

        Task { @MainActor in
            let didSync = await NotificationManager.sync(tracker)
            if !didSync {
                tracker.isNotificationEnabled = false
                do {
                    try modelContext.save()
                } catch {
                    modelContext.rollback()
                    showingSaveError = true
                }
            }
        }
        showingAddEvent = false
    }
}

struct EditEventView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Bindable var event: TrackerEvent
    
    @State private var tempDate: Date
    @State private var tempAmount: Int
    @State private var tempNote: String
    @State private var showingSaveError = false
    
    init(event: TrackerEvent) {
        self.event = event
        _tempDate = State(initialValue: event.date)
        _tempAmount = State(initialValue: event.amountYen)
        _tempNote = State(initialValue: event.note ?? "")
    }
    
    var body: some View {
        NavigationStack {
            Form {
                DatePicker("実施日", selection: $tempDate, displayedComponents: .date)
                    .datePickerStyle(.wheel)
                    .environment(\.locale, Locale(identifier: "ja_JP"))
                    .labelsHidden()
                HStack {
                    Text("金額")
                    TextField("0", value: $tempAmount, format: .number)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                    Text("円")
                }
                TextField("メモ", text: $tempNote)
            }
            .navigationTitle("履歴の編集")
            .navigationBarTitleDisplayMode(.inline)
            .alert("保存できません", isPresented: $showingSaveError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("変更を保存できませんでした。もう一度お試しください。")
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        Task { @MainActor in
                            await saveChanges()
                        }
                    }
                }
            }
        }
    }

    @MainActor
    private func saveChanges() async {
        let note = tempNote.trimmingCharacters(in: .whitespacesAndNewlines)
        event.date = tempDate.startOfDay
        event.amountYen = tempAmount
        event.note = note.isEmpty ? nil : note

        do {
            try modelContext.save()
        } catch {
            modelContext.rollback()
            showingSaveError = true
            return
        }

        if let tracker = event.tracker {
            let didSync = await NotificationManager.sync(tracker)
            if !didSync {
                tracker.isNotificationEnabled = false
                do {
                    try modelContext.save()
                } catch {
                    modelContext.rollback()
                    showingSaveError = true
                    return
                }
            }
        }

        dismiss()
    }
}
