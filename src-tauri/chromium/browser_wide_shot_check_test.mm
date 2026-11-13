// Live check of an agent's picture of a page at another width, in the real
// Chromium bridge: `agent-screenshot` with `pageWidth` and `pageHeight`. A
// page in a narrow pane shows its small-screen layout; the wide picture must
// show the layout of that width, and the pane must not: for the capture the
// page really is laid out wide and Chromium resizes its view, so a page on
// screen is covered by a still picture of itself until its own layout is
// back. Afterwards the page has its pane's width and its scroll position.
// `scripts/check-chromium-wide-shot.py` builds this into a throwaway app
// bundle with the pinned CEF runtime, serves a small responsive page on
// 127.0.0.1 and runs it under a throwaway home; see docs/DEVELOPMENT.md.
//
// The page is red when narrow and blue from 1000 px, with a yellow strip
// fixed to its top and a purple one to its bottom, and a picture only the
// wide layout loads (green), which its server sends late. Its title carries
// its layout width, scroll position and how many resizes it saw.
#import <Cocoa/Cocoa.h>
#import <ImageIO/ImageIO.h>
#import <Security/Security.h>
#import <UserNotifications/UserNotifications.h>
#import <objc/runtime.h>

#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "supermono_chromium.h"

namespace {

constexpr double kPaneWidth = 480, kPaneHeight = 600;
const char *kPage = "wide-check";

NSTimeInterval started_at = 0;
double Ms() { return ([NSDate timeIntervalSinceReferenceDate] - started_at) * 1000; }

struct Load {
  bool loading = false;
  long committed = 0, settled = 0;
  std::string url, title;
};
std::mutex lock;
Load state;
std::map<std::string, NSDictionary *> results;
int failures = 0;
std::atomic<int> notification_requests{0};

void RefuseNotificationRequest(id, SEL, UNAuthorizationOptions, void (^done)(BOOL, NSError *)) {
  ++notification_requests;
  if (done) dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{ done(NO, nil); });
}

Load Read() {
  std::lock_guard<std::mutex> guard(lock);
  return state;
}

void OnEvent(const char *, const char *json, void *) {
  NSData *data = [NSData dataWithBytes:json length:strlen(json)];
  NSDictionary *event = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![event isKindOfClass:NSDictionary.class]) return;
  std::lock_guard<std::mutex> guard(lock);
  if ([event[@"type"] isEqual:@"result"] && [event[@"requestId"] isKindOfClass:NSString.class]) {
    results[[event[@"requestId"] UTF8String]] = event;
    return;
  }
  if (![event[@"type"] isEqual:@"state"]) return;
  state.loading = [event[@"loading"] boolValue];
  state.committed = [event[@"loadsCommitted"] longValue];
  state.settled = [event[@"loadsSettled"] longValue];
  state.url = [event[@"url"] isKindOfClass:NSString.class] ? [event[@"url"] UTF8String] : "";
  state.title = [event[@"title"] isKindOfClass:NSString.class] ? [event[@"title"] UTF8String] : "";
}

void OnMain(void (^block)(void)) { dispatch_sync(dispatch_get_main_queue(), block); }

bool WaitUntil(bool (^done)(void), double limit_ms) {
  const double end = Ms() + limit_ms;
  while (!done()) {
    if (Ms() >= end) return false;
    usleep(10000);
  }
  return true;
}

void Report(bool passed, const std::string& name, const std::string& detail) {
  if (!passed) ++failures;
  printf("%s  %s - %s\n", passed ? "PASS" : "FAIL", name.c_str(), detail.c_str());
  fflush(stdout);
}

// Sends one command and waits for its result event.
NSDictionary *Send(NSDictionary *command, double limit_ms) {
  NSString *request = [NSUUID UUID].UUIDString;
  NSData *json = [NSJSONSerialization dataWithJSONObject:command options:0 error:nil];
  NSString *text = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
  __block int ok = 0;
  OnMain(^{ ok = sm_chromium_command(kPage, request.UTF8String, text.UTF8String); });
  if (!ok) return @{@"ok" : @NO, @"error" : @(sm_chromium_last_error())};
  const std::string key = request.UTF8String;
  __block NSDictionary *found = nil;
  WaitUntil(^{
    std::lock_guard<std::mutex> guard(lock);
    auto it = results.find(key);
    if (it == results.end()) return false;
    found = it->second;
    return true;
  }, limit_ms);
  return found ?: @{@"ok" : @NO, @"error" : @"no result in time"};
}

