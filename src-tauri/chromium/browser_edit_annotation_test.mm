#import <Cocoa/Cocoa.h>
#import "browser_edit_annotation.h"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>

#define CHECK(condition) do { \
  if (!(condition)) { \
    std::fprintf(stderr, "Annotation check failed at line %d: %s\n", __LINE__, #condition); \
    std::abort(); \
  } \
} while (false)

@interface SMAnnotationBrowserProbe : NSView
@property(nonatomic) int detachments;
@property(nonatomic) int scrollEvents;
@end
@implementation SMAnnotationBrowserProbe
- (void)viewWillMoveToSuperview:(NSView *)next {
  if (!next) ++_detachments;
  [super viewWillMoveToSuperview:next];
}
- (void)scrollWheel:(NSEvent *)event { ++_scrollEvents; }
@end

@interface SMAnnotationMarkedText : NSTextView
@end
@implementation SMAnnotationMarkedText
- (BOOL)hasMarkedText { return YES; }
@end

static NSControl *Control(SMBrowserEditAnnotation *view, NSString *identifier) {
  for (NSView *child in view.subviews)
    if ([child.identifier isEqualToString:identifier]) return (NSControl *)child;
  std::abort();
}
static void EnterText(SMBrowserEditAnnotation *view, NSString *text) {
  NSTextField *field = (NSTextField *)Control(view, @"browser-edit-comment");
  field.stringValue = text;
  [field.delegate controlTextDidChange:[NSNotification
      notificationWithName:NSControlTextDidChangeNotification object:field]];
}
static void Click(SMBrowserEditAnnotation *view, NSString *identifier) {
  [(NSButton *)Control(view, identifier) performClick:nil];
}
static BOOL Command(SMBrowserEditAnnotation *view, SEL selector, NSTextView *editor = nil) {
  NSTextField *field = (NSTextField *)Control(view, @"browser-edit-comment");
  return [field.delegate control:field textView:editor doCommandBySelector:selector];
}
static NSView *Host(SMAnnotationBrowserProbe **outBrowser, NSSize size = NSMakeSize(800,600)) {
  NSView *host = [[NSView alloc] initWithFrame:NSMakeRect(0,0,size.width,size.height)];
  host.wantsLayer = YES;
  host.clipsToBounds = YES;
  SMAnnotationBrowserProbe *browser = [[SMAnnotationBrowserProbe alloc] initWithFrame:host.bounds];
  [host addSubview:browser];
  *outBrowser = browser;
  return host;
}
static void Within(NSRect inner, NSRect outer) {
  CHECK(!NSIsEmptyRect(inner));
  CHECK(NSMinX(inner) >= NSMinX(outer) - .01 && NSMinY(inner) >= NSMinY(outer) - .01);
  CHECK(NSMaxX(inner) <= NSMaxX(outer) + .01 && NSMaxY(inner) <= NSMaxY(outer) + .01);
}

static void GeometryAndClipping() {
  SMAnnotationBrowserProbe *browser;
  NSView *host = Host(&browser);
  SMBrowserEditAnnotation *view = [[SMBrowserEditAnnotation alloc] initWithFrame:NSZeroRect];
  CHECK(!view.active && view.hidden && NSIsEmptyRect(view.targetRect));
  CHECK(view.isFlipped && !view.isOpaque);
  for (NSValue *value in @[[NSValue valueWithRect:NSMakeRect(.01,.01,.08,.05)],
                           [NSValue valueWithRect:NSMakeRect(.89,.01,.1,.05)],
                           [NSValue valueWithRect:NSMakeRect(.89,.90,.1,.09)],
                           [NSValue valueWithRect:NSMakeRect(.01,.9,.08,.09)],
                           [NSValue valueWithRect:NSMakeRect(.4,.45,.2,.1)]]) {
    CHECK([view showAboveBrowser:browser target:value.rectValue onSubmit:^(NSString *) {}
        onCancel:nil onReselect:nil]);
    CHECK(view.active && !view.hidden && view.superview == host);
    CHECK(host.subviews.lastObject == view && browser.detachments == 0);
    Within(view.cardRect, NSInsetRect(view.bounds,8,8));
    Within(view.targetRect, view.bounds);
    // When there is room, the card should not cover the selected element.
    CHECK(!NSIntersectsRect(view.targetRect, view.cardRect));
  }
  browser.frame = NSMakeRect(-150,-40,1000,680);
  CHECK([view showAboveBrowser:browser target:NSMakeRect(0,.1,.5,.2)
      onSubmit:^(NSString *) {} onCancel:nil onReselect:nil]);
  NSRect visible = NSIntersectionRect(view.bounds, [view convertRect:host.bounds fromView:host]);
  Within(view.cardRect, NSInsetRect(visible,8,8));
  Within(view.targetRect, visible);
  CHECK(NSMinX(view.cardRect) >= 158);
  CHECK(NSMinX(view.targetRect) == 150);
  [host addSubview:browser positioned:NSWindowAbove relativeTo:view];
  int detachments = browser.detachments;
  CHECK([view showAboveBrowser:browser target:NSMakeRect(.3,.3,.2,.2)
      onSubmit:^(NSString *) {} onCancel:nil onReselect:nil]);
  CHECK(host.subviews.lastObject == view && browser.detachments == detachments);

  for (NSNumber *width in @[@160,@180,@240,@320]) {
    host.frame = NSMakeRect(0,0,width.doubleValue,220);
    browser.frame = host.bounds;
    CHECK([view showAboveBrowser:browser target:NSMakeRect(.2,.7,.3,.15)
        onSubmit:^(NSString *) {} onCancel:nil onReselect:nil]);
    Within(view.cardRect, NSInsetRect(view.bounds,8,8));
    for (NSView *control in view.subviews) Within(control.frame,view.cardRect);
    CHECK(!NSIntersectsRect(Control(view,@"browser-edit-submit").frame,
        Control(view,@"browser-edit-reselect").frame));
  }
}

