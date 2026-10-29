// Live check of the load signals an agent's open waits for, on a hidden page
// in the real Chromium bridge. `scripts/check-chromium-loads.py` builds this
// into a throwaway app bundle with the pinned CEF runtime, serves a local
// page and runs it under a throwaway home; see docs/DEVELOPMENT.md.
//
// The page lives in a window that is never shown, laid out hidden, as an
// agent's background page is. Its reloads and navigations must each report a
// committed document (loadsCommitted) and an ended load (loadsSettled) within
// a fraction of a second, and Chromium must not wait on the keychain.
#import <Cocoa/Cocoa.h>
#import <Security/Security.h>

#include <cstdio>
#include <cstdlib>
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
std::mutex state_lock;
Load state;
int failures = 0;

Load Read() {
  std::lock_guard<std::mutex> guard(state_lock);
  return state;
}

void OnEvent(const char *, const char *json, void *) {
  NSData *data = [NSData dataWithBytes:json length:strlen(json)];
  NSDictionary *event = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![event isKindOfClass:NSDictionary.class] || ![event[@"type"] isEqual:@"state"]) return;
  Load next;
  next.loading = [event[@"loading"] boolValue];
  next.committed = [event[@"loadsCommitted"] longValue];
  next.settled = [event[@"loadsSettled"] longValue];
  next.url = [event[@"url"] isKindOfClass:NSString.class] ? [event[@"url"] UTF8String] : "";
  std::lock_guard<std::mutex> guard(state_lock);
  state = next;
}

void OnMain(void (^block)(void)) { dispatch_sync(dispatch_get_main_queue(), block); }

bool Command(NSString *json) {
  __block int ok = 0;
  NSString *request = [NSUUID UUID].UUIDString;
  OnMain(^{ ok = sm_chromium_command("load-check", request.UTF8String, json.UTF8String); });
  return ok != 0;
}

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

// Start a load the way an agent's open does and time its two signals: the new
// document committed (or, for a fragment, the address changed) and the load
// ended. Both must come well inside the open's own waits.
void Step(const std::string& name, NSString *command, const std::string& expected_url) {
  // An open never starts a load while one is running.
  if (!WaitUntil(^{ return !Read().loading; }, 2000)) {
    Report(false, name, "the previous load was still running after 2 s");
    return;
  }
  const Load before = Read();
  const double start = Ms();
  if (!Command(command)) {
    Report(false, name, std::string("the bridge refused the command: ") + sm_chromium_last_error());
    return;
  }
  const bool landed = WaitUntil(^{ return Read().committed > before.committed; }, 1000);
  const double landing = Ms() - start;
  const bool ended = WaitUntil(^{
    const Load now = Read();
    return now.settled > before.settled && !now.loading;
  }, 2000);
  const double ending = Ms() - start;
  const Load after = Read();
  char detail[512];
  snprintf(detail, sizeof detail, "committed in %.0f ms, ended in %.0f ms at %s", landing, ending,
           after.url.c_str());
  Report(landed && ended && after.url == expected_url, name,
         landed && ended ? detail
                         : std::string(landed ? "never ended: " : "never committed: ") + detail);
}

}  // namespace

int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc < 3) {
      fprintf(stderr, "usage: %s <http://127.0.0.1:PORT/> <cache folder>\n", argv[0]);
      return 2;
    }
    started_at = [NSDate timeIntervalSinceReferenceDate];
    // Never a dialog: a keychain call that would need one fails at once, so a
    // switch that stopped reaching Chromium shows up as encryption being
    // unavailable (the runner reads Chromium's log), not as a prompt.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    SecKeychainSetUserInteractionAllowed(false);
#pragma clang diagnostic pop
    NSString *base = @(argv[1]);
    NSString *cache = @(argv[2]);
    [NSApplication sharedApplication];
    // No Dock icon, menu bar or keyboard focus.
    [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
    NSString *frameworks =
        [NSBundle.mainBundle.bundlePath stringByAppendingPathComponent:@"Contents/Frameworks"];
    NSDictionary *config = @{
      @"frameworkPath" : [frameworks stringByAppendingPathComponent:@"Chromium Embedded Framework.framework"],
      @"helperPath" : [frameworks stringByAppendingPathComponent:@"Load Check Helper.app/Contents/MacOS/Load Check Helper"],
      @"cachePath" : cache,
      @"downloadPath" : cache,
      @"devUrl" : @"",
      // As Aven Dev's checks do under their throwaway home.
      @"mockKeychain" : @YES,
    };
    NSData *json = [NSJSONSerialization dataWithJSONObject:config options:0 error:nil];
    NSString *text = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    if (!sm_chromium_initialize(text.UTF8String, OnEvent, nullptr)) {
      fprintf(stderr, "FAIL  Chromium starts - %s\n", sm_chromium_last_error());
      return 1;
    }
    // Never ordered on screen.
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1024, 768)
                                                   styleMask:NSWindowStyleMaskBorderless
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    window.releasedWhenClosed = NO;
    NSView *parent = window.contentView;
    std::thread([=] {
      const std::string first = std::string(base.UTF8String) + "index.html?mock=1";
      __block bool created = false;
      OnMain(^{
        created = sm_chromium_create("load-check", (__bridge void *)parent, first.c_str(), "", 0, 0,
                                     1024, 768) != 0;
        // Hidden, as an agent's background page is.
        if (created) sm_chromium_layout("load-check", 0, 0, 1024, 768, 0, 0, 0, 768, 0, nullptr, 0, nullptr);
      });
      if (!created) {
        Report(false, "a hidden page opens", sm_chromium_last_error());
      } else {
        const double start = Ms();
        const bool loaded = WaitUntil(^{
          const Load now = Read();
          return now.committed > 0 && now.settled > 0 && !now.loading;
        }, 5000);
        char detail[256];
        snprintf(detail, sizeof detail, "%s in %.0f ms (%ld committed, %ld ended)",
                 loaded ? "loaded" : "still loading", Ms() - start, Read().committed, Read().settled);
        Report(loaded && Read().url == first, "a hidden page loads its first address", detail);
        if (loaded) {
          Step("a reload commits and ends", @"{\"action\":\"reload\"}", first);
          const std::string query = first + "&v=2";
          Step("a navigation to another query commits and ends",
               [NSString stringWithFormat:@"{\"action\":\"navigate\",\"url\":\"%s\"}", query.c_str()], query);
          const std::string missing = std::string(base.UTF8String) + "alternative.html?mock=2";
          Step("a navigation to a missing file commits the server's 404 page and ends",
               [NSString stringWithFormat:@"{\"action\":\"navigate\",\"url\":\"%s\"}", missing.c_str()], missing);
          const std::string fragment = first + "#part";
          Step("a fragment on the same document counts as committed and ended",
               [NSString stringWithFormat:@"{\"action\":\"navigate\",\"url\":\"%s\"}", fragment.c_str()], fragment);
        }
      }
      OnMain(^{ sm_chromium_shutdown(); });
      // Shutdown finishes on the main thread; give it a moment, then report.
      usleep(1000000);
      printf("%s\n", failures ? "FAILED" : "PASSED");
      fflush(stdout);
      std::exit(failures ? 1 : 0);
    }).detach();
    [NSApp run];
  }
  return 0;
}
