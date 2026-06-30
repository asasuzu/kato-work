import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    
    @Query(sort: \TrackerCategory.createdAt, order: .forward)
    private var categories: [TrackerCategory]
    
    @State private var showingAddScreen = false
    @State private var showingDeleteAlert = false
    @State private var categoryToDelete: TrackerCategory?
    @State private var categoryToEdit: TrackerCategory?
    @State private var showingSaveError = false

    var body: some View {
        NavigationStack {
            List {
                if categories.isEmpty {
                    ContentUnavailableView(
                        "カテゴリがありません",
                        systemImage: "folder.badge.plus",
                        description: Text("右上の追加ボタンからカテゴリを作成できます。")
                    )
                }

                ForEach(categories) { category in
                    NavigationLink {
                        TrackerListView(category: category)
                    } label: {
                        HStack {
                            Circle()
                                .fill(category.uiColor.color)
                                .frame(width: 12, height: 12)
                            
                            Text(category.title)
                                .font(.headline)
                            
                            Spacer()
                            
                            Text(category.totalAmountYen.yenText)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            categoryToDelete = category
                            showingDeleteAlert = true
                        } label: {
                            Label("削除", systemImage: "trash")
                        }

                        Button {
                            categoryToEdit = category
                        } label: {
                            Label("編集", systemImage: "slider.horizontal.3")
                        }
                        .tint(.gray)
                    }
                }
            }
            .navigationTitle("カテゴリ一覧")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: { showingAddScreen = true }) {
                        Label("カテゴリを追加", systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingAddScreen) {
                AddCategoryView()
            }
            .sheet(item: $categoryToEdit) { category in
                EditCategoryView(category: category)
            }
            .alert("保存できません", isPresented: $showingSaveError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("変更を保存できませんでした。もう一度お試しください。")
            }
            .alert("カテゴリを削除しますか？", isPresented: $showingDeleteAlert) {
                Button("削除", role: .destructive) {
                    if let category = categoryToDelete {
                        let notificationIds = category.trackers.map(\.notificationId)
                        modelContext.delete(category)
                        do {
                            try modelContext.save()
                            NotificationManager.cancel(ids: notificationIds)
                        } catch {
                            modelContext.rollback()
                            showingSaveError = true
                        }
                    }
                    categoryToDelete = nil
                }
                Button("キャンセル", role: .cancel) {
                    categoryToDelete = nil
                }
            } message: {
                Text("含まれるすべての項目と履歴も削除されます。\nこの操作は取り消せません。")
            }
        }
    }
}
