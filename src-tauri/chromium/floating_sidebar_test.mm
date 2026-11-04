#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

#include "floating_sidebar.h"

// Real AppKit views in a hidden window; no webviews, CEF or rendering.

static std::vector<std::string> events;
static void Record(const char *, const char *event, const char *json, void *) {
  events.push_back(std::string(event) + " " + json);
}

@interface NSView (FloatingSidebarTesting)
- (void)trackEvent:(NSEvent *)event;
@end

// WKWebView is flipped; the workspace stays whole beneath the card either way.
@interface FlippedWorkspace : NSView
@end
@implementation FlippedWorkspace
- (BOOL)isFlipped {
  return YES;
}
@end

#define CHECK(condition)                                                           \
  do {                                                                             \
    if (!(condition)) {                                                            \
      std::fprintf(stderr, "Floating sidebar check failed at line %d: %s\n",       \
                   __LINE__, #condition);                                          \
      std::abort();                                                                \
    }                                                                              \
  } while (false)

static void Settle() {
  [CATransaction flush];
  [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
}

static bool Seen(const std::string &event) {
  for (const auto &entry : events)
    if (entry == event) return true;
  return false;
}

int main() {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 800, 600)
                                                   styleMask:NSWindowStyleMaskTitled
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    NSView *parent = window.contentView;
    FlippedWorkspace *workspace = [[FlippedWorkspace alloc] initWithFrame:parent.bounds];
    workspace.wantsLayer = YES;
    [parent addSubview:workspace];
    NSView *page = [[NSView alloc] initWithFrame:parent.bounds];
    [parent addSubview:page];
    // Wry adds a child webview to the content view; attaching moves it.
    NSView *overlay = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 10, 10)];
    [parent addSubview:overlay];

    CHECK(sm_sidebar_attach("main", (__bridge void *)workspace, (__bridge void *)overlay,
                            Record, nullptr) == 1);
    NSView *host = parent.subviews.lastObject;
    CHECK([host.identifier isEqualToString:supermono::kFloatingSidebarHostIdentifier]);
    CHECK(overlay.superview.superview == host);
    CHECK(NSEqualRects(overlay.frame, host.bounds));
    CHECK(overlay.superview.hidden);

    // One CSS pixel per point keeps the expectations readable.
    const double dpr = window.backingScaleFactor;
    CHECK(sm_sidebar_workspace("main", dpr, 800, 600, 40, 570, 1) == 1);
    const double card[] = {5, 45, 260, 550};
    CHECK(sm_sidebar_regions("main", dpr, 800, 600, 5, 45, 260, 550, card, 1) == 1);
    const auto hit = [&](double x, double y) {
      return [host hitTest:[parent convertPoint:NSMakePoint(x, y) fromView:host]];
    };
    // Closed: only the reveal edge takes the pointer.
    CHECK(hit(3, 300) == host);
    CHECK(hit(100, 300) == nil);
    CHECK(hit(500, 300) == nil);

    const auto move = [&](double x, double y) {
      NSEvent *event = [NSEvent mouseEventWithType:NSEventTypeMouseMoved
                                          location:[host convertPoint:NSMakePoint(x, y)
                                                               toView:nil]
                                     modifierFlags:0
                                         timestamp:0
                                      windowNumber:window.windowNumber
                                           context:nil
                                       eventNumber:0
                                        clickCount:0
                                          pressure:0];
      [host trackEvent:event];
    };
    // Resting on the edge warms the overlay past the window edge.
    move(3, 300);
    CHECK(Seen("pointer {\"inside\":false,\"edge\":true}"));
    CHECK(!overlay.superview.hidden);
    // Far enough that the card's shadow waits off-screen too.
    CHECK(overlay.superview.layer.sublayerTransform.m41 == -309);
    move(500, 300);
    CHECK(overlay.superview.hidden);

    // Open without motion: the card takes the pointer and the workspace stays
    // whole beneath it, with a frosted view exactly behind the card.
    CHECK(sm_sidebar_set_open("main", 1, 0) == 1);
    Settle();
    CHECK(!overlay.superview.hidden);
    CHECK(overlay.superview.layer.sublayerTransform.m41 == 0);
    CHECK(hit(100, 300) == overlay);
    CHECK(hit(500, 300) == nil);
    CHECK(workspace.layer.mask == nil);
    NSView *frost = overlay.superview.subviews.firstObject;
    CHECK([frost isKindOfClass:NSVisualEffectView.class]);
    CHECK(overlay.superview.subviews.lastObject == overlay);
    CHECK(NSMinX(frost.frame) == 5 && NSWidth(frost.frame) == 260);
    CHECK(NSMinY(frost.frame) == 5 && NSHeight(frost.frame) == 550);
    move(100, 300);
    CHECK(Seen("pointer {\"inside\":true,\"edge\":false}"));

    // A menu region beyond the card counts as inside, then lets go.
    const double menu[] = {5, 45, 260, 550, 200, 100, 180, 120};
    sm_sidebar_regions("main", dpr, 800, 600, 5, 45, 260, 550, menu, 2);
    CHECK(hit(300, 150) == overlay);
    move(300, 150);
    CHECK(events.back() == "pointer {\"inside\":true,\"edge\":false}");
    sm_sidebar_regions("main", dpr, 800, 600, 5, 45, 260, 550, card, 1);
    // The pointer did not move, but the menu that held it is gone.
    CHECK(events.back() == "pointer {\"inside\":false,\"edge\":false}");

    // Close without motion.
    CHECK(sm_sidebar_set_open("main", 0, 0) == 1);
    Settle();
    CHECK(overlay.superview.hidden);
    CHECK(Seen("closed {}"));
    CHECK(hit(100, 300) == nil);

    // Animated: the card slides on a spring.
    CHECK(sm_sidebar_set_open("main", 1, 1) == 1);
    CHECK([overlay.superview.layer animationForKey:@"slide"] != nil);

    // Pinning disables the layer and closes an open card at once.
    events.clear();
    CHECK(sm_sidebar_workspace("main", dpr, 800, 600, 40, 570, 0) == 1);
    Settle();
    CHECK(host.hidden);
    CHECK(overlay.superview.hidden);
    CHECK(sm_sidebar_set_open("main", 1, 0) == 1);
    CHECK(overlay.superview.hidden);

    CHECK(parent.subviews.lastObject == host);
    sm_sidebar_detach("main");
    CHECK(host.superview == nil);
    CHECK(sm_sidebar_set_open("main", 1, 0) == 0);
    CHECK(!window.visible);
    std::puts("Floating sidebar host checks passed");
  }
  return 0;
}
