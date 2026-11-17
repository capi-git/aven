// Records one window with ScreenCaptureKit, without taking the screen, and
// prints JSON: each delivered frame's time (ms) and how many rows of pixels
// changed from the frame before. See "Limits" in docs/DEVELOPMENT.md.
// usage: swift scripts/record-window-frames.swift <windowId or 0> <pid> <ms> [edges]
// Window 0 is that process's largest window on screen. With `edges`, each frame also
// reports the leftmost column of two marker colours: cyan, which the speed
// test draws in Aven's interface at a web page's left edge, and magenta,
// which the test page draws at its own left edge. Where the two disagree,
// the page and the interface are out of step in that frame.
import AppKit
import CoreImage
import CoreMedia
import ImageIO
import Foundation
import ScreenCaptureKit

_ = NSApplication.shared
let arguments = CommandLine.arguments
guard arguments.count == 4 || (arguments.count == 5 && arguments[4] == "edges"),
  let windowId = UInt32(arguments[1]), let pid = Int32(arguments[2]),
  let duration = UInt64(arguments[3])
else {
  print("usage: record-window-frames <windowId or 0> <pid> <ms>")
  exit(2)
}

let findEdges = arguments.count == 5

/// Where a marker colour shows in a frame: its leftmost column and how many
/// pixels of it there are, or nil when it does not show.
struct Marker {
  var left = Int.max
  var count = 0
}

/// With AVEN_RECORD_PICTURE set, the frame seen this far into the recording
/// is written there as a PNG, to check what the markers look like.
let pictureAt = Double(ProcessInfo.processInfo.environment["AVEN_RECORD_PICTURE_MS"] ?? "") ?? 5000
let picturePath = ProcessInfo.processInfo.environment["AVEN_RECORD_PICTURE"]
var pictureStart: Double?
var pictureTaken = false

final class Frames: NSObject, SCStreamOutput {
  var frames: [(at: Double, rows: Int, cyan: Marker, magenta: Marker)] = []
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
    var cyan = Marker()
    var magenta = Marker()
    if findEdges {
      // A marker is a vertical line: count a column only where its colour
      // runs down at least `minimumRun` rows, so text in the same colour
      // (code highlighting, a status dot) is not taken for it.
      let minimumRun = 12
      let width = CVPixelBufferGetWidth(pixels)
      var cyanRun = [Int](repeating: 0, count: width)
      var magentaRun = [Int](repeating: 0, count: width)
      var cyanBest = [Int](repeating: 0, count: width)
      var magentaBest = [Int](repeating: 0, count: width)
      for row in 0..<rows {
        let line = base.advanced(by: row * rowBytes).assumingMemoryBound(to: UInt8.self)
        for column in 0..<width {
          // BGRA.
          let b = Int(line[column * 4]), g = Int(line[column * 4 + 1]), r = Int(line[column * 4 + 2])
          if r < 190 && g > 200 && b > 200 && g - r > 50 && b - r > 50 {
            cyanRun[column] += 1
            cyanBest[column] = max(cyanBest[column], cyanRun[column])
            cyan.count += 1
          } else { cyanRun[column] = 0 }
          if r > 150 && b > 150 && g < 110 && r - g > 90 && b - g > 90 {
            magentaRun[column] += 1
            magentaBest[column] = max(magentaBest[column], magentaRun[column])
            magenta.count += 1
          } else { magentaRun[column] = 0 }
        }
      }
      if let column = cyanBest.firstIndex(where: { $0 >= minimumRun }) {
        cyan.left = column
      } else { cyan.count = 0 }
      if let column = magentaBest.firstIndex(where: { $0 >= minimumRun }) {
        magenta.left = column
      } else { magenta.count = 0 }
      // The cyan line's tallest run: about the toolbar's height while the
      // page covers the rest of it, taller where the page leaves it bare.
      cyan.count = cyan.left == Int.max ? 0 : cyanBest[cyan.left]
    }
    let at = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(buffer)) * 1000
    if let path = picturePath, !pictureTaken {
      pictureStart = pictureStart ?? at
      if at - pictureStart! >= pictureAt {
        pictureTaken = true
        let image = CIImage(cvPixelBuffer: pixels)
        let context = CIContext()
        if let cg = context.createCGImage(image, from: image.extent),
          let destination = CGImageDestinationCreateWithURL(
            URL(fileURLWithPath: path) as CFURL, "public.png" as CFString, 1, nil)
        {
          CGImageDestinationAddImage(destination, cg, nil)
          CGImageDestinationFinalize(destination)
        }
      }
    }
    frames.append((at, first ? 0 : changed, cyan, magenta))
  }
}

Task {
  do {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    let picked =
      windowId != 0
      ? content.windows.first { $0.windowID == windowId }
      // The app's largest window on screen: it also keeps window-wide strips
      // off screen (3440x30) that are wider than the workspace window.
      : content.windows.filter {
        $0.owningApplication?.processID == pid && $0.isOnScreen
      }
      .max { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
    guard let window = picked else {
      let own = content.windows.filter { $0.owningApplication?.processID == pid }
        .map { "\($0.windowID) layer \($0.windowLayer) on screen \($0.isOnScreen) \(Int($0.frame.width))x\(Int($0.frame.height))" }
      print("No such window; the app's windows: \(own.joined(separator: "; "))")
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
    // A window that closes first (the scenario's app quit) has already
    // stopped the stream; the frames up to then are still the recording.
    try? await stream.stopCapture()
    let rows: [[String: Double]] = output.frames.map { frame in
      var entry = ["at": frame.at, "rows": Double(frame.rows)]
      if findEdges {
        entry["cyan"] = Double(frame.cyan.count)
        entry["magenta"] = Double(frame.magenta.count)
        if frame.cyan.count > 0 { entry["cyanLeft"] = Double(frame.cyan.left) }
        if frame.magenta.count > 0 { entry["magentaLeft"] = Double(frame.magenta.left) }
      }
      return entry
    }
    print(String(data: try JSONSerialization.data(withJSONObject: rows), encoding: .utf8)!)
    exit(0)
  } catch {
    print("Could not record: \(error)")
    exit(4)
  }
}
RunLoop.main.run()
