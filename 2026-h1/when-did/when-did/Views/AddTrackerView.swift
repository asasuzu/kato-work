import SwiftUI
import SwiftData

struct AddTrackerView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    
    var category: TrackerCategory
    
    @State private var title: String = ""
    @State private var hasDue: Bool = false
    @State private var intervalValue: Int = 30
    @State private var intervalUnitRaw: Int = 0
    @State private var isNotificationEnabled: Bool = false
    @State private var isCheckingNotificationAuthorization = false
    @State private var isSaving = false
    @State private var showingNotificationDeniedAlert = false
    @State private var notificationAlertMessage = "設定アプリで When Did の通知を許可してください。"
    @State private var showingSaveError = false

    private var trimmedTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSave: Bool {
        !trimmedTitle.isEmpty &&
            (!hasDue || TrackerInterval.allowedRange.contains(intervalValue)) &&
            !isCheckingNotificationAuthorization &&
            !isSaving
    }
    
    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("項目情報")) {
                    TextField("項目名", text: $title)
                }
                
                Section {
                    Toggle("目安を設定する", isOn: $hasDue)
                    
                    if hasDue {
                        HStack {
                            TextField("数値", value: $intervalValue, format: .number)
                                .keyboardType(.numberPad)
                                .onChange(of: intervalValue) { _, newValue in
                                    let clampedValue = TrackerInterval.clamped(newValue)
                                    if clampedValue != newValue {
                                        intervalValue = clampedValue
                                    }
                                }
                            
                            Picker("", selection: $intervalUnitRaw) {
                                Text("日ごと").tag(0)
                                Text("ヶ月ごと").tag(1)
                                Text("年ごと").tag(2)
                            }
                            .pickerStyle(.menu)
                        }
                        
                        Toggle("通知を有効にする", isOn: $isNotificationEnabled)
                            .onChange(of: isNotificationEnabled) { _, enabled in
                                guard enabled else {
                                    isCheckingNotificationAuthorization = false
                                    return
                                }
                                isCheckingNotificationAuthorization = true
                                Task { @MainActor in
                                    let allowed = await NotificationManager.requestAuthorization()
                                    isCheckingNotificationAuthorization = false

                                    guard isNotificationEnabled else { return }

                                    if !allowed {
                                        isNotificationEnabled = false
                                        notificationAlertMessage = "設定アプリで When Did の通知を許可してください。"
                                        showingNotificationDeniedAlert = true
                                    }
                                }
                            }
                    }
                } footer: {
                    if hasDue {
                        Text("例: 「6ヶ月ごと」に設定すると、前回の実施日から6ヶ月後を次の目安日として表示します。通知を有効にすると、目安日の朝9時にお知らせします。当日の9時を過ぎて設定した場合、その日の通知は予約されません。")
                    }
                }
            }
            .navigationTitle("項目の追加")
            .alert("通知を有効にできません", isPresented: $showingNotificationDeniedAlert) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(notificationAlertMessage)
            }
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
                        Task {
                            await addTracker()
                        }
                    }
                    .disabled(!canSave)
                }
            }
        }
    }
    
    @MainActor
    private func addTracker() async {
        guard canSave else { return }

        isSaving = true
        defer { isSaving = false }

        if isNotificationEnabled {
            let allowed = await NotificationManager.requestAuthorization()
            guard allowed else {
                isNotificationEnabled = false
                notificationAlertMessage = "設定アプリで When Did の通知を許可してください。"
                showingNotificationDeniedAlert = true
                return
            }
        }

        let newTracker = Tracker(
            title: trimmedTitle,
            category: category,
            hasDue: hasDue,
            intervalValue: TrackerInterval.clamped(intervalValue),
            intervalUnitRaw: intervalUnitRaw,
            isNotificationEnabled: isNotificationEnabled
        )

        modelContext.insert(newTracker)
        do {
            try modelContext.save()
        } catch {
            modelContext.rollback()
            showingSaveError = true
            return
        }

        let didSync = await NotificationManager.sync(newTracker)
        if !didSync {
            newTracker.isNotificationEnabled = false
            isNotificationEnabled = false
            do {
                try modelContext.save()
            } catch {
                modelContext.rollback()
                showingSaveError = true
                return
            }
            notificationAlertMessage = "通知を予約できませんでした。通知設定を確認して、もう一度保存してください。"
            showingNotificationDeniedAlert = true
            return
        }

        dismiss()
    }
}
