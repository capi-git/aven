#pragma once
#import <Cocoa/Cocoa.h>

namespace supermono {
struct BrowserMenuOptions {
  bool can_add_to_chat = false;
  bool can_float = false;
  bool floating = false;
  bool can_use_page = false;
};
}

// AppKit owns the menu window above both WK and CEF. Nothing in this controller
// hides, reparents, snapshots, or changes focus in the browser's native view.
@interface SMBrowserActionsMenu : NSObject
@property(nonatomic, readonly) NSMenu *menu;
@property(nonatomic, readonly) NSButton *zoomOut;
@property(nonatomic, readonly) NSButton *zoomReset;
@property(nonatomic, readonly) NSButton *zoomIn;
- (instancetype)initWithOptions:(supermono::BrowserMenuOptions)options
                           zoom:(double)factor
                         onZoom:(void (^)(NSString *action))onZoom;
- (NSString *)showAt:(NSPoint)point inView:(NSView *)view;
- (void)updateZoom:(double)factor;
- (void)cancel;
@end
