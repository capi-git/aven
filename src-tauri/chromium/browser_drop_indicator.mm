#import "browser_drop_indicator.h"
#import <QuartzCore/QuartzCore.h>
#include <algorithm>
#include <cmath>

namespace {
const SMBrowserDropPalette kLegacyPalette = {
  {.72, .72, .72, 1}, {.5, .5, .5, .12}, {0, 0, 0, .35}
};
// The HTML preview's `--aven-radius-sm`, at 100%.
const SMBrowserDropShape kDefaultShape = {6, 1};
// TAB_SPRING in motionTokens.ts, as SwiftUI states springs: response in
// seconds and damping ratio.
struct Spring {
  double response;
  double damping;
};
constexpr Spring kMove = {.22, 1};
constexpr Spring kLift = {.18, 1};
constexpr Spring kFade = {.076, 1};
// TAB_PREVIEW_ENTER_SCALE.
constexpr double kEnterScale = .97;

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
bool ValidShape(const SMBrowserDropShape& shape) {
  return std::isfinite(shape.radius) && shape.radius >= 0 && shape.radius <= 64 &&
      std::isfinite(shape.zoom) && shape.zoom >= .5 && shape.zoom <= 2;
}
CGColorRef DropColor(const double *rgba) {
  return [NSColor colorWithSRGBRed:rgba[0] green:rgba[1] blue:rgba[2] alpha:rgba[3]].CGColor;
}
// Model changes land at once; only the springs below animate.
void Quietly(void (^change)(void)) {
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  change();
  [CATransaction commit];
}
CASpringAnimation *SpringFrom(NSString *key, Spring spring, id from, id to) {
  CASpringAnimation *animation = [CASpringAnimation animationWithKeyPath:key];
  const double omega = 2 * M_PI / spring.response;
  animation.mass = 1;
  animation.stiffness = omega * omega;
  animation.damping = 2 * spring.damping * omega;
  animation.fromValue = from;
  animation.toValue = to;
  animation.duration = animation.settlingDuration;
  return animation;
}
bool ReduceMotion() {
  return NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
}
}

@implementation SMBrowserDropIndicator {
  BOOL _active;
  NSRect _normalizedTarget;
  NSString *_outcome;
  NSString *_moveLabel;
  NSString *_title;
  NSString *_edge;
  SMBrowserDropPalette _palette;
  SMBrowserDropShape _shape;
  CALayer *_root;
  // Fills the view; it fades and grows about the side the preview splits.
  CALayer *_preview;
  // The 0.5px outline outside the box, and the box with its wash and edge.
  CALayer *_halo;
  CALayer *_box;
  // Drawn, or fading out after the drag left.
  BOOL _shown;
  NSUInteger _fades;
}
@synthesize active = _active, normalizedTarget = _normalizedTarget;
@synthesize outcome = _outcome, moveLabel = _moveLabel, title = _title;

