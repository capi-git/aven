#import "browser_agent_marker.h"
#import <QuartzCore/QuartzCore.h>
#include <cmath>
#include "browser_agent_marker_geometry.h"

namespace {
constexpr double kRing = 16;
constexpr double kTagHeight = 20;
constexpr double kTagPadding = 8;
constexpr double kTagTextMax = 136;
constexpr double kTagGap = 10;
constexpr double kTagDrop = 7;
constexpr double kFadeIn = .16;
constexpr double kFadeOut = .42;
constexpr double kCrossfade = .18;
constexpr NSUInteger kNameMax = 24;
// Aven's default accent (#57b5ff) until an agent identity arrives.
constexpr supermono::AgentMarkerRgb kDefaultColor{.341, .710, 1.0};
constexpr supermono::AgentMarkerRgb kWhite{1, 1, 1};
constexpr supermono::AgentMarkerRgb kBlack{0, 0, 0};

CGColorRef Color(supermono::AgentMarkerRgb c, double alpha) {
  return [NSColor colorWithSRGBRed:c.r green:c.g blue:c.b alpha:alpha].CGColor;
}
CALayer *Circle(CALayer *parent, double diameter) {
  CALayer *layer = [CALayer layer];
  layer.bounds = CGRectMake(0, 0, diameter, diameter);
  layer.position = CGPointZero;
  layer.cornerRadius = diameter / 2;
  [parent addSublayer:layer];
  return layer;
}
void ResizeCircle(CALayer *layer, double diameter) {
  layer.bounds = CGRectMake(0, 0, diameter, diameter);
  layer.cornerRadius = diameter / 2;
}
CAMediaTimingFunction *Timing(float a, float b, float c, float d) {
  return [CAMediaTimingFunction functionWithControlPoints:a :b :c :d];
}
CABasicAnimation *Basic(NSString *key, id from, id to, double duration) {
  CABasicAnimation *animation = [CABasicAnimation animationWithKeyPath:key];
  animation.fromValue = from;
  animation.toValue = to;
  animation.duration = duration;
  return animation;
}
CAKeyframeAnimation *Keyframes(NSString *key, NSArray<NSNumber *> *values,
                               NSArray<NSNumber *> *times, double duration) {
  CAKeyframeAnimation *animation = [CAKeyframeAnimation animationWithKeyPath:key];
  animation.values = values;
  animation.keyTimes = times;
  animation.duration = duration;
  animation.timingFunction = Timing(.33, 0, .25, 1);
  return animation;
}
// Bounded, single-line provider name. Control and bidi characters never reach
// the drawn label.
NSString *CleanName(NSString *name) {
  if (![name isKindOfClass:NSString.class]) return nil;
  NSMutableCharacterSet *hidden = [NSMutableCharacterSet controlCharacterSet];
  [hidden formUnionWithCharacterSet:NSCharacterSet.illegalCharacterSet];
  [hidden addCharactersInString:@"؜​‌‍‎‏  "
      "‪‫‬‭‮⁠⁦⁧⁨⁩﻿"];
  NSArray *parts = [name componentsSeparatedByCharactersInSet:hidden];
  NSString *joined = [[parts componentsJoinedByString:@" "]
      stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  NSArray *words = [joined componentsSeparatedByCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
  words = [words filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"length > 0"]];
  joined = [words componentsJoinedByString:@" "];
  if (!joined.length) return nil;
  if (joined.length <= kNameMax) return joined;
  NSRange range = [joined rangeOfComposedCharacterSequencesForRange:NSMakeRange(0, kNameMax - 1)];
  return [[[joined substringWithRange:range]
      stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet]
      stringByAppendingString:@"…"];
}
}  // namespace

@implementation SMBrowserAgentMarker {
  CALayer *_root;
  CALayer *_anchor;
  CALayer *_group;
  CALayer *_outline;
  CALayer *_halo;
  CALayer *_ring;
  CALayer *_flash;
  CALayer *_dot;
  CALayer *_ripple;
  CALayer *_tag;
  CATextLayer *_text;
  BOOL _active;
  NSPoint _point;
  NSString *_name;
  supermono::AgentMarkerRgb _color;
  NSSize _tagSize;
  BOOL _tagRight;
  BOOL _tagBelow;
  BOOL _styled;
  BOOL _styledHighContrast;
  double _styledScale;
  NSString *_styledName;
  supermono::AgentMarkerRgb _styledColor;
  uint64_t _generation;
  NSInteger _suspended;
  SMAgentMarkerAction _lastAction;
}
@synthesize active = _active, point = _point, name = _name, lastAction = _lastAction;
@synthesize tagRight = _tagRight, tagBelow = _tagBelow;

- (instancetype)initWithFrame:(NSRect)frame {
  if (!(self = [super initWithFrame:frame])) return nil;
  // Layer-hosting: this view owns the tree and AppKit never redraws it.
  _root = [CALayer layer];
  _root.masksToBounds = NO;
  self.layer = _root;
  self.wantsLayer = YES;
  self.hidden = YES;
  self.accessibilityElement = NO;
  _linger = 2.0;
  _name = @"Agent";
  _color = kDefaultColor;
  _tagRight = _tagBelow = YES;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _anchor = [CALayer layer];
  _anchor.bounds = CGRectZero;
  _anchor.opacity = 0;
  [_root addSublayer:_anchor];
  _ripple = Circle(_anchor, kRing);
  _ripple.opacity = 0;
  _group = [CALayer layer];
  _group.bounds = CGRectZero;
  _group.position = CGPointZero;
  [_anchor addSublayer:_group];
  _outline = Circle(_group, kRing + 4);
  _halo = Circle(_group, kRing + 2);
  _ring = Circle(_group, kRing);
  _ring.shadowOffset = CGSizeZero;
  _flash = Circle(_group, kRing);
  _flash.opacity = 0;
  _dot = Circle(_group, 3);
  _tag = [CALayer layer];
  _tag.cornerRadius = kTagHeight / 2;
  _tag.shadowOffset = CGSizeMake(0, -1);
  _tag.shadowRadius = 2.5;
  _tag.shadowColor = Color(kBlack, 1);
  [_anchor addSublayer:_tag];
  _text = [CATextLayer layer];
  _text.truncationMode = kCATruncationEnd;
  [_tag addSublayer:_text];
  [CATransaction commit];
  return self;
}
// Unflipped on purpose: AppKit marks a flipped view's hosted root layer
// geometryFlipped, which would mirror positions and turn the tag text upside
// down. Action points are converted from top-left coordinates explicitly.
- (BOOL)isFlipped { return NO; }
- (BOOL)isOpaque { return NO; }
- (BOOL)acceptsFirstResponder { return NO; }
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  if (!self.window) [self clear];
  else _styled = NO;
}
- (void)viewDidChangeBackingProperties {
  [super viewDidChangeBackingProperties];
  _styled = NO;
  if (_active) [self refreshStyle];
}
- (void)setFrameSize:(NSSize)size {
  [super setFrameSize:size];
  if (!_active) return;
  // A resize keeps the marker on the same page point; never animate it.
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [_anchor removeAnimationForKey:@"glide"];
  _anchor.position = [self layerPoint:_point];
  [self placeTag];
  [CATransaction commit];
}
- (CGPoint)layerPoint:(NSPoint)point {
  // The hosted root layer is unflipped; action points use top-left coordinates.
  return CGPointMake(point.x, self.bounds.size.height - point.y);
}
- (BOOL)reduceMotion {
  if (_reduceMotionOverride) return _reduceMotionOverride.boolValue;
  return NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
}

