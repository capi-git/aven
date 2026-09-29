#import "browser_drop_indicator.h"
#include <algorithm>
#include <cmath>

namespace {
const SMBrowserDropPalette kLegacyPalette = {
  {.72, .72, .72, 1}, {.5, .5, .5, .12}, {0, 0, 0, .35}
};
bool ValidPalette(const SMBrowserDropPalette& palette) {
  for (const double *color : {palette.stroke, palette.fill, palette.halo})
    for (int i = 0; i < 4; ++i)
      if (!std::isfinite(color[i]) || color[i] < 0 || color[i] > 1) return false;
  return true;
}
bool SamePalette(const SMBrowserDropPalette& a, const SMBrowserDropPalette& b) {
  return std::equal(a.stroke, a.stroke + 4, b.stroke) &&
      std::equal(a.fill, a.fill + 4, b.fill) &&
      std::equal(a.halo, a.halo + 4, b.halo);
}
NSColor *DropColor(const double *rgba) {
  return [NSColor colorWithSRGBRed:rgba[0] green:rgba[1] blue:rgba[2] alpha:rgba[3]];
}
}

@implementation SMBrowserDropIndicator {
  BOOL _active;
  NSRect _normalizedTarget;
  NSString *_outcome;
  NSString *_moveLabel;
  NSString *_title;
  SMBrowserDropPalette _palette;
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
  return [self updateTarget:target edge:edge kind:kind title:title palette:nullptr];
}
- (BOOL)updateTarget:(NSRect)target edge:(NSString *)edge
               kind:(NSString *)kind title:(NSString *)title
            palette:(const SMBrowserDropPalette *)palette {
  const auto nextPalette = palette ? *palette : kLegacyPalette;
  if (!ValidPalette(nextPalette)) return NO;
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
      [_title isEqualToString:cleanTitle] && SamePalette(_palette, nextPalette)) return YES;
  _normalizedTarget = target;
  _outcome = outcome;
  _moveLabel = moveLabel;
  _title = [cleanTitle copy];
  _palette = nextPalette;
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
- (void)drawRect:(NSRect)dirtyRect {
  if (!_active) return;
  NSRect target = NSInsetRect(self.targetRect, 3, 3);
  if (target.size.width <= 0 || target.size.height <= 0) return;
  // Use the exact sRGB drop-region palette resolved by the workspace. The
  // contrasting halo keeps the destination visible over arbitrary websites.
  NSBezierPath *path = [NSBezierPath bezierPathWithRoundedRect:target xRadius:8 yRadius:8];
  [DropColor(_palette.fill) setFill];
  [path fill];
  [DropColor(_palette.halo) setStroke];
  path.lineWidth = 2;
  [path stroke];
  [DropColor(_palette.stroke) setStroke];
  path.lineWidth = 1;
  [path stroke];
}
@end
