#pragma once
#include <algorithm>
#include <array>
#include <cctype>
#include <cstddef>
#include <string>

namespace supermono {

// Which downloads save straight to the download folder, with no Save As
// chooser, so an agent working in a page isn't stopped by one. Only kinds of
// file that open in another app as data: an app, installer, script or
// anything unknown still asks the person.
inline std::string DownloadExtension(const std::string& name) {
  const auto dot = name.rfind('.');
  if (dot == std::string::npos || dot == 0 || dot + 1 == name.size()) return {};
  std::string extension = name.substr(dot + 1);
  std::transform(extension.begin(), extension.end(), extension.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return extension;
}

inline bool DownloadSavesQuietly(const std::string& name) {
  static constexpr std::array<const char*, 29> kQuiet = {
      "png", "jpg", "jpeg", "gif", "webp", "avif", "heic", "heif", "svg", "bmp",
      "tif", "tiff", "pdf", "txt", "md", "csv", "tsv", "json", "mp4", "mov",
      "webm", "m4a", "mp3", "wav", "zip", "docx", "xlsx", "pptx", "ico"};
  const auto extension = DownloadExtension(name);
  return std::any_of(kQuiet.begin(), kQuiet.end(),
                     [&](const char* quiet) { return extension == quiet; });
}

// The ending for a data file the site reports by type: a signed link often
// names an image with a bare id. Empty for any other type.
inline std::string DownloadExtensionForType(std::string type) {
  type = type.substr(0, type.find(';'));
  std::transform(type.begin(), type.end(), type.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  static constexpr std::array<std::array<const char*, 2>, 16> kTypes = {{
      {"image/png", "png"}, {"image/jpeg", "jpg"}, {"image/gif", "gif"},
      {"image/webp", "webp"}, {"image/avif", "avif"}, {"image/heic", "heic"},
      {"image/svg+xml", "svg"}, {"image/bmp", "bmp"}, {"image/tiff", "tiff"},
      {"application/pdf", "pdf"}, {"text/plain", "txt"}, {"text/csv", "csv"},
      {"application/json", "json"}, {"application/zip", "zip"},
      {"video/mp4", "mp4"}, {"video/quicktime", "mov"}}};
  for (const auto& known : kTypes)
    if (type == known[0]) return known[1];
  return {};
}

// The name to save quietly as, or empty when the person should be asked. A
// name's own ending decides; only a name with no ending goes by the type, so
// "photo.app" sent as an image still asks.
inline std::string QuietDownloadName(const std::string& name, const std::string& type) {
  if (DownloadSavesQuietly(name)) return name;
  if (!DownloadExtension(name).empty() || name.empty() || name.front() == '.' || name.back() == '.')
    return {};
  const auto extension = DownloadExtensionForType(type);
  return extension.empty() ? std::string{} : name + "." + extension;
}

// "photo.png" as "photo 2.png", for a name already taken: a quiet download
// never replaces a file.
inline std::string NumberedDownloadName(const std::string& name, int number) {
  const auto suffix = " " + std::to_string(number);
  const auto dot = name.rfind('.');
  if (dot == std::string::npos || dot == 0) return name + suffix;
  return name.substr(0, dot) + suffix + name.substr(dot);
}

// A file saved quietly must really be data, whatever its name says: a program
// or script behind an image's name is removed. It reads the file's first
// bytes, so it catches a disguised program, not every harmful file.
inline bool DownloadLooksRunnable(const unsigned char* bytes, std::size_t length) {
  if (length < 2) return false;
  if (bytes[0] == '#' && bytes[1] == '!') return true;
  if (length < 4) return false;
  const unsigned int magic = (static_cast<unsigned int>(bytes[0]) << 24) |
                             (static_cast<unsigned int>(bytes[1]) << 16) |
                             (static_cast<unsigned int>(bytes[2]) << 8) | bytes[3];
  switch (magic) {
    case 0xfeedface:  // Mac programs, either byte order.
    case 0xfeedfacf:
    case 0xcefaedfe:
    case 0xcffaedfe:
    case 0xcafebabe:
    case 0xbebafeca:
    case 0x7f454c46:  // Linux programs.
    case 0x78617221:  // Mac installers ("xar!").
      return true;
    default:
      return false;
  }
}

}  // namespace supermono