- (BOOL)setActorName:(NSString *)name red:(double)red green:(double)green blue:(double)blue {
  NSString *clean = CleanName(name);
  const supermono::AgentMarkerRgb color{red, green, blue};
  if (!clean || !supermono::AgentMarkerValidColor(color)) return NO;
  _name = [clean copy];
  _color = color;
  if (_active) [self refreshStyle];
  return YES;
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
    if ([siblings indexOfObjectIdenticalTo:self] < [siblings indexOfObjectIdenticalTo:browser])
      [clip addSubview:self positioned:NSWindowAbove relativeTo:browser];
  }
  self.autoresizingMask = browser.autoresizingMask;
  if (!NSEqualRects(self.frame, frame)) self.frame = frame;
}

- (void)refreshStyle {
  const BOOL high = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldIncreaseContrast;
  const double scale = std::max(1.0, self.window ? self.window.backingScaleFactor : 2.0);
  if (_styled && _styledHighContrast == high && _styledScale == scale &&
      [_styledName isEqualToString:_name] && _styledColor.r == _color.r &&
      _styledColor.g == _color.g && _styledColor.b == _color.b)
    return;
  _styled = YES;
  _styledHighContrast = high;
  _styledScale = scale;
  _styledName = _name;
  _styledColor = _color;
  const auto palette = supermono::AgentMarkerTagPalette(_color, high);
  NSFont *font = [NSFont systemFontOfSize:11 weight:high ? .4 : .3];
  NSColor *ink = [NSColor colorWithSRGBRed:palette.ink.r green:palette.ink.g
                                      blue:palette.ink.b alpha:1];
  // Measure with AppKit; draw a plain string with layer font properties,
  // which CATextLayer renders upright in any host geometry.
  const NSSize measured = [_name sizeWithAttributes:@{NSFontAttributeName: font}];
  const double textWidth = std::min(std::ceil(measured.width), kTagTextMax);
  const double textHeight = std::ceil(measured.height);
  _tagSize = NSMakeSize(textWidth + kTagPadding * 2, kTagHeight);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _ring.borderWidth = high ? 2.75 : 2;
  _ring.borderColor = Color(_color, 1);
  _ring.backgroundColor = Color(_color, high ? .26 : .16);
  // A soft glow in the agent's colour.
  _ring.shadowColor = Color(_color, 1);
  _ring.shadowRadius = 5;
  _ring.shadowOpacity = high ? .35 : .55;
  // Light and dark hairlines keep the ring legible over any page.
  ResizeCircle(_halo, kRing + 2);
  _halo.borderWidth = 1;
  _halo.borderColor = Color(kWhite, high ? 1 : .85);
  ResizeCircle(_outline, kRing + 4);
  _outline.borderWidth = 1;
  _outline.borderColor = Color(kBlack, high ? .7 : .22);
  _flash.backgroundColor = Color(_color, 1);
  ResizeCircle(_dot, high ? 4 : 3);
  _dot.backgroundColor = Color(_color, 1);
  _ripple.borderColor = Color(_color, 1);
  _ripple.borderWidth = 2;
  _tag.backgroundColor = Color(palette.fill, 1);
  _tag.borderWidth = high ? 1.25 : 1;
  _tag.borderColor = Color(kWhite, high ? .9 : .45);
  _tag.shadowOpacity = high ? .45 : .28;
  _text.contentsScale = scale;
  _text.font = (__bridge CFTypeRef)font;
  _text.fontSize = font.pointSize;
  _text.foregroundColor = ink.CGColor;
  _text.string = _name;
  _text.frame = CGRectMake(kTagPadding, std::round((kTagHeight - textHeight) / 2),
                           textWidth, textHeight);
  [self placeTag];
  [CATransaction commit];
}

