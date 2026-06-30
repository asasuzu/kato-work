import SwiftUI
import SwiftData

struct EditCategoryView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @Bindable var category: TrackerCategory

    @State private var title: String
    @State private var selectedColor: CategoryColor
    @State private var showingSaveError = false

    private var trimmedTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    init(category: TrackerCategory) {
        self.category = category
        _title = State(initialValue: category.title)
        _selectedColor = State(initialValue: category.uiColor)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("カテゴリ情報")) {
                    TextField("カテゴリ名", text: $title)

                    Picker("色", selection: $selectedColor) {
                        ForEach(CategoryColor.allCases, id: \.self) { color in
                            HStack {
                                Circle()
                                    .fill(color.color)
                                    .frame(width: 16, height: 16)
                                Text(color.label)
                            }
                            .tag(color)
                        }
                    }
                    .pickerStyle(.navigationLink)
                }
            }
            .navigationTitle("カテゴリの編集")
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
                        saveChanges()
                    }
                    .disabled(trimmedTitle.isEmpty)
                }
            }
        }
    }

    private func saveChanges() {
        category.title = trimmedTitle
        category.colorRaw = selectedColor.rawValue
        do {
            try modelContext.save()
            dismiss()
        } catch {
            modelContext.rollback()
            showingSaveError = true
        }
    }
}
