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
var archivePresses = 0
var dialogOk = 0
var dialogCancels = 0
var dialog: NSWindow!
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
    @objc func archived(_ sender: NSButton) { archivePresses += 1 }
    @objc func ok(_ sender: NSButton) { dialogOk += 1 }
    @objc func cancelled(_ sender: NSButton) { dialogCancels += 1 }
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

/// A labelled container with no action of its own, like a message row.
func row(_ title: String, _ frame: NSRect) -> NSView {
    let view = NSView(frame: frame)
    view.setAccessibilityElement(true)
    view.setAccessibilityRole(.group)
    view.setAccessibilityLabel(title)
    return view
}

final class Delegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 40, y: 60, width: 520, height: 440),
                          styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "Aven accessibility fixture · " + nonce
        window.isReleasedWhenClosed = false
        window.animationBehavior = .none
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 520, height: 440))
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

        // A message row with an inline "Archive" button over its centre: an
        // element click on the row must never press the button. A second row
        // has only plain text at its centre.
        let message = row("Message from Ada", NSRect(x: 20, y: 392, width: 220, height: 36))
        let archive = NSButton(title: "Archive", target: target, action: #selector(Target.archived(_:)))
        archive.frame = NSRect(x: 60, y: 2, width: 100, height: 32)
        message.addSubview(archive)
        view.addSubview(message)
        let plain = row("Plain row", NSRect(x: 260, y: 392, width: 220, height: 36))
        plain.addSubview(label("Plain content", NSRect(x: 40, y: 8, width: 140, height: 20)))
        view.addSubview(plain)

        // A disabled text field: every element action must refuse it.
        let frozen = NSTextField(frame: NSRect(x: 300, y: 360, width: 180, height: 24))
        frozen.placeholderString = "Frozen"
        frozen.stringValue = "frozen text"
        frozen.isEnabled = false
        view.addSubview(frozen)

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

        // A dialog with an enabled default (Return) and cancel (Escape) button.
        dialog = NSWindow(contentRect: NSRect(x: 600, y: 60, width: 300, height: 120),
                          styleMask: [.titled], backing: .buffered, defer: false)
        dialog.title = "Aven fixture dialog · " + nonce
        dialog.isReleasedWhenClosed = false
        dialog.animationBehavior = .none
        let dialogView = NSView(frame: NSRect(x: 0, y: 0, width: 300, height: 120))
        dialog.contentView = dialogView
        let dialogField = NSTextField(frame: NSRect(x: 20, y: 70, width: 260, height: 24))
        dialogField.placeholderString = "Dialog name"
        dialogView.addSubview(dialogField)
        let okButton = NSButton(title: "OK", target: target, action: #selector(Target.ok(_:)))
        okButton.frame = NSRect(x: 180, y: 20, width: 100, height: 32)
        okButton.keyEquivalent = "\r"
        dialogView.addSubview(okButton)
        let cancelButton = NSButton(title: "Cancel", target: target, action: #selector(Target.cancelled(_:)))
        cancelButton.frame = NSRect(x: 70, y: 20, width: 100, height: 32)
        cancelButton.keyEquivalent = "\u{1b}"
        dialogView.addSubview(cancelButton)
        dialog.defaultButtonCell = okButton.cell as? NSButtonCell

        // Visible but behind every other window, and never key or active.
        window.orderBack(nil)
        dialog.orderBack(nil)

        let timer = Timer(timeInterval: 0.05, repeats: true) { _ in
            activeEver = activeEver || NSApp.isActive
            keyEver = keyEver || window.isKeyWindow || dialog.isKeyWindow
            let values: [String: Any] = [
                "nonce": nonce, "pid": ProcessInfo.processInfo.processIdentifier,
                "windowId": window.windowNumber, "presses": presses, "sendTitle": send.title,
                "name": name.stringValue, "notes": notes.string,
                "passwordLength": password.stringValue.count, "slider": slider.doubleValue,
                "scrollY": scroll.contentView.bounds.origin.y, "selectedRow": table.selectedRow,
                "menuOpened": menuOpened, "menuChoice": menuChoice, "inserted": inserted, "webClicks": webClicks, "lockedPresses": lockedPresses,
                "archivePresses": archivePresses, "dialogWindowId": dialog.windowNumber,
                "dialogOk": dialogOk, "dialogCancels": dialogCancels,
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
