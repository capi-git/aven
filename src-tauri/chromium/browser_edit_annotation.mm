#import "browser_edit_annotation.h"
#include <algorithm>
#include <cmath>

namespace {
constexpr NSUInteger kCommentLimit = 4000;
NSColor *SkyBlue() {
  return [NSColor colorWithSRGBRed:0.40 green:0.73 blue:0.98 alpha:1];
}
NSString *BoundedComment(NSString *text) {
  if (text.length <= kCommentLimit) return text;
  NSUInteger end = kCommentLimit;
  const NSRange character = [text rangeOfComposedCharacterSequenceAtIndex:end - 1];
  if (NSMaxRange(character) > end) end = character.location;
  return [text substringToIndex:end];
}
NSString *TrimmedComment(NSString *text) {
  return [BoundedComment(text ?: @"") stringByTrimmingCharactersInSet:
      NSCharacterSet.whitespaceAndNewlineCharacterSet];
}
BOOL ValidTarget(NSRect rect) {
  return std::isfinite(rect.origin.x) && std::isfinite(rect.origin.y) &&
      std::isfinite(rect.size.width) && std::isfinite(rect.size.height) &&
      rect.origin.x >= 0 && rect.origin.y >= 0 && rect.size.width > 0 &&
      rect.size.height > 0 && NSMaxX(rect) <= 1 + 1e-6 && NSMaxY(rect) <= 1 + 1e-6;
}
// The browser may extend underneath a clipping host when a sidebar is visible.
// Clamp both the selected outline and comment card to every ancestor's bounds.
NSRect VisibleArea(NSView *view) {
  NSRect area = view.bounds;
  for (NSView *ancestor = view.superview; ancestor; ancestor = ancestor.superview)
    area = NSIntersectionRect(area, [view convertRect:ancestor.bounds fromView:ancestor]);
  return area;
}
}

@interface SMAnnotationButton : NSButton
@property(nonatomic) BOOL primary;
@property(nonatomic) BOOL closeButton;
@end
@implementation SMAnnotationButton
- (BOOL)isFlipped { return YES; }
- (void)drawRect:(NSRect)dirtyRect {
  const BOOL highlighted = self.highlighted;
  NSRect box = NSInsetRect(self.bounds, 1, 1);
  if (self.primary || highlighted) {
    NSColor *fill = self.primary ? (self.enabled ? SkyBlue() :
        [NSColor colorWithWhite:.35 alpha:.5]) : [NSColor colorWithWhite:1 alpha:.1];
    if (highlighted && self.enabled) fill = [fill blendedColorWithFraction:.14 ofColor:NSColor.whiteColor];
    [fill setFill];
    [[NSBezierPath bezierPathWithRoundedRect:box xRadius:10 yRadius:10] fill];
  }
  NSColor *ink = self.primary ? (self.enabled ?
      [NSColor colorWithSRGBRed:.025 green:.08 blue:.13 alpha:1] :
      [NSColor colorWithWhite:.8 alpha:.6]) : [NSColor colorWithWhite:.84 alpha:1];
  if (self.closeButton) {
    [ink setStroke];
    NSBezierPath *cross = [NSBezierPath bezierPath];
    const CGFloat x = NSMidX(box), y = NSMidY(box);
    [cross moveToPoint:NSMakePoint(x-3.5,y-3.5)];
    [cross lineToPoint:NSMakePoint(x+3.5,y+3.5)];
    [cross moveToPoint:NSMakePoint(x+3.5,y-3.5)];
    [cross lineToPoint:NSMakePoint(x-3.5,y+3.5)];
    cross.lineWidth = 1.4;
    cross.lineCapStyle = NSLineCapStyleRound;
    [cross stroke];
  } else {
    NSDictionary *style = @{NSFontAttributeName: [NSFont systemFontOfSize:11.5
        weight:self.primary ? NSFontWeightSemibold : NSFontWeightRegular],
        NSForegroundColorAttributeName:ink};
    NSSize size = [self.title sizeWithAttributes:style];
    [self.title drawAtPoint:NSMakePoint(NSMidX(box)-size.width/2,
        NSMidY(box)-size.height/2) withAttributes:style];
  }
  if (self.window.firstResponder == self) {
    [SkyBlue() setStroke];
    NSBezierPath *focus = [NSBezierPath bezierPathWithRoundedRect:box xRadius:10 yRadius:10];
    focus.lineWidth = 1.5;
    [focus stroke];
  }
}
@end

