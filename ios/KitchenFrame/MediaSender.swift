import AVFoundation
import ImageIO
import MapKit
import UIKit

/// Sends a photo, a video or a YouTube link to the frame (the share extension and the app both use it).
/// Photos go a little over the frame's screen size (for zooming); videos are converted on the phone to what the frame plays well
/// over its slow Wi-Fi: H.264 at 960x540, about 0.9 Mbit/s, the first 3 minutes (the Worker keeps 24 MB).
enum MediaSender {
    static let maxVideoSeconds = 180.0

    struct Sent: Decodable, Sendable { var sent: Int?; var error: String?; var title: String? }

    static func send(photo image: UIImage, title: String = "", api: API) async throws {
        guard let jpeg = image.frameJPEG() else { throw API.Failure(message: "Couldn’t read that photo.") }
        try await upload(jpeg, type: "image/jpeg", name: "photo.jpg", title: title, api: api)
    }

    /// progress: 0…1 while converting.
    static func send(video url: URL, title: String = "", api: API, progress: @escaping @Sendable (Double) -> Void = { _ in }) async throws {
        let out = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".mp4")
        defer { try? FileManager.default.removeItem(at: out) }
        try await VideoShrinker.shrink(url, to: out, maxSeconds: maxVideoSeconds, progress: progress)
        let data = try Data(contentsOf: out)
        guard data.count <= 24 * 1024 * 1024 else { throw API.Failure(message: "That video is still too big for the frame after shrinking.") }
        try await upload(data, type: "video/mp4", name: "video.mp4", title: title, api: api)
    }

    /// A YouTube link: the frame plays it (the same as the Shortcut).
    static func send(youtube link: String, api: API) async throws -> String {
        let data = try await api.post("api/share/play", json: ["url": link], timeout: 30)
        let r = try? JSONDecoder().decode(Sent.self, from: data)
        if let error = r?.error { throw API.Failure(message: error) }
        return r?.title ?? "the video"
    }

    static func isYouTube(_ s: String) -> Bool {
        s.range(of: #"(youtube\.com|youtu\.be)/"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    private static func upload(_ data: Data, type: String, name: String, title: String, api: API) async throws {
        var form = MultipartForm()
        form.add(name: "file", filename: name, value: data, type: type)
        if !title.isEmpty { form.add(name: "title", value: Data(title.utf8), type: "text/plain") }
        let answer = try await api.post("api/share/media", body: form.finish(), contentType: form.contentType, timeout: 300)
        let r = try? JSONDecoder().decode(Sent.self, from: answer)
        if r?.sent == 0 { throw API.Failure(message: r?.error ?? "The frame isn’t connected right now.") }
    }
}