static void InvalidSelections() {
  SMAnnotationBrowserProbe *browser;
  NSView *host = Host(&browser);
  SMBrowserEditAnnotation *view = [[SMBrowserEditAnnotation alloc] initWithFrame:NSZeroRect];
  const double nan = std::numeric_limits<double>::quiet_NaN();
  const double inf = std::numeric_limits<double>::infinity();
  const NSRect invalid[] = {NSMakeRect(nan,0,.1,.1), NSMakeRect(0,inf,.1,.1),
      NSMakeRect(0,0,nan,.1), NSMakeRect(0,0,.1,inf), NSMakeRect(-.1,0,.1,.1),
      NSMakeRect(0,-.1,.1,.1), NSMakeRect(0,0,0,.1), NSMakeRect(0,0,.1,-.1),
      NSMakeRect(.9,0,.2,.1), NSMakeRect(0,.9,.1,.2), NSMakeRect(1,0,.1,.1)};
  for (auto rect : invalid) {
    CHECK(![view showAboveBrowser:browser target:rect onSubmit:^(NSString *) {}
        onCancel:nil onReselect:nil]);
    CHECK(!view.active && view.hidden);
  }
  CHECK(![view showAboveBrowser:browser target:NSMakeRect(.1,.1,.2,.2)
      onSubmit:nil onCancel:nil onReselect:nil]);
  browser.frame = NSMakeRect(-200,0,1000,600);
  CHECK(![view showAboveBrowser:browser target:NSMakeRect(0,0,.1,.1)
      onSubmit:^(NSString *) {} onCancel:nil onReselect:nil]);
  host.frame = NSMakeRect(0,0,120,80);
  browser.frame = host.bounds;
  CHECK(![view showAboveBrowser:browser target:NSMakeRect(0,0,1,1)
      onSubmit:^(NSString *) {} onCancel:nil onReselect:nil]);
  [browser removeFromSuperview];
  CHECK(![view showAboveBrowser:browser target:NSMakeRect(0,0,1,1)
      onSubmit:^(NSString *) {} onCancel:nil onReselect:nil]);
}

static void SubmissionAndKeyboard() {
  SMAnnotationBrowserProbe *browser;
  NSView *host = Host(&browser);
  SMBrowserEditAnnotation *view = [[SMBrowserEditAnnotation alloc] initWithFrame:NSZeroRect];
  __block int submitted = 0, cancelled = 0, reselected = 0;
  __block NSString *comment = nil;
  void (^open)(void) = ^{
    CHECK([view showAboveBrowser:browser target:NSMakeRect(.3,.4,.3,.1)
        onSubmit:^(NSString *text) { ++submitted; comment = text; CHECK(!view.active); }
        onCancel:^{ ++cancelled; CHECK(!view.active); }
        onReselect:^{ ++reselected; CHECK(!view.active); }]);
  };
  open();
  NSTextField *field = (NSTextField *)Control(view,@"browser-edit-comment");
  NSButton *add = (NSButton *)Control(view,@"browser-edit-submit");
  CHECK(!add.enabled && [field.placeholderAttributedString.string isEqualToString:@"Add a comment…"]);
  CHECK([field.accessibilityLabel isEqualToString:@"Comment on selected browser element"]);
  EnterText(view,@" \n\t ");
  CHECK(!add.enabled);
  CHECK(Command(view,@selector(insertNewline:)));
  CHECK(view.active && submitted == 0);
  EnterText(view,@"  Make this heading smaller.  ");
  CHECK(add.enabled);
  CHECK(!Command(view,@selector(insertTab:)));
  SMAnnotationMarkedText *ime = [SMAnnotationMarkedText new];
  CHECK(!Command(view,@selector(insertNewline:),ime));
  CHECK(submitted == 0 && view.active);
  CHECK(Command(view,@selector(insertNewline:)));
  CHECK(submitted == 1 && [comment isEqualToString:@"Make this heading smaller."]);
  CHECK(!view.active && view.hidden && field.stringValue.length == 0);
  Click(view,@"browser-edit-submit");
  CHECK(submitted == 1 && cancelled == 0 && reselected == 0);
  open();
  EnterText(view,[@"a" stringByPaddingToLength:4500 withString:@"a" startingAtIndex:0]);
  CHECK(field.stringValue.length == 4000);
  Click(view,@"browser-edit-submit");
  CHECK(submitted == 2 && comment.length == 4000);
  open();
  NSString *unicode = [[@"a" stringByPaddingToLength:3999 withString:@"a" startingAtIndex:0]
      stringByAppendingString:@"🦊hello"];
  EnterText(view,unicode);
  CHECK(field.stringValue.length == 3999);
  CHECK([field.stringValue dataUsingEncoding:NSUTF8StringEncoding] != nil);
  CHECK(Command(view,@selector(cancelOperation:)));
  CHECK(cancelled == 1 && submitted == 2);
  open();
  Click(view,@"browser-edit-reselect");
  CHECK(reselected == 1 && cancelled == 1 && !view.active);
  open();
  NSEvent *escape = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint
      modifierFlags:0 timestamp:0 windowNumber:0 context:nil characters:@"\x1b"
      charactersIgnoringModifiers:@"\x1b" isARepeat:NO keyCode:53];
  CHECK([view performKeyEquivalent:escape]);
  CHECK(cancelled == 2 && !view.active);
  open();
  Click(view,@"browser-edit-cancel");
  CHECK(cancelled == 3);
  CHECK(host.subviews.count == 2);
}

