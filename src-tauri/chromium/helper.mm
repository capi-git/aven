#include "include/cef_app.h"
#include "include/cef_sandbox_mac.h"
#include "include/wrapper/cef_library_loader.h"

// The sandbox must initialize before loading Chromium or Cocoa. This executable
// is bundled under all five CEF helper names; CEF selects its process role.
int main(int argc, char **argv) {
  CefScopedSandboxContext sandbox;
  if (!sandbox.Initialize(argc, argv)) return 1;
  CefScopedLibraryLoader loader;
  if (!loader.LoadInHelper()) return 1;
  return CefExecuteProcess(CefMainArgs(argc, argv), nullptr, nullptr);
}