/// When and where a photo or video was taken, from the file's own details, as the frame shows it:
/// "October 18, 2026 at 3:14 PM · Raleigh, NC" (the slideshow shows the date and place the same way).
/// The place is looked up with Apple Maps; with location left off in the share sheet, only the time shows.
enum TakenCaption {
    static func ofPhoto(_ url: URL) async -> String {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else { return "" }
        let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any] ?? [:]
        var date: Date?
        if let taken = exif[kCGImagePropertyExifDateTimeOriginal] as? String {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "yyyy:MM:dd HH:mm:ss"
            if let offset = exif[kCGImagePropertyExifOffsetTimeOriginal] as? String { f.dateFormat += "xxx"; date = f.date(from: taken + offset) }
            if date == nil { f.dateFormat = "yyyy:MM:dd HH:mm:ss"; date = f.date(from: taken) }
        }
        var location: CLLocation?
        if let gps = props[kCGImagePropertyGPSDictionary] as? [CFString: Any],
           var lat = gps[kCGImagePropertyGPSLatitude] as? Double, var lon = gps[kCGImagePropertyGPSLongitude] as? Double {
            if (gps[kCGImagePropertyGPSLatitudeRef] as? String) == "S" { lat = -lat }
            if (gps[kCGImagePropertyGPSLongitudeRef] as? String) == "W" { lon = -lon }
            location = CLLocation(latitude: lat, longitude: lon)
        }
        return await caption(date: date, location: location)
    }

    static func ofVideo(_ url: URL) async -> String {
        let asset = AVURLAsset(url: url)
        let date = try? await asset.load(.creationDate)?.load(.dateValue)
        var location: CLLocation?
        // "+35.7796-078.6382+100.000/" (ISO 6709): latitude, then longitude.
        if let items = try? await asset.load(.metadata),
           let item = AVMetadataItem.metadataItems(from: items, filteredByIdentifier: .quickTimeMetadataLocationISO6709).first,
           let text = try? await item.load(.stringValue),
           let m = text.firstMatch(of: /([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/), let lat = Double(m.1), let lon = Double(m.2) {
            location = CLLocation(latitude: lat, longitude: lon)
        }
        return await caption(date: date ?? nil, location: location)
    }

    static func caption(date: Date?, location: CLLocation?) async -> String {
        var parts: [String] = []
        if let date { parts.append(date.formatted(.dateTime.month(.wide).day().year().hour().minute())) }
        if let location, let place = await place(location) { parts.append(place) }
        return parts.joined(separator: " · ")
    }

    private static func place(_ location: CLLocation) async -> String? {
        guard let request = MKReverseGeocodingRequest(location: location), let item = try? await request.mapItems.first else { return nil }
        return item.addressRepresentations?.cityWithContext ?? item.addressRepresentations?.cityName
    }
}

extension UIImage {
    /// A photo file read at most `maxPixels` on its longer side, upright, without decoding it at full size.
    static func downsampled(_ url: URL, maxPixels: Int) -> UIImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        let options = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
                       kCGImageSourceShouldCacheImmediately: true, kCGImageSourceThumbnailMaxPixelSize: maxPixels] as CFDictionary
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options).map(UIImage.init(cgImage:))
    }

    /// Upright, at most 2560 px on the longer side, as a JPEG: a little over the frame's 1920 px screen, so
    /// pinch-to-zoom there has some detail to show (about 5 MP, still far from a full phone photo).
    func frameJPEG() -> Data? {
        let px = CGSize(width: size.width * scale, height: size.height * scale)
        let k = min(1, 2560 / max(px.width, px.height))
        let target = CGSize(width: (px.width * k).rounded(), height: (px.height * k).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }.jpegData(compressionQuality: 0.85)
    }
}

struct MultipartForm {
    private let boundary = "kitchenframe-" + UUID().uuidString
    private var body = Data()
    var contentType: String { "multipart/form-data; boundary=" + boundary }

    mutating func add(name: String, filename: String? = nil, value: Data, type: String) {
        var head = "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\""
        if let filename { head += "; filename=\"\(filename)\"" }
        head += "\r\nContent-Type: \(type)\r\n\r\n"
        body.append(Data(head.utf8))
        body.append(value)
        body.append(Data("\r\n".utf8))
    }

    func finish() -> Data { body + Data("--\(boundary)--\r\n".utf8) }
}

/// Re-encodes a video for the frame with AVAssetReader/AVAssetWriter, which (unlike Apple's export
/// presets) let the bitrate be set: the presets make 960x540 at several Mbit/s, more than the frame's
/// Wi-Fi carries.
enum VideoShrinker {
    static let bitrate = 900_000
    static let box = CGSize(width: 960, height: 540)

    static func shrink(_ url: URL, to out: URL, maxSeconds: Double, progress: @escaping @Sendable (Double) -> Void) async throws {
        let asset = AVURLAsset(url: url)
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw API.Failure(message: "No video in that file.") }
        let audioTrack = try await asset.loadTracks(withMediaType: .audio).first
        let (natural, transform) = try await track.load(.naturalSize, .preferredTransform)
        let duration = try await asset.load(.duration)
        let seconds = min(duration.seconds, maxSeconds)
        let range = CMTimeRange(start: .zero, duration: CMTime(seconds: seconds, preferredTimescale: 600))

