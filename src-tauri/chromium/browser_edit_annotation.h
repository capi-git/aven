#pragma once
#import <Cocoa/Cocoa.h>

// A custom annotation surface above the existing CEF view. The browser remains
// attached and visible; page input is paused only while the comment is open.
@interface SMBrowserEditAnnotation : NSView
@property(nonatomic, readonly) BOOL active;
@property(nonatomic, readonly) NSRect targetRect;
@property(nonatomic, readonly) NSRect cardRect;
// `target` is a top-left-origin rect normalized to the full browser viewport.
// Returns NO if the selection or visible viewport cannot host the annotation.
// Callbacks are one-shot. Submit contains trimmed text, never an empty string.
- (BOOL)showAboveBrowser:(NSView *)browser target:(NSRect)target
               onSubmit:(void (^)(NSString *comment))submit
               onCancel:(void (^)(void))cancel
             onReselect:(void (^)(void))reselect;
// Clears without invoking a callback, including when the browser closes.
- (void)clear;
@end
