// A disposable, passive AppKit window for Aven's accessibility-element checks.
// It never sends input, requests permissions, activates itself, or opens user
// documents. Its window is ordered behind other apps' windows; it reports what
// it received to a receipt file and exits when asked or after 60 seconds.
// Build: xcrun swiftc scripts/desktop-accessibility-fixture.swift -o <out>
// Run:   <out> <receipt.json> <nonce>
import AppKit
import WebKit

let receipt = URL(fileURLWithPath: CommandLine.arguments[1])
let nonce = CommandLine.arguments[2]
let secret = "fixture-secret-" + String(nonce.prefix(8))

var presses = 0
var menuOpened = 0
var menuChoice = ""
var inserted = 0
var webClicks = 0
var lockedPresses = 0
var web: WKWebView!
var activeEver = false
var keyEver = false
var window: NSWindow!
var send: NSButton!
var name: NSTextField!
var password: NSSecureTextField!
var notes: NSTextView!
var slider: NSSlider!
var table: NSTableView!
var scroll: NSScrollView!
var options: NSButton!

final class Target: NSObject, NSMenuDelegate, NSTableViewDataSource {
    @objc func pressed(_ sender: NSButton) {
        presses += 1
        sender.title = "Sent"
    }
    @objc func chose(_ sender: NSMenuItem) { menuChoice = sender.title }
    @objc func locked(_ sender: NSButton) { lockedPresses += 1 }
    func menuWillOpen(_ menu: NSMenu) {
        menuOpened += 1
        // Failsafe: never leave a menu open over the user's screen.
        let timer = Timer(timeInterval: 4, repeats: false) { _ in menu.cancelTracking() }
        RunLoop.main.add(timer, forMode: .common)
    }
    func numberOfRows(in tableView: NSTableView) -> Int { 200 + inserted }
    func tableView(_ tableView: NSTableView, objectValueFor column: NSTableColumn?, row: Int) -> Any? {
        row < inserted ? "New \(row)" : "Row \(row - inserted)"
    }
}

let target = Target()

// A local page with one button; WebKit serves its elements from a separate
// WebContent process. It loads no network content.
final class WebHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        webClicks += 1
    }
}
let webHandler = WebHandler()

func label(_ text: String, _ frame: NSRect) -> NSTextField {
    let field = NSTextField(labelWithString: text)
    field.frame = frame
    return field
}

final class Delegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 40, y: 60, width: 520, height: 380),
                          styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "Aven accessibility fixture · " + nonce
        window.isReleasedWhenClosed = false
        window.animationBehavior = .none
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 520, height: 380))
        window.contentView = view

        send = NSButton(title: "Send", target: target, action: #selector(Target.pressed(_:)))
        send.frame = NSRect(x: 20, y: 320, width: 120, height: 32)
        view.addSubview(send)

        options = NSButton(title: "Options", target: nil, action: nil)
        options.frame = NSRect(x: 160, y: 320, width: 120, height: 32)
        let menu = NSMenu(title: "Options")
        menu.delegate = target
        for title in ["Alpha", "Beta"] {
            let item = NSMenuItem(title: title, action: #selector(Target.chose(_:)), keyEquivalent: "")
            item.target = target
            menu.addItem(item)
        }
        options.menu = menu
        view.addSubview(options)

        // A disabled default button: Enter and element actions must refuse it.
        let locked = NSButton(title: "Locked", target: target, action: #selector(Target.locked(_:)))
        locked.frame = NSRect(x: 300, y: 320, width: 120, height: 32)
        locked.keyEquivalent = "\r"
        locked.isEnabled = false
        locked.menu = NSMenu(title: "Locked")
        view.addSubview(locked)

        name = NSTextField(frame: NSRect(x: 20, y: 280, width: 220, height: 24))
        name.placeholderString = "Name"
        view.addSubview(name)

        password = NSSecureTextField(frame: NSRect(x: 260, y: 280, width: 220, height: 24))
        password.placeholderString = "Password"
        password.stringValue = secret
        view.addSubview(password)

        slider = NSSlider(value: 50, minValue: 0, maxValue: 100, target: nil, action: nil)
        slider.frame = NSRect(x: 20, y: 240, width: 220, height: 24)
        slider.setAccessibilityLabel("Volume")
        view.addSubview(slider)

        let notesScroll = NSScrollView(frame: NSRect(x: 260, y: 200, width: 220, height: 64))
        notes = NSTextView(frame: NSRect(x: 0, y: 0, width: 220, height: 64))
        notes.setAccessibilityLabel("Notes")
        notes.string = "Hello"
        notesScroll.documentView = notes
        view.addSubview(notesScroll)

        scroll = NSScrollView(frame: NSRect(x: 20, y: 20, width: 220, height: 160))
        table = NSTableView(frame: scroll.bounds)
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("row"))
        column.title = "Rows"
        column.width = 200
        table.addTableColumn(column)
        table.dataSource = target
        table.setAccessibilityLabel("Rows")
        scroll.documentView = table
        scroll.hasVerticalScroller = true
        view.addSubview(scroll)
        view.addSubview(label("Passive accessibility fixture", NSRect(x: 260, y: 20, width: 240, height: 20)))

        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(webHandler, name: "aven")
        web = WKWebView(frame: NSRect(x: 260, y: 60, width: 240, height: 120), configuration: configuration)
        web.loadHTMLString(
            "<html><body><button aria-label=\"Web Go\" onclick=\"window.webkit.messageHandlers.aven.postMessage(1)\">Web Go</button></body></html>",
            baseURL: nil)
        view.addSubview(web)

        // Visible but behind every other window, and never key or active.
        window.orderBack(nil)

        let timer = Timer(timeInterval: 0.05, repeats: true) { _ in
            activeEver = activeEver || NSApp.isActive
            keyEver = keyEver || window.isKeyWindow
            let values: [String: Any] = [
                "nonce": nonce, "pid": ProcessInfo.processInfo.processIdentifier,
                "windowId": window.windowNumber, "presses": presses, "sendTitle": send.title,
                "name": name.stringValue, "notes": notes.string,
                "passwordLength": password.stringValue.count, "slider": slider.doubleValue,
                "scrollY": scroll.contentView.bounds.origin.y, "selectedRow": table.selectedRow,
                "menuOpened": menuOpened, "menuChoice": menuChoice, "inserted": inserted, "webClicks": webClicks, "lockedPresses": lockedPresses,
                "activeEver": activeEver, "keyEver": keyEver,
            ]
            if let data = try? JSONSerialization.data(withJSONObject: values) {
                try? data.write(to: receipt, options: .atomic)
            }
            // A message arriving at the top of a list: rows below keep their
            // places on screen but now show different content.
            if FileManager.default.fileExists(atPath: receipt.path + ".insert") {
                try? FileManager.default.removeItem(atPath: receipt.path + ".insert")
                inserted += 1
                table.reloadData()
            }
            if FileManager.default.fileExists(atPath: receipt.path + ".done") {
                NSApp.terminate(nil)
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        let failsafe = Timer(timeInterval: 60, repeats: false) { _ in NSApp.terminate(nil) }
        RunLoop.main.add(failsafe, forMode: .common)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = Delegate()
app.delegate = delegate
app.run()
