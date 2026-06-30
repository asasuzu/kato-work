import SwiftUI
import SwiftData

struct AddCategoryView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    
    @State private var title: String = ""
    @State private var selectedColor: CategoryColor = .red
    @State private var showingSaveError = false

    private var trimmedTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
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
            .navigationTitle("新しいカテゴリ")
            .navigationBarTitleDisplayMode(.inline)
            .alert("保存できません", isPresented: $showingSaveError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("変更を保存できませんでした。もう一度お試しください。")
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        saveCategory()
                    }
                    .disabled(trimmedTitle.isEmpty)
                }
            }
        }
    }
    
    private func saveCategory() {
        let newCategory = TrackerCategory(title: trimmedTitle, color: selectedColor)
        modelContext.insert(newCategory)
        do {
            try modelContext.save()
            dismiss()
        } catch {
            modelContext.rollback()
            showingSaveError = true
        }
    }
}

#Preview {
    AddCategoryView()
}
