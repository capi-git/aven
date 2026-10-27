import XCTest
import Network

/// Aven's simulator agent: an XCUITest that serves JSON-line commands on
/// 127.0.0.1 (the simulator shares the Mac's loopback). Aven uses it for
/// accessibility snapshots, and for input when its native path is
/// unavailable. Every request carries the token Aven passed at launch.
///
/// Requests: {"action":"activate","bundleId":..} {"action":"snapshot"}
///           {"action":"tap","x":..,"y":..} {"action":"swipe","x1":..,"y1":..,"x2":..,"y2":..}
///           {"action":"type","text":..} {"action":"press","button":"home"}
///           {"action":"orientation","value":"landscapeLeft"} {"action":"quit"}
/// Points are the screen's upright points, from its top-left corner.
final class AgentServer: XCTestCase {
    var app = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    var token = ""

    func testServe() throws {
        let env = ProcessInfo.processInfo.environment
        guard let raw = UInt16(env["AVEN_AGENT_PORT"] ?? ""), let port = NWEndpoint.Port(rawValue: raw) else {
            XCTFail("AVEN_AGENT_PORT is missing")
            return
        }
        token = env["AVEN_AGENT_TOKEN"] ?? ""
        if token.isEmpty {
            XCTFail("AVEN_AGENT_TOKEN is missing")
            return
        }
        if let bundle = env["AVEN_AGENT_BUNDLE_ID"], !bundle.isEmpty {
            app = XCUIApplication(bundleIdentifier: bundle)
        }
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: port)
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
                        lock.lock(); queue.append((line, connection)); lock.unlock()
                    }
                    if !done && error == nil { receive(pending) }
                }
            }
            receive(Data())
        }
        listener.start(queue: .global())
        print("AVEN_AGENT_READY port=\(port.rawValue)")
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
        guard (request["token"] as? String) == token else { throw failure("Not allowed") }
        func number(_ key: String) throws -> Double {
            guard let value = (request[key] as? NSNumber)?.doubleValue, value.isFinite else {
                throw failure("\(key) is required")
            }
            return value
        }
        func point(_ kx: String, _ ky: String) throws -> XCUICoordinate {
            let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
            return origin.withOffset(CGVector(dx: try number(kx), dy: try number(ky)))
        }
        switch action {
        case "activate":
            let bundle = request["bundleId"] as? String ?? "com.apple.springboard"
            app = XCUIApplication(bundleIdentifier: bundle)
        case "tap":
            try point("x", "y").tap()
        case "swipe":
            try point("x1", "y1").press(forDuration: 0.05, thenDragTo: try point("x2", "y2"))
        case "type":
            app.typeText(request["text"] as? String ?? "")
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

    /// The foreground app's accessibility tree, depth first.
    private func snapshot(limit: Int) throws -> [String: Any] {
        let root = try app.snapshot()
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
        return ["nodes": nodes, "truncated": truncated]
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