        // Fit the stored picture (before rotation) in 960x540 the same way round; even sizes for H.264.
        let landscape = natural.width >= natural.height
        let fit = landscape ? box : CGSize(width: box.height, height: box.width)
        let k = min(1, fit.width / natural.width, fit.height / natural.height)
        let even = { (v: CGFloat) in Int((v * k / 2).rounded()) * 2 }
        let size = CGSize(width: even(natural.width), height: even(natural.height))

        let reader = try AVAssetReader(asset: asset)
        reader.timeRange = range
        let videoOut = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
        reader.add(videoOut)
        var audioOut: AVAssetReaderTrackOutput?
        if let audioTrack {
            let o = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM])
            if reader.canAdd(o) { reader.add(o); audioOut = o }
        }

        let writer = try AVAssetWriter(outputURL: out, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true // the index first, so the frame can start before the end arrives
        let videoIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: size.width, AVVideoHeightKey: size.height,
            AVVideoScalingModeKey: AVVideoScalingModeResizeAspectFill,
            AVVideoColorPropertiesKey: [AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
                                        AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
                                        AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2],
            AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: bitrate, AVVideoMaxKeyFrameIntervalKey: 60,
                                              AVVideoProfileLevelKey: AVVideoProfileLevelH264MainAutoLevel],
        ])
        videoIn.transform = transform
        videoIn.expectsMediaDataInRealTime = false
        writer.add(videoIn)
        var audioIn: AVAssetWriterInput?
        if audioOut != nil {
            let a = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVNumberOfChannelsKey: 2,
                                                                         AVSampleRateKey: 44_100, AVEncoderBitRateKey: 64_000])
            a.expectsMediaDataInRealTime = false
            if writer.canAdd(a) { writer.add(a); audioIn = a }
        }

        guard reader.startReading() else { throw reader.error ?? API.Failure(message: "Couldn’t read that video.") }
        writer.startWriting()
        writer.startSession(atSourceTime: .zero)

        let job = Copy(reader: reader, writer: writer, video: (videoOut, videoIn), audio: audioOut.flatMap { o in audioIn.map { (o, $0) } }, total: seconds, progress: progress)
        try await Task.detached(priority: .userInitiated) { try job.run() }.value
        await writer.finishWriting()
        if writer.status != .completed { throw writer.error ?? API.Failure(message: "Couldn’t convert that video.") }
    }

    /// The copy loop, off the main thread: sample by sample, waiting when the encoder is busy.
    private final class Copy: @unchecked Sendable {
        let reader: AVAssetReader, writer: AVAssetWriter
        let video: (AVAssetReaderTrackOutput, AVAssetWriterInput)
        let audio: (AVAssetReaderTrackOutput, AVAssetWriterInput)?
        let total: Double, progress: @Sendable (Double) -> Void

        init(reader: AVAssetReader, writer: AVAssetWriter, video: (AVAssetReaderTrackOutput, AVAssetWriterInput),
             audio: (AVAssetReaderTrackOutput, AVAssetWriterInput)?, total: Double, progress: @escaping @Sendable (Double) -> Void) {
            self.reader = reader; self.writer = writer; self.video = video; self.audio = audio; self.total = total; self.progress = progress
        }

        func run() throws {
            var videoDone = false, audioDone = audio == nil
            while !(videoDone && audioDone) {
                if writer.status == .failed { throw writer.error ?? API.Failure(message: "Couldn’t convert that video.") }
                var moved = false
                if !videoDone, video.1.isReadyForMoreMediaData {
                    if let s = video.0.copyNextSampleBuffer() {
                        video.1.append(s); moved = true
                        if total > 0 { progress(min(1, s.presentationTimeStamp.seconds / total)) }
                    } else { video.1.markAsFinished(); videoDone = true }
                }
                if !audioDone, let audio, audio.1.isReadyForMoreMediaData {
                    if let s = audio.0.copyNextSampleBuffer() { audio.1.append(s); moved = true } else { audio.1.markAsFinished(); audioDone = true }
                }
                if !moved { usleep(2_000) }
            }
            if reader.status == .failed { throw reader.error ?? API.Failure(message: "Couldn’t read that video.") }
        }
    }
}