- (void)placeTag {
  const NSRect bounds = self.bounds;
  const auto side = supermono::AgentMarkerTagPlacement({_point.x, _point.y},
      _tagSize.width, _tagSize.height, bounds.size.width, bounds.size.height, 0,
      kTagGap, kTagDrop);
  _tagRight = side.right;
  _tagBelow = side.below;
  // Anchor-relative and unflipped: "below" is negative y.
  const double x = side.right ? kTagGap : -kTagGap - _tagSize.width;
  const double y = side.below ? -kTagDrop - _tagSize.height : kTagDrop;
  _tag.frame = CGRectMake(x, y, _tagSize.width, _tagSize.height);
}

- (BOOL)showAction:(SMAgentMarkerAction)action at:(NSPoint)point {
  if (!std::isfinite(point.x) || !std::isfinite(point.y)) return NO;
  const BOOL reduce = [self reduceMotion];
  const BOOL appearing = !_active;
  const uint64_t generation = ++_generation;
  _active = YES;
  _lastAction = action;
  _point = point;
  self.hidden = _suspended > 0;
  [self refreshStyle];
  const CGPoint target = [self layerPoint:point];
  const CFTimeInterval now = CACurrentMediaTime();
  double travel = 0;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [self placeTag];
  if (appearing) {
    [_anchor removeAllAnimations];
    [_group removeAllAnimations];
    [_ripple removeAllAnimations];
    [_flash removeAllAnimations];
    _anchor.position = target;
    _anchor.opacity = 1;
    [_anchor addAnimation:Basic(@"opacity", @0, @1, kFadeIn) forKey:@"fade"];
    if (!reduce) {
      CABasicAnimation *grow = Basic(@"transform.scale", @.45, @1, .34);
      grow.timingFunction = Timing(.3, 1.4, .5, 1);
      [_group addAnimation:grow forKey:@"appear"];
    }
  } else {
    CALayer *shown = _anchor.presentationLayer ?: _anchor;
    const CGPoint from = shown.position;
    const double fromOpacity = shown.opacity;
    const double distance = std::hypot(target.x - from.x, target.y - from.y);
    [_anchor removeAnimationForKey:@"fade"];
    _anchor.position = target;
    _anchor.opacity = 1;
    if (distance >= .5 && !reduce) {
      travel = supermono::AgentMarkerTravelSeconds(distance);
      CABasicAnimation *glide = Basic(@"position", [NSValue valueWithPoint:from],
                                      [NSValue valueWithPoint:target], travel);
      glide.timingFunction = Timing(.2, .8, .2, 1);
      [_anchor addAnimation:glide forKey:@"glide"];
    } else if (distance >= .5) {
      // Reduce Motion: jump, then crossfade in at the new place.
      [_anchor removeAnimationForKey:@"glide"];
      [_anchor addAnimation:Basic(@"opacity", @(std::min(fromOpacity, .25)), @1, kCrossfade)
                     forKey:@"fade"];
    }
    if (fromOpacity < 1 && ![_anchor animationForKey:@"fade"])
      [_anchor addAnimation:Basic(@"opacity", @(fromOpacity), @1, kFadeIn) forKey:@"fade"];
  }
  [self feedback:action reduce:reduce begin:now + travel];
  [CATransaction commit];
  __weak SMBrowserAgentMarker *weak = self;
  const double linger = std::max(0.0, _linger) + travel;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(linger * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    [weak fadeOutGeneration:generation];
  });
  return YES;
}

