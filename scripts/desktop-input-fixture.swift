// A disposable, passive receiver for Aven Dev's opt-in native input checks.
// It never sends input, requests permissions, or opens user documents.
import AppKit

let receipt = URL(fileURLWithPath: CommandLine.arguments[1])
let nonce = CommandLine.arguments[2]
var downs = 0, ups = 0, drags = 0, scrolls = 0, presses = 0
var lastPoint = NSPoint.zero
var field: NSTextField!
var window: NSWindow!
var events: [[String: Any]] = []

final class Receiver: NSView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { downs += 1 }
    override func mouseUp(with event: NSEvent) { ups += 1; lastPoint = event.locationInWindow }
    override func mouseDragged(with event: NSEvent) { drags += 1; lastPoint = event.locationInWindow }
    override func scrollWheel(with event: NSEvent) { scrolls += 1 }
    @objc func pressed(_ sender: NSButton) { presses += 1 }
}

final class Delegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 420, y: 350, width: 440, height: 260),
                          styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "Aven Dev input receiver · " + nonce
        window.isReleasedWhenClosed = false
        window.animationBehavior = .none
        let view = Receiver(frame: NSRect(x: 0, y: 0, width: 440, height: 260))
        window.contentView = view
        field = NSTextField(frame: NSRect(x: 40, y: 40, width: 180, height: 28))
        view.addSubview(field)
        let button = NSButton(title: "Test button", target: view, action: #selector(Receiver.pressed(_:)))
        button.frame = NSRect(x: 260, y: 40, width: 140, height: 28)
        view.addSubview(button)
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(field)
        NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp, .mouseMoved, .leftMouseDragged, .scrollWheel]) { event in
            if events.count < 40 { events.append(["kind":event.type.rawValue,"window":event.windowNumber,"x":event.locationInWindow.x,"y":event.locationInWindow.y]) }
            return event
        }
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            let text = field.currentEditor()?.string ?? field.stringValue
            let values: [String: Any] = ["nonce": nonce, "pid": ProcessInfo.processInfo.processIdentifier,
                "windowId": window.windowNumber, "down": downs, "up": ups,
                "dragged": drags, "scrolled": scrolls, "buttonPresses": presses,
                "typedAndBackspace": text == "Aven Q", "x": lastPoint.x, "y": lastPoint.y,"events":events]
            if let data = try? JSONSerialization.data(withJSONObject: values) {
                try? data.write(to: receipt, options: .atomic)
            }
            if FileManager.default.fileExists(atPath: receipt.path + ".done") {
                NSApp.terminate(nil)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 45) { NSApp.terminate(nil) }
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = Delegate()
app.delegate = delegate
app.run()
