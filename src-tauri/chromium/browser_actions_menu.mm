#import "browser_actions_menu.h"
#include <cmath>

@implementation SMBrowserActionsMenu {
  NSMenu *_menu;
  NSButton *_zoomOut;
  NSButton *_zoomReset;
  NSButton *_zoomIn;
  void (^_onZoom)(NSString *);
  NSString *_selection;
  BOOL _canZoom;
}
@synthesize menu = _menu, zoomOut = _zoomOut, zoomReset = _zoomReset, zoomIn = _zoomIn;

- (NSButton *)zoomButton:(NSString *)title label:(NSString *)label
                  frame:(NSRect)frame action:(SEL)action {
  NSButton *button = [NSButton buttonWithTitle:title target:self action:action];
  button.frame = frame;
  button.bezelStyle = NSBezelStyleRounded;
  button.controlSize = NSControlSizeSmall;
  button.font = [NSFont systemFontOfSize:13];
  button.accessibilityLabel = label;
  button.toolTip = label;
  return button;
}
- (void)addAction:(NSString *)action title:(NSString *)title enabled:(BOOL)enabled {
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title
      action:@selector(pick:) keyEquivalent:@""];
  item.target = self;
  item.representedObject = action;
  item.enabled = enabled;
  [_menu addItem:item];
}
- (instancetype)initWithOptions:(supermono::BrowserMenuOptions)options
                           zoom:(double)factor
                         onZoom:(void (^)(NSString *))onZoom {
  if (!(self = [super init])) return nil;
  _onZoom = [onZoom copy];
  _canZoom = options.can_use_page;
  _menu = [[NSMenu alloc] initWithTitle:@"Browser actions"];
  _menu.autoenablesItems = NO;
  _menu.minimumWidth = 224;
  NSView *row = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 224, 38)];
  NSTextField *label = [NSTextField labelWithString:@"Zoom"];
  label.frame = NSMakeRect(14, 10, 62, 18);
  label.font = [NSFont systemFontOfSize:13];
  label.textColor = NSColor.labelColor;
  [row addSubview:label];
  _zoomOut = [self zoomButton:@"−" label:@"Zoom out" frame:NSMakeRect(83, 6, 32, 26) action:@selector(decreaseZoom:)];
  _zoomReset = [self zoomButton:@"100%" label:@"Reset page zoom" frame:NSMakeRect(117, 6, 58, 26) action:@selector(resetZoom:)];
  _zoomIn = [self zoomButton:@"+" label:@"Zoom in" frame:NSMakeRect(177, 6, 32, 26) action:@selector(increaseZoom:)];
  [row addSubview:_zoomOut]; [row addSubview:_zoomReset]; [row addSubview:_zoomIn];
  NSMenuItem *zoom = [[NSMenuItem alloc] initWithTitle:@"Page zoom" action:NULL keyEquivalent:@""];
  zoom.view = row;
  [_menu addItem:zoom];
  [_menu addItem:NSMenuItem.separatorItem];
  [self addAction:@"find" title:@"Find in page" enabled:options.can_use_page && !options.floating];
  [self addAction:@"downloads" title:@"Downloads" enabled:YES];
  [self addAction:@"devtools" title:@"Developer tools" enabled:options.can_use_page];
  [_menu addItem:NSMenuItem.separatorItem];
  if (options.can_float)
    [self addAction:@"pip" title:options.floating ? @"Return to workspace" : @"Picture in Picture" enabled:options.can_use_page];
  if (options.can_add_to_chat)
    [self addAction:@"chat" title:@"Add URL to chat" enabled:options.can_use_page];
  [self addAction:@"external" title:@"Open in Brave" enabled:options.can_use_page];
  [self updateZoom:factor];
  return self;
}
- (void)updateZoom:(double)factor {
  if (!std::isfinite(factor)) factor = 1;
  _zoomReset.title = [NSString stringWithFormat:@"%.0f%%", factor * 100];
  _zoomOut.enabled = _canZoom && factor > .25;
  _zoomIn.enabled = _canZoom && factor < 5;
  _zoomReset.enabled = _canZoom;
}
- (void)decreaseZoom:(id)sender { if (_zoomOut.enabled && _onZoom) _onZoom(@"zoom-out"); }
- (void)resetZoom:(id)sender { if (_zoomReset.enabled && _onZoom) _onZoom(@"zoom-reset"); }
- (void)increaseZoom:(id)sender { if (_zoomIn.enabled && _onZoom) _onZoom(@"zoom-in"); }
- (void)pick:(NSMenuItem *)item { if (item.enabled) _selection = item.representedObject; }
- (NSString *)showAt:(NSPoint)point inView:(NSView *)view {
  _selection = nil;
  [_menu popUpMenuPositioningItem:nil atLocation:point inView:view];
  return _selection;
}
- (void)cancel { _selection = nil; [_menu cancelTracking]; }
@end
