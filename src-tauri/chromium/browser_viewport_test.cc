#include "browser_viewport.h"
#include <cassert>
#include <iostream>

using supermono::BrowserRect;
using supermono::BrowserViewport;
using supermono::BrowserViewportFrame;
void same(BrowserRect actual,BrowserRect expected) {
  assert(actual.x==expected.x && actual.y==expected.y &&
         actual.width==expected.width && actual.height==expected.height);
}
int main() {
  // Captured child: WK height 720, DOM height 688, toolbar y73..113. The page
  // starts at WK y145, keeping all 40 toolbar points below the titlebar visible.
  const auto child=BrowserViewport({0,0,1000,720},688,true);
  same(BrowserViewportFrame(child,true,1,113,998,574),{1,145,998,574});
  // Captured main overlay deliberately renders beneath its native titlebar.
  const auto main=BrowserViewport({0,0,1440,900},900,true);
  same(BrowserViewportFrame(main,true,8,114,1424,754),{8,114,1424,754});
  // A WK view already inset below chrome must not receive the inset twice.
  const auto inset=BrowserViewport({0,0,1000,688},688,true);
  same(BrowserViewportFrame(inset,true,1,113,998,574),{1,113,998,574});
  // Measured geometry also handles other titlebar and toolbar heights.
  const auto chrome=BrowserViewport({0,0,1000,800},752,true);
  same(BrowserViewportFrame(chrome,true,5,120,990,600),{5,168,990,600});
  same(BrowserViewportFrame(BrowserViewport({0,0,1000,720},688,false),false,1,113,998,574),{1,1,998,574});
  same(BrowserViewport({0,0,800,600},0,true),{0,0,800,600});
  same(BrowserViewport({0,0,800,600},700,true),{0,0,800,600});
  std::cout << "7 browser viewport geometry checks passed\n";
}
