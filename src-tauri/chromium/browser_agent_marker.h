#pragma once
#import <Cocoa/Cocoa.h>

typedef NS_ENUM(NSInteger, SMAgentMarkerAction) {
  SMAgentMarkerActionClick = 0,
  SMAgentMarkerActionType = 1,
  SMAgentMarkerActionKey = 2,
  SMAgentMarkerActionScroll = 3,
};

// Aven's agent pointer inside a browser pane: a soft ring in the acting
// agent's colour with a small name tag. A visual-only sibling above the CEF
// view in its clip view, like the drop indicator: clipped and masked with the
// pane, hidden with it, carried along when the page moves to another window.
// It never accepts input, focus or accessibility, and never shows typed text.
//
// Motion is Core Animation only: the render server animates a glide, ripple
// or pulse, and nothing runs on the main thread while the marker is idle.
@interface SMBrowserAgentMarker : NSView
// Visible or fading out.
@property(nonatomic, readonly) BOOL active;
// The last action point, top-left origin (the browser view's page points).
@property(nonatomic, readonly) NSPoint point;
@property(nonatomic, readonly) NSString *name;
@property(nonatomic, readonly) SMAgentMarkerAction lastAction;
// The name tag's side relative to the ring, after edge flipping.
@property(nonatomic, readonly) BOOL tagRight;
@property(nonatomic, readonly) BOOL tagBelow;
// Seconds after the last action before the marker fades. Tests shorten it.
@property(nonatomic) double linger;
// Overrides the system Reduce Motion setting when non-nil (tests).
@property(nonatomic, strong) NSNumber *reduceMotionOverride;
// Rejects invalid colours or empty names, keeping the previous identity.
- (BOOL)setActorName:(NSString *)name red:(double)red green:(double)green blue:(double)blue;
- (void)placeAboveBrowser:(NSView *)browser frame:(NSRect)frame;
// Glides (or appears) at `point` (top-left origin) and plays the action's feedback. Returns NO
// and draws nothing for a non-finite point.
- (BOOL)showAction:(SMAgentMarkerAction)action at:(NSPoint)point;
// Immediately hides and forgets the marker (pane hidden, closed or moved).
- (void)clear;
// Page captures copy on-screen pixels; keep the marker out of them.
- (void)suspendForCapture;
- (void)resumeAfterCapture;
@end
