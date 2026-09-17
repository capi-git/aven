#import <Foundation/Foundation.h>
#include <cstdio>
#include <cstring>
#include "agent_dom_request.h"
#include "include/cef_api_hash.h"
#include "include/wrapper/cef_library_loader.h"

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
    std::puts("Passed: snapshot, fill and click retain owned requests after parent release");
    // Dynamic CEF wrapper objects are destroyed before process exit. The
    // framework stays loaded, as in the application's lifetime policy.
    return 0;
  }
}
