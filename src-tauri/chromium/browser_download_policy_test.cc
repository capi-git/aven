#include <cstdio>
#include <cstdlib>
#include "browser_download_policy.h"

#define CHECK(condition) do { \
  if (!(condition)) { \
    std::fprintf(stderr, "Browser download policy check failed at line %d: %s\n", \
                 __LINE__, #condition); \
    std::abort(); \
  } \
} while (false)

int main() {
  using namespace supermono;
  // Images, documents and media save without asking, in any case.
  for (const char* name : {"photo.png", "PHOTO.JPG", "a.b.webp", "report.pdf", "notes.md",
                           "Export-abc.zip", "clip.mov", "deck.pptx"})
    CHECK(DownloadSavesQuietly(name));
  // Anything that can run, and anything unknown, still asks.
  for (const char* name : {"Setup.dmg", "tool.pkg", "App.app", "run.command", "run.sh", "x.py",
                           "photo.png.app", "photo.png.command", "macro.docm", "x.jar", "x.exe",
                           "archive.tar.gz", "noextension", ".png", "trailing."})
    CHECK(!DownloadSavesQuietly(name));

  // A bare id goes by the type the site reports, and nothing else does.
  CHECK(QuietDownloadName("f177a90d-605b-4e29", "image/png") == "f177a90d-605b-4e29.png");
  CHECK(QuietDownloadName("f177a90d-605b-4e29", "IMAGE/JPEG; charset=binary") == "f177a90d-605b-4e29.jpg");
  CHECK(QuietDownloadName("photo.png", "application/octet-stream") == "photo.png");
  CHECK(QuietDownloadName("f177a90d", "application/octet-stream").empty());
  CHECK(QuietDownloadName("f177a90d", "").empty());
  CHECK(QuietDownloadName("Setup", "application/x-apple-diskimage").empty());
  CHECK(QuietDownloadName("photo.app", "image/png").empty());
  CHECK(QuietDownloadName("run.command", "text/plain").empty());
  CHECK(QuietDownloadName(".png", "image/png").empty());
  CHECK(QuietDownloadName("trailing.", "image/png").empty());

  CHECK(NumberedDownloadName("photo.png", 2) == "photo 2.png");
  CHECK(NumberedDownloadName("a.b.png", 3) == "a.b 3.png");
  CHECK(NumberedDownloadName("Download", 2) == "Download 2");

  const unsigned char macho[] = {0xcf, 0xfa, 0xed, 0xfe, 0x07};
  const unsigned char fat[] = {0xca, 0xfe, 0xba, 0xbe};
  const unsigned char script[] = {'#', '!', '/', 'b', 'i', 'n'};
  const unsigned char installer[] = {'x', 'a', 'r', '!'};
  const unsigned char png[] = {0x89, 'P', 'N', 'G', 0x0d, 0x0a};
  const unsigned char jpeg[] = {0xff, 0xd8, 0xff, 0xe0};
  const unsigned char zip[] = {'P', 'K', 0x03, 0x04};
  const unsigned char text[] = {'#', ' ', 'T', 'i', 't', 'l', 'e'};
  CHECK(DownloadLooksRunnable(macho, sizeof macho));
  CHECK(DownloadLooksRunnable(fat, sizeof fat));
  CHECK(DownloadLooksRunnable(script, sizeof script));
  CHECK(DownloadLooksRunnable(installer, sizeof installer));
  CHECK(!DownloadLooksRunnable(png, sizeof png));
  CHECK(!DownloadLooksRunnable(jpeg, sizeof jpeg));
  CHECK(!DownloadLooksRunnable(zip, sizeof zip));
  CHECK(!DownloadLooksRunnable(text, sizeof text));
  CHECK(!DownloadLooksRunnable(script, 1));
  return 0;
}