std::string ErrorOf(NSDictionary *event) {
  id result = event[@"result"];
  id error = [result isKindOfClass:NSDictionary.class] ? result[@"error"] : event[@"error"];
  return [error isKindOfClass:NSString.class] ? [error UTF8String] : "";
}

struct Colour { int r = -1, g = -1, b = -1; };
struct Pixels {
  std::vector<uint8_t> rgba;
  size_t width = 0, height = 0;
  // `x` and `y` are fractions of the picture, from its top-left corner.
  Colour At(double x, double y) const {
    if (!width || !height) return {};
    const size_t column = std::min(width - 1, size_t(x * width)), row = std::min(height - 1, size_t(y * height));
    const uint8_t *p = &rgba[(row * width + column) * 4];
    return {p[0], p[1], p[2]};
  }
};

Pixels Draw(CGImageRef image) {
  Pixels pixels;
  if (!image) return pixels;
  pixels.width = CGImageGetWidth(image);
  pixels.height = CGImageGetHeight(image);
  pixels.rgba.assign(pixels.width * pixels.height * 4, 0);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(pixels.rgba.data(), pixels.width, pixels.height, 8,
      pixels.width * 4, space, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
  CGContextDrawImage(context, CGRectMake(0, 0, pixels.width, pixels.height), image);
  CGContextRelease(context);
  CGColorSpaceRelease(space);
  return pixels;
}

struct Shot {
  bool ok = false, visible = false;
  std::string error;
  long width = 0, height = 0, page_width = 0, page_height = 0;
  Pixels pixels;
};

Shot Take(NSDictionary *extra, NSString *output, NSString *name) {
  NSMutableDictionary *command = [@{@"action" : @"agent-screenshot"} mutableCopy];
  [command addEntriesFromDictionary:extra ?: @{}];
  NSDictionary *event = Send(command, 20000);
  Shot shot;
  shot.ok = [event[@"ok"] boolValue];
  shot.error = ErrorOf(event);
  NSDictionary *result = event[@"result"];
  if (!shot.ok || ![result isKindOfClass:NSDictionary.class]) return shot;
  shot.visible = [result[@"visible"] boolValue];
  shot.width = [result[@"width"] longValue];
  shot.height = [result[@"height"] longValue];
  shot.page_width = [result[@"pageWidth"] longValue];
  shot.page_height = [result[@"pageHeight"] longValue];
  NSData *png = [[NSData alloc] initWithBase64EncodedString:result[@"data"] ?: @"" options:0];
  if (png && output.length) [png writeToFile:[output stringByAppendingPathComponent:name] atomically:YES];
  CGImageSourceRef source = png ? CGImageSourceCreateWithData((__bridge CFDataRef)png, nullptr) : nullptr;
  CGImageRef image = source ? CGImageSourceCreateImageAtIndex(source, 0, nullptr) : nullptr;
  shot.pixels = Draw(image);
  if (image) CGImageRelease(image);
  if (source) CFRelease(source);
  return shot;
}

bool Near(Colour c, int r, int g, int b) {
  return c.r >= 0 && std::abs(c.r - r) <= 16 && std::abs(c.g - g) <= 16 && std::abs(c.b - b) <= 16;
}
bool Red(Colour c) { return Near(c, 200, 30, 30); }
bool Blue(Colour c) { return Near(c, 30, 90, 200); }
bool Yellow(Colour c) { return Near(c, 240, 200, 0); }
bool Purple(Colour c) { return Near(c, 150, 40, 200); }
bool Green(Colour c) { return Near(c, 20, 160, 60); }
std::string Name(Colour c) {
  return "rgb(" + std::to_string(c.r) + "," + std::to_string(c.g) + "," + std::to_string(c.b) + ")";
}
std::string Size(const Shot& shot) {
  return shot.ok ? std::to_string(shot.width) + " by " + std::to_string(shot.height) + " pixels" : shot.error;
}

// The narrow layout: red, with the strips at its top and bottom.
bool Narrow(const Shot& shot) {
  return shot.ok && Yellow(shot.pixels.At(.5, .02)) && Red(shot.pixels.At(.9, .5)) && Purple(shot.pixels.At(.5, .98));
}
std::string Look(const Shot& shot) {
  if (!shot.ok) return shot.error;
  return Size(shot) + ", top " + Name(shot.pixels.At(.5, .02)) + ", middle " + Name(shot.pixels.At(.9, .5)) +
         ", bottom " + Name(shot.pixels.At(.5, .98));
}

bool TitleIs(const std::string& start) { return Read().title.rfind(start, 0) == 0; }

// What the pane holds at one moment of a wide capture.
struct Sample {
  double at = 0;
  bool covered = false, page_resized = false, cover_narrow = false, cover_fills = false;
  double page_width = 0;
};
std::vector<Sample> samples;
dispatch_source_t sampler = nil;

double Widest(NSView *view) {
  double width = view.frame.size.width;
  for (NSView *inner in view.subviews) width = std::max(width, Widest(inner));
  return width;
}

// The page's view and the still picture over it, as the pane holds them now.
// The still picture is drawn as AppKit would draw it, so its orientation and
// its fit are those on screen; Chromium's own view draws nothing this way.
Sample Look(NSView *parent) {
  Sample sample;
  sample.at = Ms();
  NSView *clip = nil;
  for (NSView *view in parent.subviews)
    if ([NSStringFromClass(view.class) isEqual:@"SMBrowserClipView"]) clip = view;
  NSView *page = clip.subviews.firstObject, *still = nil;
  for (NSView *view in clip.subviews)
    if ([NSStringFromClass(view.class) isEqual:@"SMBrowserStillView"]) still = view;
  // Chromium sizes the view that draws the page, inside the one CEF hands out.
  sample.page_width = Widest(page);
  sample.page_resized = std::abs(sample.page_width - kPaneWidth) > .5;
  sample.covered = still != nil && !still.hidden && [clip.subviews indexOfObjectIdenticalTo:still] > [clip.subviews indexOfObjectIdenticalTo:page];
  if (!sample.covered) return sample;
  sample.cover_fills = NSContainsRect(still.frame, clip.bounds);
  NSBitmapImageRep *drawn = [clip bitmapImageRepForCachingDisplayInRect:clip.bounds];
  [clip cacheDisplayInRect:clip.bounds toBitmapImageRep:drawn];
  const Pixels pixels = Draw(drawn.CGImage);
  sample.cover_narrow = Yellow(pixels.At(.5, .02)) && Red(pixels.At(.9, .5)) && Purple(pixels.At(.5, .98));
  return sample;
}

// A picture at 1280 of a page its pane shows, with a look at the pane every
// few milliseconds from before the capture until half a second after it.
void WideWhileShown(NSView *parent, NSString *output, NSString *file, const std::string& where) {
  OnMain(^{
    samples.clear();
    sampler = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, DISPATCH_TIMER_STRICT, dispatch_get_main_queue());
    dispatch_source_set_timer(sampler, DISPATCH_TIME_NOW, 6 * NSEC_PER_MSEC, 0);
    dispatch_source_set_event_handler(sampler, ^{ samples.push_back(Look(parent)); });
    dispatch_resume(sampler);
  });
  const double began = Ms();
  const Shot wide_shown = Take(@{@"pageWidth" : @1280, @"pageHeight" : @800}, output, file);
  const double answered = Ms();
  usleep(500000);
  __block std::vector<Sample> seen;
  OnMain(^{
    dispatch_source_cancel(sampler);
    sampler = nil;
    seen = samples;
  });
  Report(wide_shown.ok && wide_shown.page_width == 1280 && Yellow(wide_shown.pixels.At(.5, .02)) &&
             Blue(wide_shown.pixels.At(.9, .5)) && Purple(wide_shown.pixels.At(.5, .98)) &&
             Green(wide_shown.pixels.At(200.0 / 1280, 150.0 / 800)),
         "a picture at 1280 of a page " + where + " shows the wide layout",
         Look(wide_shown) + " in " + std::to_string(long(answered - began)) + " ms");
  long total = 0, resized = 0, resized_bare = 0, covered = 0, cover_wrong = 0, bare_before_answer = 0;
  double first_cover = -1, last_cover = -1, widest_page = 0;
  for (const Sample& sample : seen) {
    ++total;
    widest_page = std::max(widest_page, sample.page_width);
    if (sample.page_resized) ++resized;
    if (sample.page_resized && !sample.covered) ++resized_bare;
    if (sample.covered) {
      ++covered;
      if (first_cover < 0) first_cover = sample.at;
      last_cover = sample.at;
      if (!sample.cover_narrow || !sample.cover_fills) ++cover_wrong;
    } else if (first_cover >= 0 && sample.at < answered) {
      ++bare_before_answer;
    }
  }
  Report(total > 20 && resized > 0 && widest_page == 1280,
         where + ": for the capture Chromium really sizes the page's view to 1280",
         std::to_string(resized) + " of " + std::to_string(total) + " looks at the pane found the view resized, widest " +
             std::to_string(long(widest_page)));
  Report(covered > 0 && resized_bare == 0 && bare_before_answer == 0,
         where + ": the pane's own picture covers the page from before that until its layout is back",
         "covered for " + std::to_string(long(last_cover - first_cover)) + " ms; " + std::to_string(resized_bare) +
             " looks found a resized view uncovered, " + std::to_string(bare_before_answer) + " found it uncovered before the answer");
  Report(covered > 0 && cover_wrong == 0, where + ": that picture is the narrow layout, upright and filling the pane",
         std::to_string(cover_wrong) + " of " + std::to_string(covered) + " looks found another picture");
  Report(!seen.empty() && !seen.back().covered && !seen.back().page_resized,
         where + ": the cover comes off and the view has its pane's size", "last look " +
             std::to_string(long(seen.empty() ? 0 : seen.back().at - answered)) + " ms after the answer");
}