@interface SMBrowserEditAnnotation () <NSTextFieldDelegate>
@end
@implementation SMBrowserEditAnnotation {
  BOOL _active;
  NSRect _targetRect;
  NSRect _cardRect;
  NSTextField *_commentField;
  SMAnnotationButton *_submitButton;
  SMAnnotationButton *_cancelButton;
  SMAnnotationButton *_reselectButton;
  __weak NSView *_browser;
  __weak NSResponder *_previousResponder;
  void (^_submit)(NSString *);
  void (^_cancel)(void);
  void (^_reselect)(void);
}
@synthesize active = _active, targetRect = _targetRect, cardRect = _cardRect;

- (instancetype)initWithFrame:(NSRect)frame {
  if (!(self = [super initWithFrame:frame])) return nil;
  self.wantsLayer = YES;
  self.hidden = YES;
  self.accessibilityElement = NO;
  self.accessibilityLabel = @"Browser element comment";
  _commentField = [[NSTextField alloc] initWithFrame:NSZeroRect];
  _commentField.identifier = @"browser-edit-comment";
  _commentField.bordered = NO;
  _commentField.bezeled = NO;
  _commentField.drawsBackground = NO;
  _commentField.font = [NSFont systemFontOfSize:13];
  _commentField.textColor = [NSColor colorWithWhite:.97 alpha:1];
  _commentField.focusRingType = NSFocusRingTypeNone;
  _commentField.usesSingleLineMode = YES;
  ((NSTextFieldCell *)_commentField.cell).scrollable = YES;
  _commentField.lineBreakMode = NSLineBreakByClipping;
  _commentField.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  _commentField.placeholderAttributedString = [[NSAttributedString alloc]
      initWithString:@"Add a comment…" attributes:@{NSForegroundColorAttributeName:
      [NSColor colorWithWhite:.65 alpha:1]}];
  _commentField.accessibilityLabel = @"Comment on selected browser element";
  _commentField.delegate = self;
  _commentField.target = self;
  _commentField.action = @selector(submitComment:);
  [self addSubview:_commentField];
  _submitButton = [self buttonWithTitle:@"Add to chat" identifier:@"browser-edit-submit"
      action:@selector(submitComment:)];
  _submitButton.primary = YES;
  _submitButton.enabled = NO;
  _cancelButton = [self buttonWithTitle:@"Cancel annotation" identifier:@"browser-edit-cancel"
      action:@selector(cancelOperation:)];
  _cancelButton.closeButton = YES;
  _cancelButton.toolTip = @"Cancel (Esc)";
  _reselectButton = [self buttonWithTitle:@"Change element" identifier:@"browser-edit-reselect"
      action:@selector(reselectElement:)];
  _reselectButton.toolTip = @"Choose a different element";
  _commentField.nextKeyView = _reselectButton;
  _reselectButton.nextKeyView = _submitButton;
  _submitButton.nextKeyView = _cancelButton;
  _cancelButton.nextKeyView = _commentField;
  return self;
}
- (SMAnnotationButton *)buttonWithTitle:(NSString *)title identifier:(NSString *)identifier
                               action:(SEL)action {
  SMAnnotationButton *button = [[SMAnnotationButton alloc] initWithFrame:NSZeroRect];
  button.title = title;
  button.identifier = identifier;
  button.accessibilityLabel = title;
  button.bordered = NO;
  button.buttonType = NSButtonTypeMomentaryPushIn;
  button.focusRingType = NSFocusRingTypeNone;
  button.target = self;
  button.action = action;
  [self addSubview:button];
  return button;
}
- (BOOL)isFlipped { return YES; }
- (BOOL)isOpaque { return NO; }
- (BOOL)acceptsFirstResponder { return _active; }
- (NSView *)hitTest:(NSPoint)point {
  return _active && !self.hidden ? [super hitTest:point] : nil;
}
// An annotation refers to the captured element, so neither scrolling nor an
// accidental page click can navigate or move that element under the card.
- (void)mouseDown:(NSEvent *)event { [self.window makeFirstResponder:_commentField]; }
- (void)mouseUp:(NSEvent *)event {}
- (void)mouseDragged:(NSEvent *)event {}
- (void)rightMouseDown:(NSEvent *)event {}
- (void)rightMouseUp:(NSEvent *)event {}
- (void)otherMouseDown:(NSEvent *)event {}
- (void)otherMouseUp:(NSEvent *)event {}
- (void)scrollWheel:(NSEvent *)event {}
- (void)magnifyWithEvent:(NSEvent *)event {}
- (void)rotateWithEvent:(NSEvent *)event {}
- (void)swipeWithEvent:(NSEvent *)event {}
- (void)keyDown:(NSEvent *)event {
  if (event.keyCode == 53) [self cancelOperation:self];
  else if (event.keyCode == 36 || event.keyCode == 76) [self submitComment:self];
  else [super keyDown:event];
}
- (BOOL)performKeyEquivalent:(NSEvent *)event {
  if (_active && event.keyCode == 53) { [self cancelOperation:self]; return YES; }
  return [super performKeyEquivalent:event];
}
- (void)setFrame:(NSRect)frame {
  const BOOL changed = !NSEqualRects(frame, self.frame);
  [super setFrame:frame];
  if (_active && changed) [self cancelOperation:self];
}
- (void)setFrameOrigin:(NSPoint)origin {
  const BOOL changed = !NSEqualPoints(origin, self.frame.origin);
  [super setFrameOrigin:origin];
  if (_active && changed) [self cancelOperation:self];
}
- (void)setFrameSize:(NSSize)size {
  const BOOL changed = !NSEqualSizes(size, self.frame.size);
  [super setFrameSize:size];
  if (_active && changed) [self cancelOperation:self];
}
- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  if (_active) [self cancelOperation:self];
}
- (BOOL)showAboveBrowser:(NSView *)browser target:(NSRect)target
               onSubmit:(void (^)(NSString *))submit onCancel:(void (^)(void))cancel
             onReselect:(void (^)(void))reselect {
  [self clear];
  if (!browser.superview || !ValidTarget(target) || !submit) return NO;
  _browser = browser;
  NSView *clip = browser.superview;
  if (self.superview != clip) {
    [self removeFromSuperview];
    [clip addSubview:self positioned:NSWindowAbove relativeTo:browser];
  } else if ([clip.subviews indexOfObjectIdenticalTo:self] <
             [clip.subviews indexOfObjectIdenticalTo:browser]) {
    [clip addSubview:self positioned:NSWindowAbove relativeTo:browser];
  }
  self.frame = browser.frame;
  self.autoresizingMask = browser.autoresizingMask;
  NSRect visible = VisibleArea(self);
  NSRect area = NSInsetRect(visible, 8, 8);
  if (area.size.width < 144 || area.size.height < 92) { [self clear]; return NO; }
  target.size.width = std::min(target.size.width, 1 - target.origin.x);
  target.size.height = std::min(target.size.height, 1 - target.origin.y);
  _targetRect = NSIntersectionRect(visible, NSMakeRect(
      target.origin.x * self.bounds.size.width, target.origin.y * self.bounds.size.height,
      target.size.width * self.bounds.size.width, target.size.height * self.bounds.size.height));
  if (NSIsEmptyRect(_targetRect)) { [self clear]; return NO; }
  const CGFloat width = std::min<CGFloat>(352, area.size.width), height = 92;
  CGFloat x = NSMidX(_targetRect) - width/2;
  x = std::clamp(x, NSMinX(area), NSMaxX(area)-width);
  // Prefer above the selection. Below, then a clamped card, cover edge cases.
  CGFloat y = NSMinY(_targetRect) - height - 12;
  if (y < NSMinY(area)) y = NSMaxY(_targetRect) + 12;
  y = std::clamp(y, NSMinY(area), NSMaxY(area)-height);
  _cardRect = NSMakeRect(x,y,width,height);
  _commentField.frame = NSMakeRect(x+14,y+16,width-53,24);
  _cancelButton.frame = NSMakeRect(x+width-32,y+12,24,24);
  _submitButton.frame = NSMakeRect(x+width-105,y+52,93,28);
  const BOOL compact = width < 248;
  _reselectButton.title = compact ? @"↖" : @"Change element";
  _reselectButton.frame = NSMakeRect(x+9,y+52,compact ? 28 : 110,28);
  _commentField.stringValue = @"";
  _submitButton.enabled = NO;
  _submit = [submit copy];
  _cancel = [cancel copy];
  _reselect = [reselect copy];
  _previousResponder = self.window.firstResponder;
  _active = YES;
  self.hidden = NO;
  self.needsDisplay = YES;
  [self.window makeFirstResponder:_commentField];
  return YES;
}
- (void)clear {
  NSWindow *window = self.window;
  NSResponder *responder = window.firstResponder;
  const BOOL ownsFocus = responder == _commentField.currentEditor ||
      ([responder isKindOfClass:NSView.class] && [(NSView *)responder isDescendantOf:self]);
  _active = NO;
  _submit = nil;
  _cancel = nil;
  _reselect = nil;
  _targetRect = _cardRect = NSZeroRect;
  if (ownsFocus) {
    NSResponder *restore = _previousResponder;
    if ([restore isKindOfClass:NSView.class] && [(NSView *)restore window] != window)
      restore = nil;
    [window makeFirstResponder:restore ?: _browser];
  }
  _previousResponder = nil;
  _browser = nil;
  _commentField.stringValue = @"";
  _submitButton.enabled = NO;
  self.hidden = YES;
  self.needsDisplay = YES;
}
- (void)controlTextDidChange:(NSNotification *)notification {
  if (!_active || notification.object != _commentField) return;
  NSTextView *editor = (NSTextView *)_commentField.currentEditor;
  // Do not interrupt marked IME composition; the committed value and submit
  // path still enforce the same length bound.
  if (!editor.hasMarkedText) {
    NSString *bounded = BoundedComment(_commentField.stringValue);
    if (![bounded isEqualToString:_commentField.stringValue]) {
      _commentField.stringValue = bounded;
      editor.selectedRange = NSMakeRange(bounded.length, 0);
    }
  }
  _submitButton.enabled = TrimmedComment(_commentField.stringValue).length > 0;
  _submitButton.needsDisplay = YES;
}
- (BOOL)control:(NSControl *)control textView:(NSTextView *)textView
    doCommandBySelector:(SEL)command {
  if (control != _commentField || !_active) return NO;
  if (command == @selector(cancelOperation:)) { [self cancelOperation:self]; return YES; }
  if (command == @selector(insertNewline:) && !textView.hasMarkedText) {
    [self submitComment:self]; return YES;
  }
  return NO;
}
- (void)submitComment:(id)sender {
  if (!_active || [(NSTextView *)_commentField.currentEditor hasMarkedText]) return;
  NSString *comment = TrimmedComment(_commentField.stringValue);
  if (!comment.length) return;
  void (^submit)(NSString *) = _submit;
  [self clear];
  if (submit) submit(comment);
}
- (void)cancelOperation:(id)sender {
  if (!_active) return;
  void (^cancel)(void) = _cancel;
  [self clear];
  if (cancel) cancel();
}
- (void)reselectElement:(id)sender {
  if (!_active) return;
  void (^reselect)(void) = _reselect;
  [self clear];
  if (reselect) reselect();
}
- (void)drawRect:(NSRect)dirtyRect {
  if (!_active) return;
  NSRect visible = VisibleArea(self);
  [NSGraphicsContext saveGraphicsState];
  NSRectClip(visible);
  NSRect target = NSInsetRect(_targetRect, .75, .75);
  if (target.size.width > 0 && target.size.height > 0) {
    NSBezierPath *outline = [NSBezierPath bezierPathWithRoundedRect:target xRadius:2 yRadius:2];
    [[SkyBlue() colorWithAlphaComponent:.06] setFill];
    [outline fill];
    [SkyBlue() setStroke];
    outline.lineWidth = 1.5;
    [outline stroke];
    NSPoint pin = NSMakePoint(std::clamp(NSMidX(target), NSMinX(visible)+5, NSMaxX(visible)-5),
        std::clamp(NSMinY(target), NSMinY(visible)+5, NSMaxY(visible)-5));
    [SkyBlue() setFill];
    [[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(pin.x-4.5,pin.y-4.5,9,9)] fill];
  }
  NSBezierPath *card = [NSBezierPath bezierPathWithRoundedRect:_cardRect xRadius:18 yRadius:18];
  [NSGraphicsContext saveGraphicsState];
  NSShadow *shadow = [NSShadow new];
  shadow.shadowColor = [NSColor colorWithWhite:0 alpha:.28];
  shadow.shadowBlurRadius = 15;
  shadow.shadowOffset = NSMakeSize(0, -3);
  [shadow set];
  [[NSColor colorWithSRGBRed:.045 green:.065 blue:.085 alpha:.97] setFill];
  [card fill];
  [NSGraphicsContext restoreGraphicsState];
  NSGradient *sheen = [[NSGradient alloc] initWithStartingColor:
      [NSColor colorWithSRGBRed:.34 green:.53 blue:.66 alpha:.10]
      endingColor:[NSColor colorWithWhite:1 alpha:0]];
  [sheen drawInBezierPath:card angle:90];
  [NSGraphicsContext restoreGraphicsState];
}
@end
