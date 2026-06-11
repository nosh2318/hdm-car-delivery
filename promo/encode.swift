import Foundation
import AVFoundation
import AppKit

let args = CommandLine.arguments
guard args.count >= 3 else { fatalError("usage: encode.swift FRAMES_DIR OUTPUT.mp4") }
let framesDir = args[1]
let output = URL(fileURLWithPath: args[2])
try? FileManager.default.removeItem(at: output)

let width = 1280, height = 720, fps: Int32 = 24
let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
let settings: [String: Any] = [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: width,
  AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: 8_000_000,
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
  ]
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let attrs: [String: Any] = [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
  kCVPixelBufferWidthKey as String: width,
  kCVPixelBufferHeightKey as String: height
]
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attrs)
guard writer.canAdd(input) else { fatalError("cannot add video input") }
writer.add(input)
writer.startWriting(); writer.startSession(atSourceTime: .zero)

let files = try FileManager.default.contentsOfDirectory(atPath: framesDir)
  .filter { $0.hasSuffix(".jpg") }.sorted()

func pixelBuffer(from image: NSImage) -> CVPixelBuffer? {
  var buffer: CVPixelBuffer?
  CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32ARGB,
                      [kCVPixelBufferCGImageCompatibilityKey: true,
                       kCVPixelBufferCGBitmapContextCompatibilityKey: true] as CFDictionary, &buffer)
  guard let pb = buffer else { return nil }
  CVPixelBufferLockBaseAddress(pb, [])
  defer { CVPixelBufferUnlockBaseAddress(pb, []) }
  guard let ctx = CGContext(data: CVPixelBufferGetBaseAddress(pb), width: width, height: height,
                            bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pb),
                            space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue),
        let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
  ctx.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
  return pb
}

for (i, name) in files.enumerated() {
  while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }
  let url = URL(fileURLWithPath: framesDir).appendingPathComponent(name)
  guard let image = NSImage(contentsOf: url), let pb = pixelBuffer(from: image) else { fatalError("bad frame \(name)") }
  adaptor.append(pb, withPresentationTime: CMTime(value: Int64(i), timescale: fps))
  if i % Int(fps * 2) == 0 { print("encoded \(i)/\(files.count)") }
}
input.markAsFinished()
await writer.finishWriting()
if writer.status != .completed { fatalError(writer.error?.localizedDescription ?? "encode failed") }
print(output.path)
