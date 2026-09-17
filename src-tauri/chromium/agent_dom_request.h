#pragma once

#include "include/cef_values.h"

namespace supermono {
// GetDictionary returns parent-owned data. Asynchronous operations must hold an
// independent value after the command dictionary has been released.
inline CefRefPtr<CefDictionaryValue> OwnAgentDomRequest(
    CefRefPtr<CefDictionaryValue> request) {
  return request && request->IsValid() ? request->Copy(false) : nullptr;
}
}  // namespace supermono
