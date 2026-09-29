#pragma once
#import <Cocoa/Cocoa.h>

// Plain numeric sRGB only. Both the Rust boundary and this view validate it.
struct SMBrowserDropPalette {
  double stroke[4];
  double fill[4];
  double halo[4];
};

// A visual-only sibling above CEF. Its full-viewport frame is clipped by the
// existing browser host, so hover sidebars and Retina alignment stay intact.
@interface SMBrowserDropIndicator : NSView
@property(nonatomic, readonly) BOOL active;
@property(nonatomic, readonly) NSRect normalizedTarget;
@property(nonatomic, readonly) NSRect targetRect;
@property(nonatomic, readonly) NSString *outcome;
@property(nonatomic, readonly) NSString *moveLabel;
@property(nonatomic, readonly) NSString *title;
- (BOOL)updateTarget:(NSRect)target edge:(NSString *)edge
               kind:(NSString *)kind title:(NSString *)title;
- (BOOL)updateTarget:(NSRect)target edge:(NSString *)edge
               kind:(NSString *)kind title:(NSString *)title
            palette:(const SMBrowserDropPalette *)palette;
- (void)placeAboveBrowser:(NSView *)browser frame:(NSRect)frame;
- (void)clear;
@end