- (void)feedback:(SMAgentMarkerAction)action reduce:(BOOL)reduce begin:(CFTimeInterval)begin {
  NSString *key = @"feedback";
  CAAnimation *ring = nil, *flash = nil, *ripple = nil;
  switch (action) {
    case SMAgentMarkerActionClick:
      if (!reduce) {
        // One soft ripple out from the ring, plus a small press dip.
        CAAnimationGroup *wave = [CAAnimationGroup animation];
        wave.animations = @[Basic(@"transform.scale", @1, @2.8, .52),
                            Basic(@"opacity", @.65, @0, .52),
                            Basic(@"borderWidth", @2, @.4, .52)];
        wave.duration = .52;
        wave.timingFunction = Timing(.16, .8, .3, 1);
        wave.fillMode = kCAFillModeBoth;
        ripple = wave;
        ring = Keyframes(@"transform.scale", @[@1, @.84, @1], @[@0, @.3, @1], .26);
      } else {
        flash = Keyframes(@"opacity", @[@0, @.55, @0], @[@0, @.25, @1], .36);
      }
      break;
    case SMAgentMarkerActionType:
      // A gentle double pulse says "typing" without ever showing the text.
      if (!reduce) {
        CAKeyframeAnimation *pulse = Keyframes(@"transform.scale", @[@1, @1.1, @1],
                                               @[@0, @.5, @1], .36);
        pulse.repeatCount = 2;
        ring = pulse;
      }
      {
        CAKeyframeAnimation *glow = Keyframes(@"opacity", @[@0, @.25, @0], @[@0, @.5, @1], .36);
        glow.repeatCount = 2;
        flash = glow;
      }
      break;
    case SMAgentMarkerActionKey:
    case SMAgentMarkerActionScroll:
      if (!reduce) ring = Keyframes(@"transform.scale", @[@1, @1.16, @1], @[@0, @.4, @1], .32);
      flash = Keyframes(@"opacity", @[@0, @.3, @0], @[@0, @.4, @1], .32);
      break;
  }
  for (CAAnimation *animation in @[ring ?: NSNull.null, flash ?: NSNull.null, ripple ?: NSNull.null]) {
    if (![animation isKindOfClass:CAAnimation.class]) continue;
    // Feedback lands when the glide arrives, not on the way.
    animation.beginTime = begin;
    animation.fillMode = kCAFillModeBackwards;
  }
  if (ring) [_group addAnimation:ring forKey:key];
  if (flash) [_flash addAnimation:flash forKey:key];
  if (ripple) [_ripple addAnimation:ripple forKey:key];
}

- (void)fadeOutGeneration:(uint64_t)generation {
  if (generation != _generation || !_active) return;
  CALayer *shown = _anchor.presentationLayer ?: _anchor;
  const double from = shown.opacity;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _anchor.opacity = 0;
  [_anchor addAnimation:Basic(@"opacity", @(from), @0, kFadeOut) forKey:@"fade"];
  [CATransaction commit];
  __weak SMBrowserAgentMarker *weak = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kFadeOut * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    SMBrowserAgentMarker *marker = weak;
    if (!marker || generation != marker->_generation || !marker->_active) return;
    [marker finishHiding];
  });
}

- (void)finishHiding {
  _active = NO;
  self.hidden = YES;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [_anchor removeAllAnimations];
  [_group removeAllAnimations];
  [_ripple removeAllAnimations];
  [_flash removeAllAnimations];
  _anchor.opacity = 0;
  [CATransaction commit];
}

- (void)clear {
  ++_generation;
  if (!_active && self.hidden) return;
  [self finishHiding];
}

- (void)suspendForCapture {
  if (_suspended++ == 0 && !self.hidden) {
    self.hidden = YES;
    // The capture copies window pixels later on this thread; commit now.
    [CATransaction flush];
  }
}
- (void)resumeAfterCapture {
  if (_suspended <= 0) return;
  if (--_suspended == 0) self.hidden = !_active;
}
@end
