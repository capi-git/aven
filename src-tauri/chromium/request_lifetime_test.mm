#import <Foundation/Foundation.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include "agent_dom_request.h"
#include "browser_edit_data.h"
#include "include/cef_api_hash.h"
#include "include/wrapper/cef_library_loader.h"

#define LIFETIME_CHECK(condition) do { \
  if (!(condition)) { \
    std::fprintf(stderr, "CEF lifetime check failed at line %d: %s\n", __LINE__, #condition); \
    std::abort(); \
  } \
} while (false)

static CefRefPtr<CefDictionaryValue> RuntimeSelectionResponse() {
  auto selection = CefDictionaryValue::Create();
  selection->SetString("selector", "#selected-heading");
  selection->SetString("text", "Selected heading");
  auto rect = CefDictionaryValue::Create();
  rect->SetDouble("x", 40.25);
  rect->SetDouble("width", 200.5);
  auto capture = CefDictionaryValue::Create();
  capture->SetDictionary("rect", rect);
  auto value = CefDictionaryValue::Create();
  value->SetDictionary("selection", selection);
  value->SetDictionary("capture", capture);
  auto remote = CefDictionaryValue::Create();
  remote->SetDictionary("value", value);
  auto response = CefDictionaryValue::Create();
  response->SetDictionary("result", remote);
  return response;
}

static void BrowserEditLifetime() {
  auto response = RuntimeSelectionResponse();
  auto value = response->GetDictionary("result")->GetDictionary("value");
  auto borrowed_selection = value->GetDictionary("selection");
  auto borrowed_capture = value->GetDictionary("capture");
  auto selection = supermono::OwnBrowserEditData(borrowed_selection);
  auto capture = supermono::OwnBrowserEditData(borrowed_capture);
  LIFETIME_CHECK(selection && capture && !selection->IsOwned() && !capture->IsOwned());

  int capture_callbacks = 0, comment_callbacks = 0;
  std::function<void()> add_comment;
  std::function<void()> finish_capture = [selection, capture, &capture_callbacks,
                                         &comment_callbacks, &add_comment] {
    ++capture_callbacks;
    LIFETIME_CHECK(selection->IsValid() && capture->IsValid());
    LIFETIME_CHECK(selection->GetString("selector") == "#selected-heading");
    LIFETIME_CHECK(capture->GetDictionary("rect")->GetDouble("x") == 40.25);
    // Models CaptureEditElement constructing the post-screenshot envelope.
    auto screenshot = CefDictionaryValue::Create();
    screenshot->SetString("dataUrl", "synthetic screenshot payload");
    screenshot->SetInt("width", 401);
    screenshot->SetInt("height", 80);
    auto target = CefDictionaryValue::Create();
    target->SetDouble("x", .125);
    auto envelope = CefDictionaryValue::Create();
    LIFETIME_CHECK(envelope->SetDictionary("selection", selection));
    LIFETIME_CHECK(envelope->SetDictionary("screenshot", screenshot));
    LIFETIME_CHECK(envelope->SetDictionary("target", target));

    auto borrowed_image = envelope->GetDictionary("screenshot");
    auto final_selection = supermono::OwnBrowserEditData(envelope->GetDictionary("selection"));
    auto final_image = supermono::OwnBrowserEditData(borrowed_image);
    auto final_target = supermono::OwnBrowserEditData(envelope->GetDictionary("target"));
    LIFETIME_CHECK(final_selection && final_image && final_target);
    // Models clicking Add to chat long after the capture callback has returned.
    add_comment = [final_selection, final_image, final_target, &comment_callbacks] {
      ++comment_callbacks;
      LIFETIME_CHECK(final_selection->IsValid() && !final_selection->IsOwned());
      LIFETIME_CHECK(final_image->IsValid() && !final_image->IsOwned());
      LIFETIME_CHECK(final_target->IsValid() && !final_target->IsOwned());
      LIFETIME_CHECK(final_selection->GetString("text") == "Selected heading");
      LIFETIME_CHECK(final_image->GetInt("width") == 401);
      LIFETIME_CHECK(final_image->GetString("dataUrl") == "synthetic screenshot payload");
      LIFETIME_CHECK(final_target->GetDouble("x") == .125);
    };
    envelope = nullptr;
    LIFETIME_CHECK(!borrowed_image->IsValid());
    LIFETIME_CHECK(!supermono::OwnBrowserEditData(borrowed_image));
  };
  // Runtime.callFunctionOn releases its response before the asynchronous
  // hide-highlight/screenshot completion. A retained child is still invalid.
  response = nullptr;
  LIFETIME_CHECK(!value->IsValid() && !borrowed_selection->IsValid() && !borrowed_capture->IsValid());
  LIFETIME_CHECK(!supermono::OwnBrowserEditData(borrowed_selection));
  LIFETIME_CHECK(!supermono::OwnBrowserEditData(borrowed_capture));
  selection = nullptr;
  capture = nullptr;
  LIFETIME_CHECK(capture_callbacks == 0 && comment_callbacks == 0);
  finish_capture();
  finish_capture = nullptr;
  LIFETIME_CHECK(capture_callbacks == 1 && comment_callbacks == 0);
  LIFETIME_CHECK(add_comment);
  add_comment();
  add_comment = nullptr;
  LIFETIME_CHECK(comment_callbacks == 1);
  LIFETIME_CHECK(!supermono::OwnBrowserEditData(nullptr));
}

int main(int argc, char** argv) {
  @autoreleasepool {
    if (argc != 2 || !cef_load_library(argv[1])) {
      std::fprintf(stderr, "Could not load the test CEF library\n");
      return 1;
    }
    // Select the versioned C API without starting Chromium. CefInitialize
    // normally performs this handshake before the application uses values.
    const char* api_hash = cef_api_hash(CEF_API_VERSION, 0);
    if (!api_hash || std::strcmp(api_hash, CEF_API_HASH_PLATFORM) != 0) return 1;
    for (const char* action : {"snapshot", "fill", "click"}) {
      auto command = CefDictionaryValue::Create();
      auto payload = CefDictionaryValue::Create();
      payload->SetString("action", action);
      payload->SetString("ref", "fixture-ref");
      payload->SetString("value", "synthetic fixture value");
      payload->SetDictionary("empty", CefDictionaryValue::Create());
      command->SetDictionary("request", payload);
      auto borrowed = command->GetDictionary("request");
      auto owned = supermono::OwnAgentDomRequest(borrowed);
      // Models the first-use EnsureWorld callback running after sm_command
      // returns and releases its parsed parent command.
      command = nullptr;
      if (borrowed->IsValid() || !owned || !owned->IsValid() ||
          owned->IsOwned() || owned->GetString("action") != action ||
          owned->GetString("value") != "synthetic fixture value" ||
          !owned->HasKey("empty") || owned->GetDictionary("empty")->GetSize() != 0) {
        std::fprintf(stderr, "Agent request did not survive parent release\n");
        return 1;
      }
    }
    if (supermono::OwnAgentDomRequest(nullptr)) return 1;
    BrowserEditLifetime();
    std::puts("Passed: snapshot, fill and click retain owned requests after parent release");
    std::puts("Passed: browser edit capture and delayed comment retain copied data after both parent releases");
    // Dynamic CEF wrapper objects are destroyed before process exit. The
    // framework stays loaded, as in the application's lifetime policy.
    return 0;
  }
}
