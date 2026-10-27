import XCTest
import Network

/// Aven's simulator agent: an XCUITest that serves JSON-line commands on
/// 127.0.0.1 (the simulator shares the Mac's loopback). Aven uses it for
/// accessibility snapshots, and for input when its native path is
/// unavailable. Every request carries the token Aven passed at launch.
///
/// Requests: {"action":"activate","bundleId":..} {"action":"snapshot"} {"action":"screen"}
///           {"action":"tap","x":..,"y":..} {"action":"swipe","x1":..,"y1":..,"x2":..,"y2":..}
///           {"action":"type","text":..} {"action":"press","button":"home"}
///           {"action":"orientation","value":"landscapeLeft"} {"action":"quit"}
/// Points are the screen's upright points, from its top-left corner, whatever
/// app is in front. The server listens on a port the system picks and prints
/// it once listening: `AVEN_AGENT_READY port=<n>`.
final class AgentServer: XCTestCase {
    /// The project's app; the home screen when it is not in front.
    var app = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    var appBundle = "com.apple.springboard"
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    var token: [UInt8] = []
    /// Requests waiting for the main loop; more are refused.
    let maxQueued = 64

    func testServe() throws {
        let env = ProcessInfo.processInfo.environment
        token = Array((env["AVEN_AGENT_TOKEN"] ?? "").utf8)
        if token.count < 32 {
            XCTFail("AVEN_AGENT_TOKEN is missing")
            return
        }
        if let bundle = env["AVEN_AGENT_BUNDLE_ID"], !bundle.isEmpty {
            app = XCUIApplication(bundleIdentifier: bundle)
            appBundle = bundle
        }
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: params)
        var quit = false
        // XCTest is not thread safe: the network side only queues lines and
        // the test's main loop runs them.
        var queue: [(String, NWConnection)] = []
        let lock = NSLock()
        listener.newConnectionHandler = { connection in
            connection.start(queue: .global())
            func receive(_ buffer: Data) {
                connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, done, error in
                    var pending = buffer + (data ?? Data())
                    if pending.count > 1_000_000 {
                        connection.cancel()
                        return
                    }
                    while let newline = pending.firstIndex(of: 0x0a) {
                        let line = String(decoding: pending[pending.startIndex..<newline], as: UTF8.self)
                        pending = Data(pending[pending.index(after: newline)...])
                        lock.lock()
                        let full = queue.count >= self.maxQueued
                        if !full { queue.append((line, connection)) }
                        lock.unlock()
                        if full {
                            connection.cancel()
                            return
                        }
                    }
                    if !done && error == nil { receive(pending) }
                }
            }
            receive(Data())
        }
        // Announce the port only once the listener really holds it.
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                if let port = listener.port { print("AVEN_AGENT_READY port=\(port.rawValue)") }
            case .failed(let error):
                // Aven stops waiting for the ready line and ends this run.
                print("AVEN_AGENT_FAILED \(error)")
            default:
                break
            }
        }
        listener.start(queue: .global())
        while !quit {
            lock.lock(); let batch = queue; queue.removeAll(); lock.unlock()
            for (line, connection) in batch {
                let started = Date()
                var reply: [String: Any] = ["ok": true]
                do {
                    reply.merge(try handle(line, &quit)) { $1 }
                } catch {
                    reply = ["ok": false, "error": (error as NSError).localizedDescription]
                }
                reply["ms"] = Int(Date().timeIntervalSince(started) * 1000)
                let data = (try? JSONSerialization.data(withJSONObject: reply)) ?? Data("{}".utf8)
                connection.send(content: data + Data([0x0a]), completion: .contentProcessed { _ in })
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.01))
        }
        listener.cancel()
    }

    private func failure(_ message: String) -> NSError {
        NSError(domain: "aven.agent", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private func handle(_ line: String, _ quit: inout Bool) throws -> [String: Any] {
        guard let request = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
              let action = request["action"] as? String else { throw failure("Malformed request") }
        guard sameToken(request["token"] as? String) else { throw failure("Not allowed") }
        func number(_ key: String) throws -> Double {
            guard let value = (request[key] as? NSNumber)?.doubleValue, value.isFinite else {
                throw failure("\(key) is required")
            }
            return value
        }
        func point(_ kx: String, _ ky: String) throws -> XCUICoordinate {
            // The home screen spans the screen: its corner is the screen's.
            let origin = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
            return origin.withOffset(CGVector(dx: try number(kx), dy: try number(ky)))
        }
        switch action {
        case "activate":
            let bundle = request["bundleId"] as? String ?? "com.apple.springboard"
            app = XCUIApplication(bundleIdentifier: bundle)
            appBundle = bundle
        case "tap":
            try point("x", "y").tap()
        case "swipe":
            try point("x1", "y1").press(forDuration: 0.05, thenDragTo: try point("x2", "y2"))
        case "type":
            foreground().typeText(request["text"] as? String ?? "")
        case "screen":
            let size = springboard.frame.size
            return ["screen": [Double(size.width), Double(size.height)]]
        case "press":
            guard request["button"] as? String == "home" else { throw failure("Only the home button is available") }
            XCUIDevice.shared.press(.home)
        case "orientation":
            let map: [String: UIDeviceOrientation] = [
                "portrait": .portrait, "landscapeLeft": .landscapeLeft,
                "landscapeRight": .landscapeRight, "portraitUpsideDown": .portraitUpsideDown,
            ]
            guard let value = map[request["value"] as? String ?? ""] else { throw failure("Unknown orientation") }
            XCUIDevice.shared.orientation = value
        case "snapshot":
            return try snapshot(limit: (request["maxNodes"] as? NSNumber)?.intValue ?? 400)
        case "quit":
            quit = true
        default:
            throw failure("Unknown action \(action)")
        }
        return [:]
    }

    /// The project's app when it is in front, otherwise the home screen.
    private func foreground() -> XCUIApplication {
        appBundle != "com.apple.springboard" && app.state == .runningForeground ? app : springboard
    }

    private func sameToken(_ given: String?) -> Bool {
        let bytes = Array((given ?? "").utf8)
        var difference = UInt8(bytes.count == token.count ? 0 : 1)
        for index in 0..<token.count {
            difference |= token[index] ^ (index < bytes.count ? bytes[index] : 0)
        }
        return difference == 0
    }

    /// The front app's accessibility tree, depth first.
    private func snapshot(limit: Int) throws -> [String: Any] {
        let front = foreground()
        let frontBundle = front === springboard ? "com.apple.springboard" : appBundle
        let root = try front.snapshot()
        var nodes: [[String: Any]] = []
        var truncated = false
        func walk(_ element: XCUIElementSnapshot, _ depth: Int) {
            if nodes.count >= limit { truncated = true; return }
            let f = element.frame
            var node: [String: Any] = [
                "type": typeName(element.elementType), "depth": depth,
                "frame": [Int(f.minX.rounded()), Int(f.minY.rounded()), Int(f.width.rounded()), Int(f.height.rounded())],
            ]
            if !element.identifier.isEmpty { node["id"] = element.identifier }
            if !element.label.isEmpty { node["label"] = element.label }
            if let value = element.value as? String, !value.isEmpty {
                node["value"] = element.elementType == .secureTextField ? "<redacted>" : value
            }
            if let placeholder = element.placeholderValue, !placeholder.isEmpty { node["placeholder"] = placeholder }
            if !element.isEnabled { node["disabled"] = true }
            if element.isSelected { node["selected"] = true }
            if element.hasFocus { node["focused"] = true }
            nodes.append(node)
            for child in element.children { walk(child, depth + 1) }
        }
        walk(root, 0)
        let size = springboard.frame.size
        return ["nodes": nodes, "truncated": truncated, "app": frontBundle,
                "screen": [Double(size.width), Double(size.height)]]
    }

    private func typeName(_ type: XCUIElement.ElementType) -> String {
        switch type {
        case .application: return "Application"
        case .window: return "Window"
        case .button: return "Button"
        case .staticText: return "Text"
        case .textField: return "TextField"
        case .secureTextField: return "SecureTextField"
        case .textView: return "TextView"
        case .searchField: return "SearchField"
        case .image: return "Image"
        case .icon: return "Icon"
        case .cell: return "Cell"
        case .table: return "Table"
        case .collectionView: return "CollectionView"
        case .scrollView: return "ScrollView"
        case .navigationBar: return "NavigationBar"
        case .tabBar: return "TabBar"
        case .toolbar: return "Toolbar"
        case .switch: return "Switch"
        case .toggle: return "Toggle"
        case .slider: return "Slider"
        case .stepper: return "Stepper"
        case .picker: return "Picker"
        case .pickerWheel: return "PickerWheel"
        case .segmentedControl: return "SegmentedControl"
        case .link: return "Link"
        case .alert: return "Alert"
        case .sheet: return "Sheet"
        case .keyboard: return "Keyboard"
        case .key: return "Key"
        case .menu: return "Menu"
        case .menuItem: return "MenuItem"
        case .webView: return "WebView"
        case .progressIndicator: return "ProgressIndicator"
        case .activityIndicator: return "ActivityIndicator"
        case .pageIndicator: return "PageIndicator"
        case .statusBar: return "StatusBar"
        case .group: return "Group"
        case .other: return "Other"
        default: return "Element"
        }
    }
}