void Check(NSString *output, NSWindow *window, NSView *parent) {
  // Hidden, as a background tab: nothing is on screen to disturb.
  Report(WaitUntil(^{ return TitleIs("w480 "); }, 4000), "the page is laid out at its pane's width", Read().title);
  const Shot hidden = Take(nil, output, @"hidden-pane.png");
  const double density = hidden.ok ? hidden.width / kPaneWidth : 0;
  Report(Narrow(hidden) && !hidden.visible && hidden.page_width == 0 && (density == 1 || density == 2),
         "a picture without a width is the pane's narrow layout", Look(hidden));

  NSDictionary *scrolled = Send(@{@"action" : @"scroll", @"deltaX" : @0, @"deltaY" : @700}, 8000);
  const bool down = [scrolled[@"ok"] boolValue] && WaitUntil(^{ return TitleIs("w480 y700 "); }, 4000);
  Report(down, "the page scrolls down in its pane", Read().title);

  const double before = Ms();
  const Shot wide = Take(@{@"pageWidth" : @1280, @"pageHeight" : @800}, output, @"hidden-wide-1280.png");
  const double took = Ms() - before;
  Report(wide.ok && wide.page_width == 1280 && wide.page_height == 800 && wide.width == long(1280 * density) &&
             wide.height == long(800 * density),
         "a picture at 1280 is 1280 by 800 at the display's density",
         Size(wide) + " in " + std::to_string(long(took)) + " ms");
  Report(wide.ok && Yellow(wide.pixels.At(.5, .02)) && Blue(wide.pixels.At(.9, .5)) && Purple(wide.pixels.At(.5, .98)),
         "it shows the wide layout", Look(wide));
  // The picture's box is 200 by 100 at (100, 100) of the wide layout.
  const Colour hero = wide.ok ? wide.pixels.At(200.0 / 1280, 150.0 / 800) : Colour{};
  Report(Green(hero), "it waited for the picture only the wide layout loads", Name(hero));
  Report(WaitUntil(^{ return TitleIs("w480 y700 "); }, 2000),
         "afterwards the page has its pane's width and its scroll position", Read().title);
  const Shot again = Take(nil, output, @"hidden-pane-after.png");
  Report(Narrow(again) && again.width == hidden.width && again.height == hidden.height,
         "the next picture without a width is the narrow layout again", Look(again));

  const Shot widest = Take(@{@"pageWidth" : @1920, @"pageHeight" : @1200}, output, @"hidden-wide-1920.png");
  const bool bounded = widest.ok && widest.page_width == 1920 && widest.width <= 4096 &&
      widest.width * widest.height <= 8 * 1024 * 1024 &&
      std::abs(double(widest.width) / widest.height - 1.6) < .01 && Blue(widest.pixels.At(.9, .5));
  Report(bounded, "the widest picture keeps its shape within the image limits", Look(widest));

  // Narrower than the pane works the same way: a phone's width, upright.
  const Shot phone = Take(@{@"pageWidth" : @390, @"pageHeight" : @845}, output, @"hidden-narrow-390.png");
  Report(phone.ok && phone.page_width == 390 && phone.width == long(390 * density) &&
             phone.height == long(845 * density) && Yellow(phone.pixels.At(.5, .02)) && Red(phone.pixels.At(.9, .5)) &&
             Purple(phone.pixels.At(.5, .98)),
         "a picture at 390 is the narrow layout, 390 by 845", Look(phone));

  const Shot small = Take(@{@"pageWidth" : @100, @"pageHeight" : @800}, nil, nil);
  const Shot no_height = Take(@{@"pageWidth" : @1280}, nil, nil);
  const Shot fraction = Take(@{@"pageWidth" : @1280.5, @"pageHeight" : @800}, nil, nil);
  Report(!small.ok && !no_height.ok && !fraction.ok && small.error.find("Invalid screenshot width") != std::string::npos,
         "widths outside the bounds are refused", small.error);
  Report(WaitUntil(^{ return TitleIs("w480 y700 "); }, 2000), "a refused width leaves the page alone", Read().title);

  // On screen, as beside a chat. The window takes no click and no key.
  OnMain(^{
    window.alphaValue = 1;
    sm_chromium_layout(kPage, 0, 0, kPaneWidth, kPaneHeight, 1, 0, 0, kPaneHeight, 0, nullptr, 0, nullptr, 0, 0);
  });
  usleep(700000);
  __block std::string window_state;
  OnMain(^{
    window_state = std::string("window ") + (window.visible ? "shown" : "not shown") + ", " +
        ((window.occlusionState & NSWindowOcclusionStateVisible) ? "in view" : "out of view") + ", " +
        (window.screen ? "on a screen" : "on no screen");
  });
  const Shot shown = Take(nil, output, @"shown-pane.png");
  Report(shown.ok && shown.visible, "the page is on screen (needs an unlocked Mac with its display on)",
         shown.ok ? (shown.visible ? "copied from the screen" : "not on screen (" + window_state + "): the checks below cannot hold") : shown.error);
  Report(Narrow(shown), "on screen it shows the narrow layout", Look(shown));

  WideWhileShown(parent, output, @"shown-wide-1280.png", "on screen");
  Report(WaitUntil(^{ return TitleIs("w480 y700 "); }, 2000),
         "afterwards the page on screen has its pane's width and its scroll position", Read().title);
  const Shot after = Take(nil, output, @"shown-pane-after.png");
  Report(Narrow(after) && after.visible && after.width == shown.width && after.height == shown.height,
         "the screen shows the narrow layout again", Look(after));

  // Under the hover sidebar the screen shows more than the page, so the
  // cover is the page's own surface. The sidebar hides the pane's first 60 points.
  OnMain(^{
    sm_chromium_layout(kPage, 0, 0, kPaneWidth, kPaneHeight, 1, 60, 0, kPaneHeight, 0, nullptr, 0, nullptr, 0, 0);
  });
  usleep(400000);
  WideWhileShown(parent, output, @"sidebar-wide-1280.png", "under the hover sidebar");
  Report(WaitUntil(^{ return TitleIs("w480 y700 "); }, 2000),
         "afterwards the page under the sidebar has its pane's width and its scroll position", Read().title);
  const Shot beside = Take(nil, output, @"sidebar-pane-after.png");
  Report(beside.ok && beside.visible && Yellow(beside.pixels.At(.5, .02)) && Red(beside.pixels.At(.9, .5)) &&
             Purple(beside.pixels.At(.5, .98)) && beside.width == long((kPaneWidth - 60) * density),
         "the screen shows the part of the narrow layout the sidebar leaves", Look(beside));
}

}  // namespace

