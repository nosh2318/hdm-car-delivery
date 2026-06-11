import Foundation
import AVFoundation

let args = CommandLine.arguments
guard args.count >= 4 else { fatalError("usage: add_audio.swift VIDEO AUDIO OUTPUT") }
let videoURL = URL(fileURLWithPath: args[1]), audioURL = URL(fileURLWithPath: args[2]), outputURL = URL(fileURLWithPath: args[3])
try? FileManager.default.removeItem(at: outputURL)

let composition = AVMutableComposition()
let videoAsset = AVURLAsset(url: videoURL), audioAsset = AVURLAsset(url: audioURL)
guard let sourceVideo = try await videoAsset.loadTracks(withMediaType: .video).first,
      let targetVideo = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { fatalError("video track missing") }
let videoDuration = try await videoAsset.load(.duration)
try targetVideo.insertTimeRange(CMTimeRange(start: .zero, duration: videoDuration), of: sourceVideo, at: .zero)
targetVideo.preferredTransform = try await sourceVideo.load(.preferredTransform)

if let sourceAudio = try await audioAsset.loadTracks(withMediaType: .audio).first,
   let targetAudio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
  let audioDuration = try await audioAsset.load(.duration)
  try targetAudio.insertTimeRange(CMTimeRange(start: .zero, duration: min(audioDuration, videoDuration)), of: sourceAudio, at: .zero)
}

guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else { fatalError("exporter unavailable") }
exporter.outputURL = outputURL; exporter.outputFileType = .mp4; exporter.shouldOptimizeForNetworkUse = true
await exporter.export()
if exporter.status != .completed { fatalError(exporter.error?.localizedDescription ?? "export failed") }
print(outputURL.path)
