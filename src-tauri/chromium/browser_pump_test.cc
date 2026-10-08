#include "browser_pump.h"
#include <cstdio>
#include <cstdlib>

#define CHECK(condition) do { if (!(condition)) { \
  std::fprintf(stderr,"Browser pump failure at %d: %s\n",__LINE__,#condition); \
  std::abort(); } } while (false)

int main() {
  using namespace supermono;
  CHECK(BrowserPumpDelayMs(kBrowserPumpFallback, true) == 33);
  CHECK(BrowserPumpDelayMs(kBrowserPumpFallback, false) == 250);
  for (const bool foreground : {false, true}) {
    CHECK(BrowserPumpDelayMs(-1, foreground) == 0);
    CHECK(BrowserPumpDelayMs(0, foreground) == 0);
    CHECK(BrowserPumpDelayMs(1, foreground) == 1);
    CHECK(BrowserPumpDelayMs(16, foreground) == 16);
    CHECK(BrowserPumpDelayMs(1000, foreground) == 33);
  }
}
