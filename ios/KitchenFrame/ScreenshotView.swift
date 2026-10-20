import SwiftUI

/// The Remote tab's Screenshot: what the frame's screen shows right now, full screen. Opening it asks
/// the frame (API.screenshot); pinch or double-tap to zoom, Share to save or send it, Again for a new one.
struct ScreenshotView: View {
    let api: API
    @Environment(\.dismiss) private var dismiss

    @State private var shot: (image: UIImage, takenAt: Date)?
    @State private var problem: String?
    @State private var loading = false
    @State private var zoom: CGFloat = 1
    @State private var pinch: CGFloat = 1

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                if let shot {
                    ScrollView([.horizontal, .vertical], showsIndicators: false) {
                        Image(uiImage: shot.image)
                            .resizable()
                            .scaledToFit()
                            .containerRelativeFrame([.horizontal, .vertical]) { length, _ in length * zoom * pinch }
                            .gesture(MagnifyGesture()
                                .onChanged { pinch = $0.magnification }
                                .onEnded { _ in zoom = min(4, max(1, zoom * pinch)); pinch = 1 })
                            .onTapGesture(count: 2) { withAnimation { zoom = zoom > 1 ? 1 : 2.5 } }
                    }
                    .defaultScrollAnchor(.center)
                }
                if loading {
                    VStack(spacing: 12) {
                        ProgressView().tint(.white)
                        Text("Asking the frame…").foregroundStyle(.white.opacity(0.8))
                    }
                    .padding(20)
                    .background(.black.opacity(0.6), in: .rect(cornerRadius: 16))
                } else if let problem, shot == nil {
                    ContentUnavailableView("No screenshot", systemImage: "exclamationmark.triangle", description: Text(problem))
                        .foregroundStyle(.white)
                }
            }
            .toolbarBackground(.visible, for: .navigationBar, .bottomBar)
            .toolbarColorScheme(.dark, for: .navigationBar, .bottomBar)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Again", systemImage: "arrow.clockwise") { Task { await take() } }.disabled(loading)
                }
                if let shot {
                    ToolbarItem(placement: .bottomBar) {
                        ShareLink(item: Image(uiImage: shot.image), preview: SharePreview("Kitchen Frame", image: Image(uiImage: shot.image)))
                    }
                }
            }
            .task { await take() }
        }
    }

    private var title: String {
        guard let shot else { return "Screenshot" }
        return "Frame at " + shot.takenAt.formatted(date: .omitted, time: .shortened)
    }

    private func take() async {
        loading = true
        problem = nil
        do {
            let got = try await api.screenshot()
            guard let image = UIImage(data: got.image) else { throw API.Failure(message: "The picture couldn’t be read.") }
            shot = (image, got.takenAt)
            zoom = 1
        } catch {
            problem = error.localizedDescription
        }
        loading = false
    }
}
