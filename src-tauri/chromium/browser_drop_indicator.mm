#import "browser_drop_indicator.h"
#include <algorithm>
#include <cmath>

@implementation SMBrowserDropIndicator {
  BOOL _active;
  NSRect _normalizedTarget;
  NSString *_outcome;
  NSString *_moveLabel;
  NSString *_title;
}
@synthesize active = _active, normalizedTarget = _normalizedTarget;
@synthesize outcome = _outcome, moveLabel = _moveLabel, title = _title;

- (instancetype)initWithFrame:(NSRect)frame {
  if (!(self = [super initWithFrame:frame])) return nil;
  self.wantsLayer = YES;
  self.hidden = YES;
  self.accessibilityElement = NO;
  return self;
}
- (BOOL)isFlipped { return YES; }
- (BOOL)isOpaque { return NO; }
- (BOOL)acceptsFirstResponder { return NO; }
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  // A drop target belongs to the source window's current gesture.
  [self clear];
}
- (void)placeAboveBrowser:(NSView *)browser frame:(NSRect)frame {
  NSView *clip = browser.superview;
  if (!clip) { [self clear]; [self removeFromSuperview]; return; }
  if (self.superview != clip) {
    [self clear];
    [self removeFromSuperview];
    [clip addSubview:self positioned:NSWindowAbove relativeTo:browser];
  } else {
    const auto siblings = clip.subviews;
    if ([siblings indexOfObjectIdenticalTo:self] <
        [siblings indexOfObjectIdenticalTo:browser])
      [clip addSubview:self positioned:NSWindowAbove relativeTo:browser];
  }
  self.autoresizingMask = browser.autoresizingMask;
  if (!NSEqualRects(self.frame, frame)) {
    self.frame = frame;
    self.needsDisplay = YES;
  }
}
- (BOOL)updateTarget:(NSRect)target edge:(NSString *)edge
               kind:(NSString *)kind title:(NSString *)title {
  const double x = target.origin.x, y = target.origin.y;
  const double width = target.size.width, height = target.size.height;
  NSString *outcome = nil;
  if ([edge isEqualToString:@"tab"]) outcome = @"Join group";
  else if ([edge isEqualToString:@"left"]) outcome = @"Split left";
  else if ([edge isEqualToString:@"right"]) outcome = @"Split right";
  else if ([edge isEqualToString:@"up"]) outcome = @"Split above";
  else if ([edge isEqualToString:@"down"]) outcome = @"Split below";
  NSString *moveLabel = [kind isEqualToString:@"tab"] ? @"Move tab" :
      [kind isEqualToString:@"group"] ? @"Move group" : nil;
  if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(width) ||
      !std::isfinite(height) || x < 0 || y < 0 || width <= 0 || height <= 0 ||
      x > 1 || y > 1 || width > 1 || height > 1 || x + width > 1 + 1e-6 ||
      y + height > 1 + 1e-6 || !outcome || !moveLabel || !title || title.length > 160)
    return NO;
  // Intersection/division in the frontend can put an exact outer edge a few
  // floating-point ulps beyond one; never draw outside the viewport.
  target.size.width = std::min(width, 1 - x);
  target.size.height = std::min(height, 1 - y);
  if (target.size.width <= 0 || target.size.height <= 0) return NO;
  // Render reference text on one bounded line; control characters never turn
  // the native indicator into an arbitrary multiline panel.
  NSString *cleanTitle = [[title componentsSeparatedByCharactersInSet:
      NSCharacterSet.controlCharacterSet] componentsJoinedByString:@" "];
  if (_active && NSEqualRects(_normalizedTarget, target) &&
      [_outcome isEqualToString:outcome] && [_moveLabel isEqualToString:moveLabel] &&
      [_title isEqualToString:cleanTitle]) return YES;
  _normalizedTarget = target;
  _outcome = outcome;
  _moveLabel = moveLabel;
  _title = [cleanTitle copy];
  _active = YES;
  self.hidden = NO;
  self.needsDisplay = YES;
  return YES;
}
- (void)clear {
  if (!_active && self.hidden) return;
  _active = NO;
  _normalizedTarget = NSZeroRect;
  _outcome = _moveLabel = _title = nil;
  self.hidden = YES;
  self.needsDisplay = YES;
}
- (NSRect)targetRect {
  if (!_active) return NSZeroRect;
  const NSRect bounds = self.bounds;
  return NSMakeRect(bounds.origin.x + _normalizedTarget.origin.x * bounds.size.width,
      bounds.origin.y + _normalizedTarget.origin.y * bounds.size.height,
      _normalizedTarget.size.width * bounds.size.width,
      _normalizedTarget.size.height * bounds.size.height);
}
- (NSRect)labelRect {
  NSRect area = NSIntersectionRect(self.targetRect, self.bounds);
  if (self.superview)
    area = NSIntersectionRect(area,
        [self convertRect:self.superview.bounds fromView:self.superview]);
  const CGFloat width = std::min<CGFloat>(220, area.size.width - 12);
  const CGFloat height = std::min<CGFloat>(_title.length ? 65 : 49, area.size.height - 12);
  if (width < 36 || height < 24) return NSZeroRect;
  return NSMakeRect(NSMidX(area) - width / 2, NSMidY(area) - height / 2, width, height);
}
- (void)drawRect:(NSRect)dirtyRect {
  if (!_active) return;
  NSRect target = NSInsetRect(self.targetRect, 3, 3);
  if (target.size.width <= 0 || target.size.height <= 0) return;
  NSColor *accent = [NSColor colorWithSRGBRed:94.0/255 green:217.0/255 blue:208.0/255 alpha:1];
  NSBezierPath *path = [NSBezierPath bezierPathWithRoundedRect:target xRadius:8 yRadius:8];
  [[accent colorWithAlphaComponent:.14] setFill];
  [path fill];
  // The dark outer stroke is visible on white websites; the pale inner stroke
  // is visible on dark ones. Neither depends on the website's own palette.
  [[NSColor colorWithSRGBRed:.03 green:.08 blue:.09 alpha:.95] setStroke];
  path.lineWidth = 5;
  [path stroke];
  [[NSColor colorWithSRGBRed:.87 green:1 blue:.98 alpha:1] setStroke];
  path.lineWidth = 3;
  [path stroke];
  [accent setStroke];
  path.lineWidth = 1.5;
  [path stroke];

  NSRect label = self.labelRect;
  if (NSIsEmptyRect(label)) return;
  NSBezierPath *card = [NSBezierPath bezierPathWithRoundedRect:label xRadius:8 yRadius:8];
  [[NSColor colorWithSRGBRed:.055 green:.105 blue:.115 alpha:1] setFill];
  [card fill];
  [accent setStroke];
  card.lineWidth = 1;
  [card stroke];
  NSMutableParagraphStyle *paragraph = [NSMutableParagraphStyle new];
  paragraph.alignment = NSTextAlignmentCenter;
  paragraph.lineBreakMode = NSLineBreakByTruncatingTail;
  const BOOL expanded = label.size.height >= (_title.length ? 61 : 45);
  const CGFloat textX = label.origin.x + 8, textWidth = label.size.width - 16;
  CGFloat textY = expanded ? label.origin.y + 7 : NSMidY(label) - 8;
  if (expanded && _title.length) {
    [_title drawInRect:NSMakeRect(textX, textY, textWidth, 14) withAttributes:@{
      NSFontAttributeName: [NSFont systemFontOfSize:10.5],
      NSForegroundColorAttributeName: [NSColor colorWithSRGBRed:.77 green:.86 blue:.86 alpha:1],
      NSParagraphStyleAttributeName: paragraph}];
    textY += 16;
  }
  [_outcome drawInRect:NSMakeRect(textX, textY, textWidth, 16) withAttributes:@{
    NSFontAttributeName: [NSFont systemFontOfSize:12 weight:NSFontWeightSemibold],
    NSForegroundColorAttributeName: NSColor.whiteColor,
    NSParagraphStyleAttributeName: paragraph}];
  if (expanded) [_moveLabel drawInRect:NSMakeRect(textX, textY + 18, textWidth, 14) withAttributes:@{
    NSFontAttributeName: [NSFont systemFontOfSize:10.5],
    NSForegroundColorAttributeName: [NSColor colorWithSRGBRed:.7 green:.83 blue:.83 alpha:1],
    NSParagraphStyleAttributeName: paragraph}];
}
@end