int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc < 3) {
      fprintf(stderr, "usage: %s <http://127.0.0.1:PORT/> <cache folder> [<folder for the pictures>]\n", argv[0]);
      return 2;
    }
    started_at = [NSDate timeIntervalSinceReferenceDate];
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    SecKeychainSetUserInteractionAllowed(false);
#pragma clang diagnostic pop
    method_setImplementation(
        class_getInstanceMethod(UNUserNotificationCenter.class,
                                @selector(requestAuthorizationWithOptions:completionHandler:)),
        (IMP)RefuseNotificationRequest);
    NSString *base = @(argv[1]);
    NSString *cache = @(argv[2]);
    NSString *output = argc > 3 ? @(argv[3]) : @"";
    [NSApplication sharedApplication];
    // An accessory app may show a window (a prohibited one may not) and
    // still has no Dock icon and never comes to the front by itself.
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    // Looks at the pane every few milliseconds must not be held back.
    id awake = [NSProcessInfo.processInfo
        beginActivityWithOptions:NSActivityUserInitiated | NSActivityLatencyCritical
                          reason:@"Timing a page capture"];
    (void)awake;
    NSString *frameworks =
        [NSBundle.mainBundle.bundlePath stringByAppendingPathComponent:@"Contents/Frameworks"];
    NSString *helper = [NSString stringWithFormat:@"%@ Helper.app/Contents/MacOS/%@ Helper",
                                                  NSBundle.mainBundle.infoDictionary[@"CFBundleName"],
                                                  NSBundle.mainBundle.infoDictionary[@"CFBundleName"]];
    NSDictionary *config = @{
      @"frameworkPath" : [frameworks stringByAppendingPathComponent:@"Chromium Embedded Framework.framework"],
      @"helperPath" : [frameworks stringByAppendingPathComponent:helper],
      @"cachePath" : cache,
      @"downloadPath" : cache,
      @"devUrl" : @"",
      @"throwawayProfile" : @YES,
    };
    NSData *json = [NSJSONSerialization dataWithJSONObject:config options:0 error:nil];
    NSString *text = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    if (!sm_chromium_initialize(text.UTF8String, OnEvent, nullptr)) {
      fprintf(stderr, "FAIL  Chromium starts - %s\n", sm_chromium_last_error());
      return 1;
    }
    // A small window in the screen's bottom-left corner, opaque only for the
    // second half of the check. It never takes the pointer or the keyboard.
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, kPaneWidth, kPaneHeight)
                                                   styleMask:NSWindowStyleMaskBorderless
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    window.releasedWhenClosed = NO;
    window.ignoresMouseEvents = YES;
    // On its screen from the start, so the page has that screen's density,
    // but clear until the second half: a copy of the screen needs it opaque.
    window.alphaValue = 0;
    window.level = NSFloatingWindowLevel;
    // In view on whichever Space is in front, a full-screen app's too: macOS
    // draws nothing for a window it counts as covered.
    window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
        NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorStationary;
    NSView *parent = window.contentView;
    [window orderFrontRegardless];
    std::thread([=] {
      const std::string first = std::string(base.UTF8String) + "page.html";
      __block bool created = false;
      OnMain(^{
        created = sm_chromium_create(kPage, (__bridge void *)parent, first.c_str(), "", 0, 0, kPaneWidth, kPaneHeight) != 0;
        if (created) sm_chromium_layout(kPage, 0, 0, kPaneWidth, kPaneHeight, 0, 0, 0, kPaneHeight, 0, nullptr, 0, nullptr, 0, 0);
      });
      if (!created) {
        Report(false, "a hidden page opens", sm_chromium_last_error());
      } else {
        const bool loaded = WaitUntil(^{
          const Load now = Read();
          return now.committed > 0 && now.settled > 0 && !now.loading;
        }, 8000);
        Report(loaded && Read().url == first, "the page loads hidden", Read().url);
        if (loaded) Check(output, window, parent);
      }
      OnMain(^{ [window orderOut:nil]; });
      usleep(300000);
      Report(notification_requests == 0, "Chromium asks for no notification permission",
             std::to_string(notification_requests.load()) + " requests in this process");
      OnMain(^{ sm_chromium_shutdown(); });
      usleep(1000000);
      printf("%s\n", failures ? "FAILED" : "PASSED");
      fflush(stdout);
      std::exit(failures ? 1 : 0);
    }).detach();
    [NSApp run];
  }
  return 0;
}
