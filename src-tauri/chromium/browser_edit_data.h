#pragma once

#include "include/cef_values.h"

namespace supermono {
// CEF child dictionaries returned by GetDictionary borrow their parent's
// storage. Ref-counting that child does not keep the parent storage alive.
// Copy before any asynchronous capture or user annotation callback.
inline CefRefPtr<CefDictionaryValue> OwnBrowserEditData(
    CefRefPtr<CefDictionaryValue> value) {
  return value && value->IsValid() ? value->Copy(false) : nullptr;
}
}  // namespace supermono
