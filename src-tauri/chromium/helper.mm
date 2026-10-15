#include <cstring>
#include <vector>

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
  // Chromium asks child processes of unbranded builds to run its stack
  // sampling profiler. Nothing reads or uploads those samples here, and the
  // profiler wakes each process periodically, so leave it off.
  std::vector<char *> args;
  for (int i = 0; i < argc; ++i)
    if (std::strncmp(argv[i], "--start-stack-profiler", 22) != 0)
      args.push_back(argv[i]);
  args.push_back(nullptr);
  return CefExecuteProcess(
      CefMainArgs(static_cast<int>(args.size()) - 1, args.data()), nullptr,
      nullptr);
}
