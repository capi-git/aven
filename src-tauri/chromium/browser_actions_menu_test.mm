#import "browser_actions_menu.h"
#include <cstdio>
#include <cstdlib>

#define CHECK(value) do { if (!(value)) { \
  std::fprintf(stderr, "Browser menu check failed at line %d: %s\n", __LINE__, #value); \
  std::abort(); } } while (false)

static NSMenuItem *Action(NSMenu *menu, NSString *identifier) {
  for (NSMenuItem *item in menu.itemArray)
    if ([item.representedObject isEqual:identifier]) return item;
  return nil;
}

int main() {
  @autoreleasepool {
    [NSApplication sharedApplication];
    supermono::BrowserMenuOptions options{true, true, false, true};
    NSMutableArray<NSString *> *first = [NSMutableArray array];
    NSMutableArray<NSString *> *second = [NSMutableArray array];
    SMBrowserActionsMenu *a = [[SMBrowserActionsMenu alloc] initWithOptions:options zoom:1
        onZoom:^(NSString *action) { [first addObject:action]; }];
    SMBrowserActionsMenu *b = [[SMBrowserActionsMenu alloc] initWithOptions:options zoom:1
        onZoom:^(NSString *action) { [second addObject:action]; }];
    [a.zoomIn performClick:nil];
    CHECK(first.count == 1 && [first.lastObject isEqual:@"zoom-in"]);
    CHECK(second.count == 0);
    [a updateZoom:1.2];
    CHECK([a.zoomReset.title isEqual:@"120%"] && [b.zoomReset.title isEqual:@"100%"]);
    [a.zoomOut performClick:nil]; [a.zoomReset performClick:nil];
    CHECK([first[1] isEqual:@"zoom-out"] && [first[2] isEqual:@"zoom-reset"]);
    CHECK([a.zoomOut.accessibilityLabel isEqual:@"Zoom out"]);
    CHECK([a.zoomReset.accessibilityLabel isEqual:@"Reset page zoom"]);
    CHECK([a.zoomIn.accessibilityLabel isEqual:@"Zoom in"]);
    [a updateZoom:.25]; [a.zoomOut performClick:nil];
    CHECK(!a.zoomOut.enabled && first.count == 3);
    [a updateZoom:5]; [a.zoomIn performClick:nil];
    CHECK(!a.zoomIn.enabled && first.count == 3);
    CHECK(Action(a.menu, @"find").enabled && Action(a.menu, @"devtools").enabled);
    CHECK([Action(a.menu, @"pip").title isEqual:@"Picture in Picture"]);
    options.floating = true;
    SMBrowserActionsMenu *floating = [[SMBrowserActionsMenu alloc] initWithOptions:options zoom:1 onZoom:nil];
    CHECK([Action(floating.menu, @"pip").title isEqual:@"Return to workspace"]);
    CHECK(!Action(floating.menu, @"find").enabled);
    options = {};
    SMBrowserActionsMenu *empty = [[SMBrowserActionsMenu alloc] initWithOptions:options zoom:1 onZoom:nil];
    CHECK(!empty.zoomIn.enabled && !empty.zoomOut.enabled && !empty.zoomReset.enabled);
    CHECK(!Action(empty.menu, @"find").enabled && !Action(empty.menu, @"external").enabled);
    CHECK(Action(empty.menu, @"downloads").enabled);
    CHECK(!Action(empty.menu, @"pip") && !Action(empty.menu, @"chat"));
    CHECK(a.menu.itemArray.firstObject.view != nil && !a.menu.autoenablesItems);
    std::puts("Browser native menu controls and per-page zoom callbacks passed");
  }
}
