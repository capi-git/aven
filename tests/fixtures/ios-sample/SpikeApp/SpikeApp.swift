import SwiftUI

@main
struct SpikeApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
    @State private var taps = 0
    @State private var text = ""
    @State private var spinning = false
    @State private var lastTouch: CGPoint? = nil

    var body: some View {
        VStack(spacing: 24) {
            Text("Aven Sim Spike").font(.largeTitle.bold())
            Text("Taps: \(taps)").font(.title).accessibilityIdentifier("tapCount")
            Button("Tap me") {
                taps += 1
                print("SPIKE tap \(taps) at \(Date().timeIntervalSince1970)")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .accessibilityIdentifier("tapButton")

            TextField("Type here", text: $text)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal, 32)
                .accessibilityIdentifier("textField")
                .onChange(of: text) { _, new in print("SPIKE text \(new)") }
            Text("Echo: \(text)").accessibilityIdentifier("echo")

            Toggle("Animate (FPS test)", isOn: $spinning).padding(.horizontal, 32)
            if spinning {
                TimelineView(.animation) { ctx in
                    let t = ctx.date.timeIntervalSinceReferenceDate
                    Rectangle()
                        .fill(Color(hue: (t * 0.5).truncatingRemainder(dividingBy: 1), saturation: 0.8, brightness: 0.9))
                        .frame(width: 120, height: 120)
                        .rotationEffect(.degrees(t * 180))
                }
            }
            Spacer()
        }
        .padding(.top, 40)
        .contentShape(Rectangle())
        .onAppear { print("SPIKE launched") }
    }
}
