#pragma once
#import <Cocoa/Cocoa.h>

// Plain numeric sRGB only. Both the Rust boundary and this view validate it.
struct SMBrowserDropPalette {
  double stroke[4];
  double fill[4];
  double halo[4];
};

// The workspace's pane drop preview, drawn the same way: its box, wash,
// 1px edge and 0.5px outline, its corner radius in CSS pixels, at the
// interface zoom (CSS pixels to points). Older callers get its defaults.
struct SMBrowserDropShape {
  double radius;
  double zoom;
};

// A visual-only sibling above CEF. Its full-viewport frame is clipped by the
// existing browser host, so hover sidebars and Retina alignment stay intact.
// It moves as the HTML preview does (WorkspaceStage.tsx, motionTokens.ts): in
// from the side it splits, fading and growing a little, gliding on a spring
// between zones, and fading where it is when the drag leaves.
@interface SMBrowserDropIndicator : NSView
@property(nonatomic, readonly) BOOL active;
@property(nonatomic, readonly) NSRect normalizedTarget;
@property(nonatomic, readonly) NSRect targetRect;
@property(nonatomic, readonly) NSString *outcome;
@property(nonatomic, readonly) NSString *moveLabel;
@property(nonatomic, readonly) NSString *title;
// Points: the corner radius and edge width it draws with now.
@property(nonatomic, readonly) CGFloat cornerRadius;
@property(nonatomic, readonly) CGFloat edgeWidth;
// Off for checks that read the drawn layers at once.
@property(nonatomic) BOOL animates;
- (BOOL)updateTarget:(NSRect)target edge:(NSString *)edge
               kind:(NSString *)kind title:(NSString *)title;
- (BOOL)updateTarget:(NSRect)target edge:(NSString *)edge
               kind:(NSString *)kind title:(NSString *)title
            palette:(const SMBrowserDropPalette *)palette;
- (BOOL)updateTarget:(NSRect)target edge:(NSString *)edge
               kind:(NSString *)kind title:(NSString *)title
            palette:(const SMBrowserDropPalette *)palette
              shape:(const SMBrowserDropShape *)shape;
- (void)placeAboveBrowser:(NSView *)browser frame:(NSRect)frame;
// At once: the page is hidden, moved or gone.
- (void)clear;
// The drag left: it fades where it is, as the HTML preview does.
- (void)fadeOut;
@end
