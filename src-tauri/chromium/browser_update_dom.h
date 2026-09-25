#pragma once
#include <string>
#include <vector>
#include "include/cef_values.h"

namespace supermono {
// Isolated-world JS cannot see closed shadow roots. Inspect only their presence
// in the trusted protocol tree; never expose this tree or its field attributes.
inline std::string BrowserUpdateDomBlocker(CefRefPtr<CefDictionaryValue> root) {
  if (!root || !root->IsValid()) return "unknown-page-state";
  std::vector<CefRefPtr<CefDictionaryValue>> pending{root};
  size_t count=0;
  while (!pending.empty()) {
    auto node=pending.back(); pending.pop_back();
    if (++count>20000) return "complex-page";
    if (!node || node->GetType("nodeName")!=VTYPE_STRING) return "unknown-page-state";
    if (node->HasKey("shadowRootType")) {
      if (node->GetType("shadowRootType")!=VTYPE_STRING) return "unknown-page-state";
      const auto kind=node->GetString("shadowRootType").ToString();
      if (kind=="closed") return "editable-page";
      if (kind=="user-agent") continue; // Native internals of an ordinary input.
      if (kind!="open") return "unknown-page-state";
    }
    for (const char* key : {"children", "shadowRoots", "pseudoElements"}) {
      if (!node->HasKey(key)) continue;
      if (node->GetType(key)!=VTYPE_LIST) return "unknown-page-state";
      auto children=node->GetList(key);
      if (children->GetSize()>20000-count) return "complex-page";
      for (size_t i=0;i<children->GetSize();++i) {
        if (children->GetType(i)!=VTYPE_DICTIONARY) return "unknown-page-state";
        pending.push_back(children->GetDictionary(i));
      }
    }
    if (node->HasKey("contentDocument")) {
      if (node->GetType("contentDocument")!=VTYPE_DICTIONARY) return "unknown-page-state";
      pending.push_back(node->GetDictionary("contentDocument"));
    }
  }
  return "";
}
}
