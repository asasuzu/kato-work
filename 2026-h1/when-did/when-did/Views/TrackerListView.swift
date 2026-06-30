import SwiftUI
import SwiftData

struct TrackerListView: View {
    @Environment(\.modelContext) private var modelContext
    @Bindable var category: TrackerCategory

    @State private var showingAddScreen = false
    @State private var trackerToEdit: Tracker?
    @State private var trackerToDelete: Tracker?
    @State private var showingDeleteAlert = false
    @State private var showingSaveError = false

    private var sortedTrackers: [Tracker] {
        category.trackers.sorted { $0.createdAt < $1.createdAt }
    }

    var body: some View {
        List {
            if sortedTrackers.isEmpty {
                ContentUnavailableView(
                    "項目がありません",
                    systemImage: "checklist",
                    description: Text("右上の追加ボタンから項目を登録できます。")
                )
            }

            ForEach(sortedTrackers) { tracker in
                NavigationLink {
                    TrackerDetailView(tracker: tracker)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(tracker.title)
                                .font(.headline)
                            
                            if tracker.hasDue {
                                Text("目安: \(tracker.intervalDescription)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        
                        Spacer()
                        
                        if let lastDate = tracker.lastEventDate {
                            VStack(alignment: .trailing, spacing: 2) {
                                Text("\(tracker.daysSinceLastEvent ?? 0)日")
                                    .font(.system(.body, design: .rounded))
                                    .fontWeight(.bold)
                                    .foregroundStyle(category.uiColor.color)
                                
                                Text(lastDate.slashFormat)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        } else {
                            Text("履歴なし")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 2)
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) {
                        trackerToDelete = tracker
                        showingDeleteAlert = true
                    } label: {
                        Label("削除", systemImage: "trash")
                    }
                    
                    Button {
                        trackerToEdit = tracker
                    } label: {
                        Label("編集", systemImage: "slider.horizontal.3")
                    }
                    .tint(.gray)
                }
            }
        }
        .navigationTitle(category.title)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: { showingAddScreen = true }) {
                    Label("項目を追加", systemImage: "plus")
                }
            }
        }
        .sheet(isPresented: $showingAddScreen) {
            AddTrackerView(category: category)
        }
        .sheet(item: $trackerToEdit) { tracker in
            EditTrackerView(tracker: tracker)
        }
        .alert("保存できません", isPresented: $showingSaveError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("変更を保存できませんでした。もう一度お試しください。")
        }
        .alert("項目を削除しますか？", isPresented: $showingDeleteAlert) {
            Button("削除", role: .destructive) {
                if let tracker = trackerToDelete {
                    let notificationId = tracker.notificationId
                    modelContext.delete(tracker)
                    do {
                        try modelContext.save()
                        NotificationManager.cancel(ids: [notificationId])
                    } catch {
                        modelContext.rollback()
                        showingSaveError = true
                    }
                }
                trackerToDelete = nil
            }
            Button("キャンセル", role: .cancel) {
                trackerToDelete = nil
            }
        } message: {
            Text("含まれるすべての履歴も削除されます。\nこの操作は取り消せません。")
        }
    }
}
