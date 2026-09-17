#import "browser_edit_image.h"
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>
#include <array>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <vector>

#define CHECK(condition) do { \
  if (!(condition)) { \
    std::fprintf(stderr, "Edit image check failed at line %d: %s\n", __LINE__, #condition); \
    std::abort(); \
  } \
} while (false)

using namespace supermono;
using Pixel = std::array<unsigned char,4>;
constexpr Pixel red{255,0,0,255}, green{0,255,0,255}, blue{0,0,255,255}, yellow{255,255,0,255};

static NSData *ImagePNG(size_t width, size_t height, bool noise = false) {
  NSMutableData *pixels = [NSMutableData dataWithLength:width*height*4];
  auto bytes = static_cast<unsigned char *>(pixels.mutableBytes);
  uint32_t random = 492947;
  for (size_t y=0; y<height; ++y) {
    for (size_t x=0; x<width; ++x) {
      Pixel pixel = y<height/2 ? (x<width/2 ? red : green) : (x<width/2 ? blue : yellow);
      if (noise) {
        for (int c=0;c<3;++c) {
          random ^= random << 13; random ^= random >> 17; random ^= random << 5;
          pixel[c] = random & 255;
        }
      }
      std::memcpy(bytes+(y*width+x)*4, pixel.data(),4);
    }
  }
  CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)pixels);
  CGColorSpaceRef color = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGImageRef image = CGImageCreate(width,height,8,32,width*4,color,
      static_cast<CGBitmapInfo>(kCGImageAlphaPremultipliedLast) | kCGBitmapByteOrder32Big,provider,nullptr,false,kCGRenderingIntentDefault);
  CHECK(image);
  NSMutableData *png = [NSMutableData data];
  CGImageDestinationRef destination = CGImageDestinationCreateWithData(
      (__bridge CFMutableDataRef)png,CFSTR("public.png"),1,nullptr);
  CHECK(destination);
  CGImageDestinationAddImage(destination,image,nullptr);
  CHECK(CGImageDestinationFinalize(destination));
  CFRelease(destination); CGImageRelease(image); CGColorSpaceRelease(color); CGDataProviderRelease(provider);
  return png;
}

static Pixel ReadPixel(NSData *png, size_t x, size_t y) {
  CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)png,nullptr);
  CHECK(source);
  CGImageRef image = CGImageSourceCreateImageAtIndex(source,0,nullptr);
  CHECK(image && x<CGImageGetWidth(image) && y<CGImageGetHeight(image));
  // Crop one raster pixel before color conversion. It avoids any CGContext
  // axis convention affecting the expected top-left PNG coordinate.
  CGImageRef pixelImage = CGImageCreateWithImageInRect(image,CGRectMake(x,y,1,1));
  CGColorSpaceRef color = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  Pixel pixel{};
  CGContextRef context = CGBitmapContextCreate(pixel.data(),1,1,8,4,color,
      static_cast<CGBitmapInfo>(kCGImageAlphaPremultipliedLast) | kCGBitmapByteOrder32Big);
  CHECK(context);
  CGContextDrawImage(context,CGRectMake(0,0,1,1),pixelImage);
  CGContextRelease(context); CGColorSpaceRelease(color); CGImageRelease(pixelImage);
  CGImageRelease(image); CFRelease(source);
  return pixel;
}

static void KnownPixelsAndOrientation() {
  NSData *png = ImagePNG(8,8);
  struct Sample { BrowserRect target; Pixel pixel; };
  const Sample samples[] = {{{0,0,.5,.5},red}, {{.5,0,.5,.5},green},
      {{0,.5,.5,.5},blue}, {{.5,.5,.5,.5},yellow}};
  for (const auto &sample : samples) {
    uint32_t width=0,height=0;
    NSData *crop = CropBrowserEditImage(png,sample.target,width,height);
    CHECK(crop && width==4 && height==4);
    CHECK(ReadPixel(crop,0,0) == sample.pixel);
    CHECK(ReadPixel(crop,3,3) == sample.pixel);
  }
  uint32_t width=0,height=0;
  NSData *whole = CropBrowserEditImage(png,{0,0,1,1},width,height);
  CHECK(whole && width==8 && height==8);
  CHECK(ReadPixel(whole,0,0)==red && ReadPixel(whole,7,0)==green);
  CHECK(ReadPixel(whole,0,7)==blue && ReadPixel(whole,7,7)==yellow);
}

