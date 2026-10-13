#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#include <cstdio>
#include <cstdlib>
#include <limits>

#import "browser_agent_marker.h"

static int checks = 0;
#define CHECK(condition) do { \
  if (!(condition)) { \
    std::fprintf(stderr, "Agent marker check failed at line %d: %s\n", __LINE__, #condition); \
    std::abort(); \
  } \
  ++checks; \
} while (false)

static void Spin(double seconds) {
  [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]];
}

static CALayer *Anchor(SMBrowserAgentMarker *marker) { return marker.layer.sublayers.firstObject; }

// Visual-only: no input, focus or accessibility; inert until an action.
static void Inert() {
  SMBrowserAgentMarker *marker = [[SMBrowserAgentMarker alloc] initWithFrame:NSMakeRect(0, 0, 800, 600)];
  CHECK(marker.hidden && !marker.active && !marker.isOpaque);
  // A flipped host would make AppKit flip the hosted layers (mirrored text).
  CHECK(!marker.isFlipped && !marker.layer.geometryFlipped && !marker.layer.contentsAreFlipped);
  CHECK(!marker.acceptsFirstResponder && !marker.isAccessibilityElement);
  CHECK([marker hitTest:NSMakePoint(10, 10)] == nil);
  CHECK([marker.name isEqualToString:@"Agent"]);
  CHECK(![marker showAction:SMAgentMarkerActionClick at:NSMakePoint(NAN, 4)]);
  CHECK(!marker.active && marker.hidden);
  CHECK(![marker setActorName:@"" red:1 green:0 blue:0]);
  CHECK(![marker setActorName:@"Claude" red:2 green:0 blue:0]);
  CHECK(![marker setActorName:@"Claude" red:std::numeric_limits<double>::quiet_NaN() green:0 blue:0]);
  CHECK([marker.name isEqualToString:@"Agent"]);
  CHECK([marker setActorName:@"  Claude\n‮Code  " red:.85 green:.47 blue:.34]);
  CHECK([marker.name isEqualToString:@"Claude Code"]);
  CHECK([marker setActorName:@"An exceptionally long provider name here" red:.5 green:.5 blue:.5]);
  CHECK(marker.name.length == 24 && [marker.name hasSuffix:@"…"]);
}

// A sibling directly above the browser in its clip view; follows reparenting.
static void Placement() {
  NSView *clip = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 800, 600)];
  NSView *browser = [[NSView alloc] initWithFrame:NSMakeRect(-40, 0, 840, 600)];
  NSView *other = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 10, 10)];
  [clip addSubview:browser];
  [clip addSubview:other];
  SMBrowserAgentMarker *marker = [[SMBrowserAgentMarker alloc] initWithFrame:NSZeroRect];
  [marker placeAboveBrowser:browser frame:browser.frame];
  CHECK(marker.superview == clip);
  CHECK([clip.subviews indexOfObjectIdenticalTo:marker] == [clip.subviews indexOfObjectIdenticalTo:browser] + 1);
  CHECK(NSEqualRects(marker.frame, browser.frame));
  // A detached browser keeps the marker attached above it in the new clip view.
  NSView *nextClip = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 500, 400)];
  [nextClip addSubview:browser];
  [marker placeAboveBrowser:browser frame:NSMakeRect(0, 0, 500, 400)];
  CHECK(marker.superview == nextClip && NSEqualRects(marker.frame, NSMakeRect(0, 0, 500, 400)));
  [browser removeFromSuperview];
  [marker placeAboveBrowser:browser frame:NSMakeRect(0, 0, 500, 400)];
  CHECK(marker.superview == nil && !marker.active);
}

static void ShowFadeAndClear() {
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 800, 600)
      styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
  NSView *clip = window.contentView;
  NSView *browser = [[NSView alloc] initWithFrame:clip.bounds];
  [clip addSubview:browser];
  SMBrowserAgentMarker *marker = [[SMBrowserAgentMarker alloc] initWithFrame:browser.frame];
  marker.reduceMotionOverride = @NO;
  marker.linger = .15;
  [marker placeAboveBrowser:browser frame:browser.frame];
  CHECK([marker showAction:SMAgentMarkerActionClick at:NSMakePoint(100, 50)]);
  CHECK(marker.active && !marker.hidden);
  CHECK(NSEqualPoints(marker.point, NSMakePoint(100, 50)));
  // Top-left action point -> unflipped hosted layer.
  CHECK(CGPointEqualToPoint(Anchor(marker).position, CGPointMake(100, 550)));
  CHECK(marker.tagRight && marker.tagBelow);
  // A second action glides there (Core Animation, no app timer).
  CHECK([marker showAction:SMAgentMarkerActionType at:NSMakePoint(775, 585)]);
  CHECK([Anchor(marker) animationForKey:@"glide"] != nil);
  CHECK(!marker.tagRight && !marker.tagBelow);
  CHECK(marker.lastAction == SMAgentMarkerActionType);
  // Captures hide it, then restore it.
  [marker suspendForCapture];
  CHECK(marker.hidden && marker.active);
  [marker suspendForCapture];
  [marker resumeAfterCapture];
  CHECK(marker.hidden);
  [marker resumeAfterCapture];
  CHECK(!marker.hidden);
  [marker resumeAfterCapture];  // unbalanced resume is ignored
  CHECK(!marker.hidden);
  // Fades after the last action.
  Spin(.15 + .28 + .42 + .3);
  CHECK(!marker.active && marker.hidden);
  // A resize while shown keeps the same page point.
  CHECK([marker showAction:SMAgentMarkerActionKey at:NSMakePoint(10, 20)]);
  [marker setFrameSize:NSMakeSize(800, 300)];
  CHECK(CGPointEqualToPoint(Anchor(marker).position, CGPointMake(10, 280)));
  // A newer action cancels the pending fade of an older one.
  Spin(.1);
  CHECK([marker showAction:SMAgentMarkerActionScroll at:NSMakePoint(30, 30)]);
  Spin(.1);
  CHECK(marker.active);
  // Hidden pane: cleared immediately, and a stale fade never revives it.
  [marker clear];
  CHECK(!marker.active && marker.hidden);
  Spin(.6);
  CHECK(!marker.active && marker.hidden);
  // Leaving the window clears it too.
  CHECK([marker showAction:SMAgentMarkerActionClick at:NSMakePoint(30, 30)]);
  [marker removeFromSuperview];
  CHECK(!marker.active && marker.hidden);
}

// Reduce Motion: jump and crossfade, never glide or ripple.
static void ReduceMotion() {
  SMBrowserAgentMarker *marker = [[SMBrowserAgentMarker alloc] initWithFrame:NSMakeRect(0, 0, 400, 300)];
  marker.reduceMotionOverride = @YES;
  CHECK([marker showAction:SMAgentMarkerActionClick at:NSMakePoint(10, 10)]);
  CHECK([marker showAction:SMAgentMarkerActionClick at:NSMakePoint(300, 200)]);
  CHECK([Anchor(marker) animationForKey:@"glide"] == nil);
  CHECK([Anchor(marker) animationForKey:@"fade"] != nil);
  CHECK(CGPointEqualToPoint(Anchor(marker).position, CGPointMake(300, 100)));
  [marker clear];
}

int main() {
  @autoreleasepool {
    [NSApplication sharedApplication];
    Inert();
    Placement();
    ShowFadeAndClear();
    ReduceMotion();
    std::printf("%d agent marker checks passed\n", checks);
  }
}
