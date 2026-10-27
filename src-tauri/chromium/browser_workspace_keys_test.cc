#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "browser_workspace_keys.h"

#define CHECK(condition) do { \
  if (!(condition)) { \
    std::fprintf(stderr, "Workspace key check failed at line %d: %s\n", \
                 __LINE__, #condition); \
    std::abort(); \
  } \
} while (false)

static bool Is(const char* action, const char* expected) {
  return action && expected && std::strcmp(action, expected) == 0;
}

int main() {
  using supermono::WorkspaceKey;
  constexpr int kTab = 0x09, kW = 0x57, kZ = 0x5A, kA = 0x41, kPageUp = 0x21,
                kPageDown = 0x22;
  // Control-Tab steps the focused pane's tabs.
  CHECK(Is(WorkspaceKey(kTab, false, true, false, false), "next-tab"));
  CHECK(Is(WorkspaceKey(kTab, false, true, false, true), "prev-tab"));
  // Control-Option chords walk, expand and close panes.
  CHECK(Is(WorkspaceKey(kTab, false, true, true, false), "next-pane"));
  CHECK(Is(WorkspaceKey(kTab, false, true, true, true), "prev-pane"));
  CHECK(Is(WorkspaceKey(kZ, false, true, true, false), "zoom-pane"));
  CHECK(Is(WorkspaceKey(kW, false, true, true, false), "close-pane"));
  CHECK(Is(WorkspaceKey(kPageDown, false, true, true, false), "next-pane"));
  CHECK(Is(WorkspaceKey(kPageUp, false, true, true, false), "prev-pane"));
  CHECK(!WorkspaceKey(kPageDown, false, true, false, false));
  // Everything else stays with the page: plain and shifted letters, other
  // Control chords, Option alone, and Command keys (the menu has those).
  CHECK(!WorkspaceKey(kZ, false, true, true, true));
  CHECK(!WorkspaceKey(kA, false, true, true, false));
  CHECK(!WorkspaceKey(kZ, false, true, false, false));
  CHECK(!WorkspaceKey(kTab, false, false, true, false));
  CHECK(!WorkspaceKey(kTab, false, false, false, false));
  CHECK(!WorkspaceKey(kTab, true, true, true, false));
  CHECK(!WorkspaceKey(kW, true, false, false, false));
  std::puts("workspace keys ok");
  return 0;
}