static void FractionalAndRetinaTargets() {
  uint32_t width=0,height=0;
  NSData *crop = CropBrowserEditImage(ImagePNG(8,8),{.3875,.3875,.2125,.2125},width,height);
  CHECK(crop && width==2 && height==2);
  CHECK(ReadPixel(crop,0,0)==red && ReadPixel(crop,1,0)==green);
  CHECK(ReadPixel(crop,0,1)==blue && ReadPixel(crop,1,1)==yellow);
  // The same normalized target is applied to actual screenshot pixels, so
  // Retina density and page zoom do not require a second coordinate scale.
  crop = CropBrowserEditImage(ImagePNG(16,12),{.5,0,.5,.5},width,height);
  CHECK(crop && width==8 && height==6 && ReadPixel(crop,0,0)==green);
  crop = CropBrowserEditImage(ImagePNG(8,8),{.5,.5,.50000001,.50000001},width,height);
  CHECK(crop && width==4 && height==4 && ReadPixel(crop,3,3)==yellow);
}

static NSData *Header(uint32_t width, uint32_t height) {
  unsigned char header[]{137,80,78,71,13,10,26,10,0,0,0,13,'I','H','D','R',0,0,0,0,0,0,0,0};
  for (size_t i=0;i<4;++i) { header[16+i]=(width>>(24-i*8))&255; header[20+i]=(height>>(24-i*8))&255; }
  return [NSData dataWithBytes:header length:sizeof(header)];
}

static void InvalidInputsAndBounds() {
  NSData *png = ImagePNG(8,8);
  const double nan = std::numeric_limits<double>::quiet_NaN();
  const double inf = std::numeric_limits<double>::infinity();
  const BrowserRect bad[] = {{nan,0,.5,.5}, {0,inf,.5,.5}, {0,0,nan,.5}, {0,0,.5,inf},
      {-.1,0,.5,.5}, {0,-.1,.5,.5}, {0,0,0,.5}, {0,0,.5,-.1},
      {.9,0,.2,.5}, {0,.9,.5,.2}, {1,0,1e-8,.5}, {0,1,.5,1e-8}};
  for (const auto target : bad) {
    uint32_t width=42,height=42;
    CHECK(CropBrowserEditImage(png,target,width,height)==nil && width==0 && height==0);
  }
  uint32_t width=42,height=42;
  CHECK(CropBrowserEditImage(nil,{0,0,1,1},width,height)==nil && !width && !height);
  for (NSData *invalid in @[[NSData data], [@"not an image" dataUsingEncoding:NSUTF8StringEncoding],
      Header(0,8), Header(8,0), Header(kEditViewportMaxEdge+1,1),
      Header(8192,4097), Header(0xffffffff,0xffffffff), Header(8,8)]) {
    width=height=42;
    CHECK(CropBrowserEditImage(invalid,{0,0,1,1},width,height)==nil && !width && !height);
  }
  NSMutableData *oversized = [NSMutableData dataWithLength:kEditViewportMaxBytes+1];
  [oversized replaceBytesInRange:NSMakeRange(0,24) withBytes:Header(8,8).bytes];
  CHECK(CropBrowserEditImage(oversized,{0,0,1,1},width,height)==nil && !width && !height);
}

static void DownsampleLimitsAndOrientation() {
  uint32_t width=0,height=0;
  NSData *crop = CropBrowserEditImage(ImagePNG(4500,2400),{0,0,1,1},width,height);
  CHECK(crop && width<4500 && height<2400);
  CHECK(width<=kEditCaptureMaxEdge && height<=kEditCaptureMaxEdge);
  CHECK(uint64_t(width)*height<=kEditCaptureMaxPixels);
  CHECK(std::abs(double(width)/height - 4500.0/2400)<.002);
  CHECK(ReadPixel(crop,0,0)==red && ReadPixel(crop,width-1,0)==green);
  CHECK(ReadPixel(crop,0,height-1)==blue && ReadPixel(crop,width-1,height-1)==yellow);
  CHECK(((crop.length+2)/3)*4<=kEditCaptureMaxBase64);
  crop = CropBrowserEditImage(ImagePNG(5000,100),{0,0,1,1},width,height);
  CHECK(crop && width==4096 && height<100);
  CHECK(ReadPixel(crop,0,0)==red && ReadPixel(crop,width-1,height-1)==yellow);
}

static void EncodedAttachmentLimit() {
  NSData *noisy = ImagePNG(1600,1200,true);
  CHECK(noisy.length < kEditViewportMaxBytes && ((noisy.length+2)/3)*4>kEditCaptureMaxBase64);
  uint32_t width=42,height=42;
  CHECK(CropBrowserEditImage(noisy,{0,0,1,1},width,height)==nil && !width && !height);
  // A small selected area is still usable from that same large viewport PNG.
  NSData *crop = CropBrowserEditImage(noisy,{0,0,.1,.1},width,height);
  CHECK(crop && width==160 && height==120);
}

int main() {
  @autoreleasepool {
    KnownPixelsAndOrientation();
    FractionalAndRetinaTargets();
    InvalidInputsAndBounds();
    DownsampleLimitsAndOrientation();
    EncodedAttachmentLimit();
    std::puts("Browser edit image: 5 ImageIO crop checks passed");
  }
  return 0;
}