- (instancetype)initWithFrame:(NSRect)frame {
  if (!(self = [super initWithFrame:frame])) return nil;
  _palette = kLegacyPalette;
  _shape = kDefaultShape;
  _animates = YES;
  _root = [CALayer layer];
  // Top-left, as this view and the normalized targets.
  _root.geometryFlipped = YES;
  _preview = [CALayer layer];
  _halo = [CALayer layer];
  _box = [CALayer layer];
  _preview.opacity = 0;
  [_preview addSublayer:_halo];
  [_preview addSublayer:_box];
  [_root addSublayer:_preview];
  // Layer-hosting: these layers are this view's whole drawing.
  self.layer = _root;
  self.wantsLayer = YES;
  self.hidden = YES;
  self.accessibilityElement = NO;
  [self layOut:NO];
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
- (void)viewDidChangeBackingProperties {
  [super viewDidChangeBackingProperties];
  const CGFloat scale = self.window.backingScaleFactor ?: 2;
  Quietly(^{
    for (CALayer *layer in @[self->_root, self->_preview, self->_halo, self->_box])
      layer.contentsScale = scale;
  });
  [self layOut:NO];
}
- (void)setFrameSize:(NSSize)size {
  [super setFrameSize:size];
  [self layOut:NO];
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
  return [self updateTarget:target edge:edge kind:kind title:title palette:nullptr shape:nullptr];
}
- (BOOL)updateTarget:(NSRect)target edge:(NSString *)edge
               kind:(NSString *)kind title:(NSString *)title
            palette:(const SMBrowserDropPalette *)palette {
  return [self updateTarget:target edge:edge kind:kind title:title palette:palette shape:nullptr];
}
- (BOOL)updateTarget:(NSRect)target edge:(NSString *)edge
               kind:(NSString *)kind title:(NSString *)title
            palette:(const SMBrowserDropPalette *)palette
              shape:(const SMBrowserDropShape *)shape {
  const auto nextPalette = palette ? *palette : kLegacyPalette;
  if (!ValidPalette(nextPalette)) return NO;
  const auto nextShape = shape ? *shape : kDefaultShape;
  if (!ValidShape(nextShape)) return NO;
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
      [_title isEqualToString:cleanTitle] && SamePalette(_palette, nextPalette) &&
      _shape.radius == nextShape.radius && _shape.zoom == nextShape.zoom) return YES;
  // Fresh only when nothing of it is showing: coming back while it fades
  // out, it turns round from what is drawn.
  const float drawnOpacity = (_preview.presentationLayer ?: _preview).opacity;
  const BOOL fresh = !_shown || drawnOpacity <= .01;
  _normalizedTarget = target;
  _outcome = outcome;
  _moveLabel = moveLabel;
  _title = [cleanTitle copy];
  _edge = [edge copy];
  _palette = nextPalette;
  _shape = nextShape;
  _active = YES;
  _shown = YES;
  ++_fades;
  self.hidden = NO;
  self.needsDisplay = YES;
  [self present:fresh from:drawnOpacity];
  return YES;
}
- (void)clear {
  ++_fades;
  if (!_active && !_shown && self.hidden) return;
  _active = NO;
  _shown = NO;
  _normalizedTarget = NSZeroRect;
  _outcome = _moveLabel = _title = _edge = nil;
  for (CALayer *layer in @[_preview, _halo, _box]) [layer removeAllAnimations];
  Quietly(^{ self->_preview.opacity = 0; });
  self.hidden = YES;
  self.needsDisplay = YES;
}
- (void)fadeOut {
  if (!_active) return;
  if (!_shown || !_animates || ReduceMotion()) { [self clear]; return; }
  _active = NO;
  _normalizedTarget = NSZeroRect;
  _outcome = _moveLabel = _title = _edge = nil;
  const NSUInteger fade = ++_fades;
  const float from = (_preview.presentationLayer ?: _preview).opacity;
  __weak SMBrowserDropIndicator *weakSelf = self;
  [CATransaction begin];
  [CATransaction setCompletionBlock:^{
    SMBrowserDropIndicator *view = weakSelf;
    if (view && view->_fades == fade && !view->_active) [view clear];
  }];
  Quietly(^{ self->_preview.opacity = 0; });
  [_preview addAnimation:SpringFrom(@"opacity", kFade, @(from), @0) forKey:@"fade"];
  [CATransaction commit];
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
// One device pixel at least, as WebKit draws CSS hairlines.
- (CGFloat)hairline:(double)cssPixels {
  const CGFloat scale = self.window.backingScaleFactor ?: 2;
  return std::max<CGFloat>(1 / scale, cssPixels * _shape.zoom);
}
- (CGFloat)edgeWidth { return [self hairline:1]; }
- (CGFloat)outlineWidth { return [self hairline:.5]; }
- (CGFloat)cornerRadius {
  const NSRect box = self.targetRect;
  return std::max<CGFloat>(0, std::min<CGFloat>({_shape.radius * _shape.zoom,
      box.size.width / 2, box.size.height / 2}));
}
// The colours and edges, at once; then the box where it goes.
- (void)layOut:(BOOL)glide {
  const NSRect bounds = self.bounds;
  const NSRect box = self.targetRect;
  const CGFloat radius = self.cornerRadius;
  const CGFloat edge = self.edgeWidth;
  const CGFloat outline = self.outlineWidth;
  Quietly(^{
    self->_preview.frame = bounds;
    // The wash under the edge, as CSS paints a border box.
    self->_box.backgroundColor = DropColor(self->_palette.fill);
    self->_box.borderColor = DropColor(self->_palette.stroke);
    self->_box.borderWidth = edge;
    self->_box.cornerRadius = radius;
    self->_halo.borderColor = DropColor(self->_palette.halo);
    self->_halo.borderWidth = outline;
    self->_halo.cornerRadius = radius + outline;
  });
  if (!_active) return;
  [self move:_box to:box glide:glide];
  [self move:_halo to:NSInsetRect(box, -outline, -outline) glide:glide];
}
- (void)move:(CALayer *)layer to:(NSRect)rect glide:(BOOL)glide {
  CALayer *drawn = glide ? (layer.presentationLayer ?: layer) : layer;
  const CGPoint fromPosition = drawn.position;
  const CGRect fromBounds = drawn.bounds;
  const CGPoint position = CGPointMake(NSMidX(rect), NSMidY(rect));
  const CGRect size = CGRectMake(0, 0, rect.size.width, rect.size.height);
  Quietly(^{
    layer.bounds = size;
    layer.position = position;
  });
  if (!glide) {
    [layer removeAnimationForKey:@"glide-position"];
    [layer removeAnimationForKey:@"glide-bounds"];
    return;
  }
  [layer addAnimation:SpringFrom(@"position", kMove,
      [NSValue valueWithPoint:NSPointFromCGPoint(fromPosition)],
      [NSValue valueWithPoint:NSPointFromCGPoint(position)]) forKey:@"glide-position"];
  [layer addAnimation:SpringFrom(@"bounds", kMove,
      [NSValue valueWithRect:NSRectFromCGRect(fromBounds)],
      [NSValue valueWithRect:NSRectFromCGRect(size)]) forKey:@"glide-bounds"];
}
- (void)present:(BOOL)fresh from:(float)drawnOpacity {
  const BOOL animate = _animates && !ReduceMotion();
  [self layOut:!fresh && animate];
  const float previous = fresh ? 0 : drawnOpacity;
  Quietly(^{
    self->_preview.opacity = 1;
    if (fresh) self->_preview.transform = CATransform3DIdentity;
  });
  if (!animate) {
    [_preview removeAllAnimations];
    return;
  }
  [_preview addAnimation:SpringFrom(@"opacity", kFade, @(previous), @1) forKey:@"fade"];
  if (!fresh) return;
  // In from the side it splits, growing a little about that side. The side
  // is kept until it has grown, as the HTML preview keeps its pivot.
  const NSRect box = self.targetRect;
  const NSRect bounds = self.bounds;
  NSPoint pivot = NSMakePoint(NSMidX(box), NSMidY(box));
  if ([_edge isEqualToString:@"left"]) pivot.x = NSMinX(box);
  else if ([_edge isEqualToString:@"right"]) pivot.x = NSMaxX(box);
  else if ([_edge isEqualToString:@"up"]) pivot.y = NSMinY(box);
  else if ([_edge isEqualToString:@"down"]) pivot.y = NSMaxY(box);
  const CGFloat dx = pivot.x - NSMidX(bounds), dy = pivot.y - NSMidY(bounds);
  CATransform3D grown = CATransform3DMakeTranslation(dx, dy, 0);
  grown = CATransform3DScale(grown, kEnterScale, kEnterScale, 1);
  grown = CATransform3DTranslate(grown, -dx, -dy, 0);
  [_preview addAnimation:SpringFrom(@"transform", kLift,
      [NSValue valueWithCATransform3D:grown],
      [NSValue valueWithCATransform3D:CATransform3DIdentity]) forKey:@"grow"];
}
@end