static void InputAndLifetime() {
  SMAnnotationBrowserProbe *browser;
  NSView *host = Host(&browser);
  SMBrowserEditAnnotation *view = [[SMBrowserEditAnnotation alloc] initWithFrame:NSZeroRect];
  __block int calls = 0;
  __weak NSObject *weakToken;
  @autoreleasepool {
    NSObject *token = [NSObject new];
    weakToken = token;
    CHECK([view showAboveBrowser:browser target:NSMakeRect(.2,.3,.5,.2)
        onSubmit:^(NSString *) { (void)[token description]; ++calls; }
        onCancel:^{ (void)[token description]; ++calls; }
        onReselect:^{ (void)[token description]; ++calls; }]);
  }
  CHECK(weakToken != nil);
  // A point outside the card hits the overlay rather than CEF.
  CHECK([host hitTest:NSMakePoint(20,20)] == view);
  CGEventRef scroll = CGEventCreateScrollWheelEvent(nullptr, kCGScrollEventUnitPixel, 1, 5);
  [view scrollWheel:[NSEvent eventWithCGEvent:scroll]];
  CFRelease(scroll);
  CHECK(browser.scrollEvents == 0 && browser.detachments == 0);
  [view clear];
  CHECK(weakToken == nil && calls == 0 && view.hidden && !view.active);
  CHECK([host hitTest:NSMakePoint(20,20)] == browser);
  CHECK(NSIsEmptyRect(view.targetRect) && NSIsEmptyRect(view.cardRect));
  [view clear];
  CHECK(calls == 0);
  CHECK([view showAboveBrowser:browser target:NSMakeRect(.2,.3,.5,.2)
      onSubmit:^(NSString *) { ++calls; } onCancel:^{ ++calls; } onReselect:nil]);
  view.frame = NSMakeRect(0,0,700,600);
  CHECK(!view.active && calls == 1);
  view.frame = NSMakeRect(0,0,600,600);
  CHECK(calls == 1);
}

static void FocusAndTransfer() {
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,800,600)
      styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  window.releasedWhenClosed = NO;
  SMAnnotationBrowserProbe *browser;
  NSView *host = Host(&browser);
  [window.contentView addSubview:host];
  SMBrowserEditAnnotation *view = [[SMBrowserEditAnnotation alloc] initWithFrame:NSZeroRect];
  __block int calls = 0;
  CHECK([view showAboveBrowser:browser target:NSMakeRect(.2,.3,.5,.2)
      onSubmit:^(NSString *) { ++calls; } onCancel:^{ ++calls; } onReselect:nil]);
  NSTextField *field = (NSTextField *)Control(view,@"browser-edit-comment");
  CHECK(field.currentEditor != nil && window.firstResponder == field.currentEditor);
  // Use the actual AppKit field editor, not just the overlay key handler.
  [field.currentEditor doCommandBySelector:@selector(cancelOperation:)];
  CHECK(!view.active && view.hidden && calls == 1);
  CHECK([view showAboveBrowser:browser target:NSMakeRect(.2,.3,.5,.2)
      onSubmit:^(NSString *) { ++calls; } onCancel:^{ ++calls; } onReselect:nil]);
  [host removeFromSuperview];
  CHECK(!view.active && view.hidden && calls == 2);
  [window close];
}

int main() {
  @autoreleasepool {
    [NSApplication sharedApplication];
    GeometryAndClipping();
    InvalidSelections();
    SubmissionAndKeyboard();
    InputAndLifetime();
    FocusAndTransfer();
    std::puts("Browser edit annotation: 5 AppKit checks passed");
  }
  return 0;
}
