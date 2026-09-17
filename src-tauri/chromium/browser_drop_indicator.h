#pragma once
#import <Cocoa/Cocoa.h>

// A visual-only sibling above CEF. Its full-viewport frame is clipped by the
// existing browser host, so hover sidebars and Retina alignment stay intact.
@interface SMBrowserDropIndicator : NSView
@property(nonatomic, readonly) BOOL active;
@property(nonatomic, readonly) NSRect normalizedTarget;
@property(nonatomic, readonly) NSRect targetRect;
@property(nonatomic, readonly) NSRect labelRect;
@property(nonatomic, readonly) NSString *outcome;
@property(nonatomic, readonly) NSString *moveLabel;
@property(nonatomic, readonly) NSString *title;
- (BOOL)updateTarget:(NSRect)target edge:(NSString *)edge
               kind:(NSString *)kind title:(NSString *)title;
- (void)placeAboveBrowser:(NSView *)browser frame:(NSRect)frame;
- (void)clear;
@end
