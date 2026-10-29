// Live check of what an agent's read and export use, on a hidden page in the
// real Chromium bridge: the page's main content (the "extract" DOM action) and
// its images loaded through the page's own frame ("fetch-resource"). With
// credentials (Aven asks for them only for the page's own site) a cookie the
// page was given reaches the image requests; without, it does not, so a page
// cannot aim the user's cookies at another site. A cancelled load stops.
// `scripts/check-chromium-export.py` builds this into a throwaway app bundle
// with the pinned CEF runtime, serves a local article whose images answer
// only with that cookie, runs it under a throwaway home and compares the
// saved bytes; see docs/DEVELOPMENT.md.
//
// Reading must not change the page: no new load, the same address.
#import <Cocoa/Cocoa.h>
#import <Security/Security.h>
#import <UserNotifications/UserNotifications.h>
#import <objc/runtime.h>

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <mutex>
#include <string>
#include <thread>

#include "supermono_chromium.h"

namespace {

NSTimeInterval started_at = 0;
double Ms() { return ([NSDate timeIntervalSinceReferenceDate] - started_at) * 1000; }

struct Load {
  bool loading = false;
  long committed = 0, settled = 0;
  std::string url;
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
  OnMain(^{ ok = sm_chromium_command("export-check", request.UTF8String, text.UTF8String); });
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

// The body a fetch-resource result carries, decoded from its chunks.
NSData *Body(NSDictionary *result) {
  NSMutableData *body = [NSMutableData data];
  for (NSDictionary *chunk in result[@"chunks"]) {
    NSString *data = chunk[@"data"];
    if ([chunk[@"base64"] boolValue]) {
      NSData *bytes = [[NSData alloc] initWithBase64EncodedString:data options:0];
      if (!bytes) return nil;
      [body appendData:bytes];
    } else {
      [body appendData:[data dataUsingEncoding:NSUTF8StringEncoding]];
    }
  }
  return body;
}

// `other` is another origin (another port) where the page's cookie would
// also be sent, standing in for another site's server.
void Check(NSString *base, NSString *other, NSString *output) {
  const std::string page = std::string(base.UTF8String) + "article.html";
  const Load before = Read();
  NSDictionary *extracted = Send(@{@"action" : @"dom", @"request" : @{@"action" : @"extract", @"token" : @"check123"}}, 8000);
  NSDictionary *content = extracted[@"result"];
  NSString *markdown = [content isKindOfClass:NSDictionary.class] ? content[@"markdown"] : nil;
  NSArray *images = [content isKindOfClass:NSDictionary.class] ? content[@"images"] : nil;
  const bool read = [extracted[@"ok"] boolValue] && [markdown containsString:@"Cookies keep the images private."] &&
                    [markdown containsString:@"## Results"] && ![markdown containsString:@"Site menu"] &&
                    [content[@"title"] isEqual:@"Field notes"] && images.count == 3;
  Report(read, "the page's main content reads as Markdown",
         read ? [NSString stringWithFormat:@"%lu characters, %lu images", (unsigned long)markdown.length,
                                           (unsigned long)images.count].UTF8String
              : [NSString stringWithFormat:@"%@", extracted].UTF8String);
  NSMutableArray *saved = [NSMutableArray array];
  for (NSDictionary *image in images) {
    NSString *src = image[@"src"];
    // All of the article's images are on its own site.
    NSDictionary *fetched = Send(@{@"action" : @"fetch-resource", @"url" : src, @"credentials" : @YES}, 15000);
    NSData *body = [fetched[@"ok"] boolValue] ? Body(fetched[@"result"]) : nil;
    NSString *name = src.lastPathComponent;
    if (body) {
      [body writeToFile:[output stringByAppendingPathComponent:name] atomically:YES];
      [saved addObject:name];
    }
    Report(body.length > 0, std::string("an image loads through the page's session: ") + name.UTF8String,
           body ? [NSString stringWithFormat:@"%lu bytes, %@", (unsigned long)body.length,
                                             fetched[@"result"][@"contentType"]].UTF8String
                : [NSString stringWithFormat:@"%@", fetched[@"error"]].UTF8String);
  }
  // Without credentials, another origin's image gets no cookie; with them
  // it would, so the refusal is the flag's doing.
  NSString *elsewhere = [other stringByAppendingString:@"private/chart.png"];
  NSDictionary *anonymous = Send(@{@"action" : @"fetch-resource", @"url" : [elsewhere stringByAppendingString:@"?anonymous=1"],
                                   @"credentials" : @NO}, 15000);
  NSDictionary *credentialed = Send(@{@"action" : @"fetch-resource", @"url" : elsewhere, @"credentials" : @YES}, 15000);
  Report(![anonymous[@"ok"] boolValue] && [anonymous[@"error"] containsString:@"403"] && [credentialed[@"ok"] boolValue],
         "another origin's image loaded without credentials gets no cookie",
         [NSString stringWithFormat:@"without: %@; with: %@", anonymous[@"error"] ?: @"loaded",
                                    credentialed[@"error"] ?: @"loaded"].UTF8String);
  // Cancel a slow load: it ends as cancelled, and later loads still work.
  NSMutableArray *slow_result = [NSMutableArray array];
  dispatch_semaphore_t slow_done = dispatch_semaphore_create(0);
  NSString *slow_url = [base stringByAppendingString:@"public/slow.png"];
  std::thread([slow_result, slow_done, slow_url] {
    NSDictionary *answer = Send(@{@"action" : @"fetch-resource", @"url" : slow_url}, 15000);
    @synchronized(slow_result) { [slow_result addObject:answer]; }
    dispatch_semaphore_signal(slow_done);
  }).detach();
  usleep(300000);
  NSDictionary *cancel = Send(@{@"action" : @"fetch-cancel"}, 5000);
  dispatch_semaphore_wait(slow_done, dispatch_time(DISPATCH_TIME_NOW, 16 * NSEC_PER_SEC));
  NSDictionary *slow = nil;
  @synchronized(slow_result) { slow = slow_result.firstObject; }
  Report([cancel[@"ok"] boolValue] && ![slow[@"ok"] boolValue] && [slow[@"error"] containsString:@"cancelled"],
         "a load the host gave up on is cancelled", [NSString stringWithFormat:@"%@", slow[@"error"]].UTF8String);
  NSDictionary *again = Send(@{@"action" : @"fetch-resource", @"url" : [base stringByAppendingString:@"public/logo.png"]}, 15000);
  Report([again[@"ok"] boolValue] && Body(again[@"result"]).length > 0, "loads after a cancel still work",
         [again[@"ok"] boolValue] ? "the logo loaded" : [NSString stringWithFormat:@"%@", again[@"error"]].UTF8String);
  NSDictionary *refused = Send(@{@"action" : @"fetch-resource", @"url" : [base stringByAppendingString:@"private/expired.png"]}, 15000);
  Report(![refused[@"ok"] boolValue] && [refused[@"error"] containsString:@"403"],
         "an image the site refuses is reported, not saved", [NSString stringWithFormat:@"%@", refused[@"error"]].UTF8String);
  NSDictionary *large = Send(@{@"action" : @"fetch-resource", @"url" : [base stringByAppendingString:@"public/large.bin"],
                               @"maxBytes" : @(1024 * 1024)}, 15000);
  Report(![large[@"ok"] boolValue] && [large[@"error"] containsString:@"larger than"],
         "a file over the size limit stops loading", [NSString stringWithFormat:@"%@", large[@"error"]].UTF8String);
  NSDictionary *file = Send(@{@"action" : @"fetch-resource", @"url" : @"file:///etc/hosts"}, 5000);
  Report(![file[@"ok"] boolValue], "only http and https addresses load", [NSString stringWithFormat:@"%@", file[@"error"]].UTF8String);
  usleep(300000);
  const Load after = Read();
  Report(after.committed == before.committed && after.url == page && !after.loading,
         "reading leaves the page as it was",
         std::to_string(after.committed - before.committed) + " new loads, at " + after.url);
}

}  // namespace

int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc < 5) {
      fprintf(stderr, "usage: %s <http://127.0.0.1:PORT/> <cache folder> <output folder> <http://127.0.0.1:OTHER/>\n", argv[0]);
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
    NSString *output = @(argv[3]);
    NSString *other = @(argv[4]);
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
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
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1024, 768)
                                                   styleMask:NSWindowStyleMaskBorderless
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    window.releasedWhenClosed = NO;
    NSView *parent = window.contentView;
    std::thread([=] {
      const std::string first = std::string(base.UTF8String) + "article.html";
      __block bool created = false;
      OnMain(^{
        created = sm_chromium_create("export-check", (__bridge void *)parent, first.c_str(), "", 0, 0, 1024, 768) != 0;
        // Hidden, as a tab the user is not looking at.
        if (created) sm_chromium_layout("export-check", 0, 0, 1024, 768, 0, 0, 0, 768, 0, nullptr, 0, nullptr);
      });
      if (!created) {
        Report(false, "a hidden page opens", sm_chromium_last_error());
      } else {
        const bool loaded = WaitUntil(^{
          const Load now = Read();
          return now.committed > 0 && now.settled > 0 && !now.loading;
        }, 8000);
        Report(loaded && Read().url == first, "the article loads hidden", Read().url);
        if (loaded) Check(base, other, output);
      }
      usleep(1000000);
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
