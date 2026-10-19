import SwiftUI
import UIKit
import UniformTypeIdentifiers
import AVFoundation

/// "Kitchen Frame" in the share sheet: a photo or video from Photos (or anywhere) shows full screen on the
/// frame; a YouTube link plays there. Sends at once, shows how it's going, and closes itself when done.
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let model = ShareModel(context: extensionContext)
        let host = UIHostingController(rootView: ShareView(model: model))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        Task { await model.run() }
    }
}

@MainActor @Observable
final class ShareModel {
    enum Stage: Equatable { case starting, preparing(Double), sending, done(String), failed(String) }
    var stage = Stage.starting
    var preview: UIImage?
    private let context: NSExtensionContext?

    init(context: NSExtensionContext?) { self.context = context }

    func close() { context?.completeRequest(returningItems: nil) }

    func run() async {
        guard let pairing = PairingStore.load() else {
            stage = .failed("Pair this iPhone with the frame first: open the Kitchen Frame app and follow its steps.")
            return
        }
        let api = API(pairing: pairing)
        let providers = (context?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        do {
            // A photo first: a Live Photo carries a movie too, and should go as the photo.
            if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }) {
                let url = try await copy(p, type: .image)
                defer { try? FileManager.default.removeItem(at: url) }
                // Read at the frame's size straight from the file: decoding a full 48 MP photo would take
                // more memory than a share extension is allowed, and iOS would end it without a word.
                guard let image = UIImage.downsampled(url, maxPixels: 2560) else { throw API.Failure(message: "Couldn’t read that photo.") }
                preview = image
                stage = .sending
                try await MediaSender.send(photo: image, title: await TakenCaption.ofPhoto(url), api: api)
                stage = .done("The photo is on the frame.")
            } else if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.movie.identifier) }) {
                let url = try await copy(p, type: .movie)
                defer { try? FileManager.default.removeItem(at: url) }
                preview = await Thumbnail.of(video: url)
                stage = .preparing(0)
                let caption = await TakenCaption.ofVideo(url)
                try await MediaSender.send(video: url, title: caption, api: api) { p in Task { @MainActor in if case .preparing = self.stage { self.stage = .preparing(p) } } }
                stage = .done("The video is playing on the frame.")
            } else if let link = await youtubeLink(providers) {
                stage = .sending
                let title = try await MediaSender.send(youtube: link, api: api)
                stage = .done("Playing \(title) on the frame.")
            } else {
                stage = .failed("Share a photo, a video or a YouTube link.")
                return
            }
            try? await Task.sleep(for: .seconds(1.2))
            close()
        } catch {
            stage = .failed(error.localizedDescription)
        }
    }

    /// The shared file, copied somewhere this extension can keep it while converting.
    private func copy(_ p: NSItemProvider, type: UTType) async throws -> URL {
        try await withCheckedThrowingContinuation { cont in
            _ = p.loadFileRepresentation(for: type, openInPlace: false) { url, _, error in
                guard let url else { return cont.resume(throwing: error ?? API.Failure(message: "Couldn’t open that file.")) }
                let ext = url.pathExtension.isEmpty ? (type == .movie ? "mov" : "jpg") : url.pathExtension
                let dest = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + "." + ext)
                do { try FileManager.default.copyItem(at: url, to: dest); cont.resume(returning: dest) } catch { cont.resume(throwing: error) }
            }
        }
    }


    private func youtubeLink(_ providers: [NSItemProvider]) async -> String? {
        for p in providers {
            for type in [UTType.url, .plainText] where p.hasItemConformingToTypeIdentifier(type.identifier) {
                let item = try? await p.loadItem(forTypeIdentifier: type.identifier)
                let text = (item as? URL)?.absoluteString ?? (item as? String) ?? ""
                if MediaSender.isYouTube(text) { return text }
            }
        }
        return nil
    }
}

enum Thumbnail {
    static func of(video url: URL) async -> UIImage? {
        let g = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        g.appliesPreferredTrackTransform = true
        g.maximumSize = CGSize(width: 600, height: 600)
        return (try? await g.image(at: .zero).image).map(UIImage.init(cgImage:))
    }
}

struct ShareView: View {
    let model: ShareModel

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if let image = model.preview {
                    Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 260).clipShape(.rect(cornerRadius: 12))
                }
                switch model.stage {
                case .starting, .sending:
                    ProgressView("Sending to the frame…")
                case .preparing(let p):
                    ProgressView("Getting the video ready for the frame…", value: p).padding(.horizontal)
                    Text("Videos play from the start, up to 3 minutes.").font(.footnote).foregroundStyle(.secondary)
                case .done(let text):
                    Label(text, systemImage: "checkmark.circle.fill").foregroundStyle(.green).font(.headline)
                case .failed(let text):
                    Label(text, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange).multilineTextAlignment(.center)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle("Kitchen Frame")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(isDone ? "Done" : "Cancel") { model.close() } }
            }
        }
    }

    private var isDone: Bool { if case .done = model.stage { true } else if case .failed = model.stage { true } else { false } }
}
