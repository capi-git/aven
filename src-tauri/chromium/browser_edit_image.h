#pragma once
#import <Foundation/Foundation.h>
#include "browser_edit_capture.h"

namespace supermono {
// The incoming image is a screenshot of the existing viewport. These limits
// apply before ImageIO decodes pixels; final attachments use the smaller
// kEditCaptureMax* limits from browser_edit_capture.h.
constexpr uint32_t kEditViewportMaxEdge = 16384;
constexpr uint64_t kEditViewportMaxPixels = 32 * 1024 * 1024;
constexpr size_t kEditViewportMaxBase64 = 12 * 1024 * 1024;
constexpr size_t kEditViewportMaxBytes = kEditViewportMaxBase64 / 4 * 3;

// Crop a top-left-origin normalized selection from the actual screenshot
// pixels. Retina density and per-tab zoom are already present in those pixels.
// Returns a newly encoded, bounded PNG with no source metadata, or nil.
// Width and height are zero on failure; no files or browser state are changed.
NSData *CropBrowserEditImage(NSData *png, BrowserRect normalizedTarget,
                            uint32_t &width, uint32_t &height);
}  // namespace supermono
