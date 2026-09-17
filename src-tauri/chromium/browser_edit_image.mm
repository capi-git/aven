#import "browser_edit_image.h"
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>
#include <algorithm>
#include <cmath>
#include <cstring>

namespace supermono {
namespace {
template <typename T> class OwnedCF {
 public:
  explicit OwnedCF(T value) : value_(value) {}
  ~OwnedCF() { if (value_) CFRelease(value_); }
  OwnedCF(const OwnedCF&) = delete;
  OwnedCF& operator=(const OwnedCF&) = delete;
  operator T() const { return value_; }
 private:
  T value_;
};

bool ViewportDimensions(NSData *png, uint32_t &width, uint32_t &height) {
  constexpr unsigned char signature[]{137,80,78,71,13,10,26,10};
  if (!png || png.length < 24 || png.length > kEditViewportMaxBytes) return false;
  const auto bytes = static_cast<const unsigned char *>(png.bytes);
  if (std::memcmp(bytes, signature, 8) || bytes[8] || bytes[9] || bytes[10] ||
      bytes[11] != 13 || std::memcmp(bytes + 12, "IHDR", 4)) return false;
  const auto number = [bytes](size_t at) {
    return uint32_t(bytes[at]) << 24 | uint32_t(bytes[at+1]) << 16 |
           uint32_t(bytes[at+2]) << 8 | uint32_t(bytes[at+3]);
  };
  width = number(16); height = number(20);
  return width && height && width <= kEditViewportMaxEdge && height <= kEditViewportMaxEdge &&
      uint64_t(width) * height <= kEditViewportMaxPixels;
}

bool ValidTarget(BrowserRect target) {
  return std::isfinite(target.x) && std::isfinite(target.y) &&
      std::isfinite(target.width) && std::isfinite(target.height) &&
      target.x >= 0 && target.x < 1 && target.y >= 0 && target.y < 1 &&
      target.width > 0 && target.height > 0 &&
      target.x + target.width <= 1 + 1e-6 && target.y + target.height <= 1 + 1e-6;
}
}  // namespace

NSData *CropBrowserEditImage(NSData *png, BrowserRect target, uint32_t &width, uint32_t &height) {
  width = height = 0;
  uint32_t sourceWidth = 0, sourceHeight = 0;
  if (!ValidTarget(target) || !ViewportDimensions(png, sourceWidth, sourceHeight)) return nil;
  NSDictionary *options = @{(__bridge NSString *)kCGImageSourceShouldCache:@NO};
  OwnedCF<CGImageSourceRef> source(CGImageSourceCreateWithData((__bridge CFDataRef)png,
      (__bridge CFDictionaryRef)options));
  if (!source || CGImageSourceGetCount(source) != 1 ||
      !CGImageSourceGetType(source) || !CFEqual(CGImageSourceGetType(source), CFSTR("public.png")) ||
      CGImageSourceGetStatus(source) != kCGImageStatusComplete) return nil;
  OwnedCF<CGImageRef> image(CGImageSourceCreateImageAtIndex(source, 0,
      (__bridge CFDictionaryRef)options));
  if (!image || CGImageGetWidth(image) != sourceWidth || CGImageGetHeight(image) != sourceHeight)
    return nil;
  const size_t left = std::floor(target.x * sourceWidth);
  const size_t top = std::floor(target.y * sourceHeight);
  const size_t right = std::min<double>(sourceWidth, std::ceil((target.x + target.width) * sourceWidth));
  const size_t bottom = std::min<double>(sourceHeight, std::ceil((target.y + target.height) * sourceHeight));
  if (right <= left || bottom <= top) return nil;
  const size_t cropWidth = right - left, cropHeight = bottom - top;
  OwnedCF<CGImageRef> cropped(CGImageCreateWithImageInRect(image,
      CGRectMake(left, top, cropWidth, cropHeight)));
  if (!cropped) return nil;

  const double scale = std::min({1.0, double(kEditCaptureMaxEdge) / cropWidth,
      double(kEditCaptureMaxEdge) / cropHeight,
      std::sqrt(double(kEditCaptureMaxPixels) / (double(cropWidth) * cropHeight))});
  const uint32_t outputWidth = std::max(1.0, std::floor(cropWidth * scale));
  const uint32_t outputHeight = std::max(1.0, std::floor(cropHeight * scale));
  const bool resize = outputWidth != cropWidth || outputHeight != cropHeight;
  OwnedCF<CGColorSpaceRef> colorSpace(resize ? CGColorSpaceCreateWithName(kCGColorSpaceSRGB) : nullptr);
  OwnedCF<CGContextRef> context(resize && colorSpace ? CGBitmapContextCreate(nullptr,
      outputWidth, outputHeight, 8, size_t(outputWidth) * 4, colorSpace,
      static_cast<CGBitmapInfo>(kCGImageAlphaPremultipliedLast) | kCGBitmapByteOrder32Big) : nullptr);
  if (resize && !context) return nil;
  if (resize) {
    CGContextSetInterpolationQuality(context, kCGInterpolationHigh);
    CGContextDrawImage(context, CGRectMake(0,0,outputWidth,outputHeight), cropped);
  }
  OwnedCF<CGImageRef> resized(resize ? CGBitmapContextCreateImage(context) : nullptr);
  if (resize && !resized) return nil;
  CGImageRef output = resize ? static_cast<CGImageRef>(resized) : static_cast<CGImageRef>(cropped);
  NSMutableData *encoded = [NSMutableData data];
  OwnedCF<CGImageDestinationRef> destination(CGImageDestinationCreateWithData(
      (__bridge CFMutableDataRef)encoded, CFSTR("public.png"), 1, nullptr));
  if (!destination) return nil;
  // Encoding just the CGImage intentionally drops metadata from the source PNG.
  CGImageDestinationAddImage(destination, output, nullptr);
  if (!CGImageDestinationFinalize(destination) || !encoded.length ||
      ((encoded.length + 2) / 3) * 4 > kEditCaptureMaxBase64) return nil;
  width = outputWidth;
  height = outputHeight;
  return [encoded copy];
}
}  // namespace supermono
