// Records one window with ScreenCaptureKit, without taking the screen, and
// prints JSON: each delivered frame's time (ms) and how many rows of pixels
// changed from the frame before. See "Limits" in docs/DEVELOPMENT.md.
// usage: swift scripts/record-window-frames.swift <windowId or 0> <pid> <ms>
// Window 0 is that process's widest window.
import AppKit
import CoreMedia
import Foundation
import ScreenCaptureKit

_ = NSApplication.shared
let arguments = CommandLine.arguments
guard arguments.count == 4, let windowId = UInt32(arguments[1]), let pid = Int32(arguments[2]),
  let duration = UInt64(arguments[3])
else {
  print("usage: record-window-frames <windowId or 0> <pid> <ms>")
  exit(2)
}

final class Frames: NSObject, SCStreamOutput {
  var frames: [(at: Double, rows: Int)] = []
  private var previous = Data()
  func stream(_ s: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen,
      let info = (CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false)
        as? [[SCStreamFrameInfo: Any]])?.first,
      let status = info[.status] as? Int, SCFrameStatus(rawValue: status) == .complete,
      let pixels = CMSampleBufferGetImageBuffer(buffer)
    else { return }
    CVPixelBufferLockBaseAddress(pixels, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }
    let rowBytes = CVPixelBufferGetBytesPerRow(pixels)
    let rows = CVPixelBufferGetHeight(pixels)
    let base = CVPixelBufferGetBaseAddress(pixels)!
    let first = previous.count != rowBytes * rows
    if first { previous = Data(count: rowBytes * rows) }
    var changed = 0
    previous.withUnsafeMutableBytes { (old: UnsafeMutableRawBufferPointer) in
      for row in 0..<rows {
        let new = base.advanced(by: row * rowBytes)
        let was = old.baseAddress!.advanced(by: row * rowBytes)
        if memcmp(new, was, rowBytes) != 0 {
          changed += 1
          memcpy(was, new, rowBytes)
        }
      }
    }
    let at = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(buffer)) * 1000
    frames.append((at, first ? 0 : changed))
  }
}

Task {
  do {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    let picked =
      windowId != 0
      ? content.windows.first { $0.windowID == windowId }
      : content.windows.filter { $0.owningApplication?.processID == pid }
        .max { $0.frame.width < $1.frame.width }
    guard let window = picked else {
      print("No such window")
      exit(3)
    }
    let configuration = SCStreamConfiguration()
    configuration.width = Int(window.frame.width)
    configuration.height = Int(window.frame.height)
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: 120)
    configuration.queueDepth = 8
    configuration.showsCursor = false
    let stream = SCStream(
      filter: SCContentFilter(desktopIndependentWindow: window), configuration: configuration, delegate: nil)
    let output = Frames()
    try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: DispatchQueue(label: "frames"))
    try await stream.startCapture()
    try await Task.sleep(nanoseconds: duration * 1_000_000)
    try await stream.stopCapture()
    let rows = output.frames.map { ["at": $0.at, "rows": Double($0.rows)] }
    print(String(data: try JSONSerialization.data(withJSONObject: rows), encoding: .utf8)!)
    exit(0)
  } catch {
    print("Could not record: \(error)")
    exit(4)
  }
}
RunLoop.main.run()
