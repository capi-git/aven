#import <Foundation/Foundation.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "browser_update_dom.h"
#include "include/cef_api_hash.h"
#include "include/wrapper/cef_library_loader.h"
#define UPDATE_CHECK(condition) do { if (!(condition)) { std::fprintf(stderr,"Update DOM failure at %d: %s\n",__LINE__,#condition); std::abort(); } } while (false)
using Dict=CefRefPtr<CefDictionaryValue>;
static Dict Node(const char* name) { auto node=CefDictionaryValue::Create(); node->SetString("nodeName",name); return node; }
static void Child(Dict parent,const char* key,Dict child) { auto list=CefListValue::Create(); list->SetDictionary(0,child); parent->SetList(key,list); }
int main(int argc,char** argv) {
  @autoreleasepool {
    if (argc!=2 || !cef_load_library(argv[1])) return 1;
    const char* hash=cef_api_hash(CEF_API_VERSION,0);
    if (!hash || std::strcmp(hash,CEF_API_HASH_PLATFORM)!=0) return 1;
    auto page=Node("#document"); auto ordinary=Node("REACT-PARTIAL"); Child(page,"children",ordinary);
    UPDATE_CHECK(supermono::BrowserUpdateDomBlocker(page).empty());
    auto shadow=Node("#document-fragment"); shadow->SetString("shadowRootType","closed");
    auto div=Node("DIV"); Child(div,"shadowRoots",shadow); Child(page,"children",div);
    UPDATE_CHECK(supermono::BrowserUpdateDomBlocker(page)=="editable-page");
    shadow=Node("#document-fragment"); shadow->SetString("shadowRootType","user-agent");
    auto input=Node("INPUT"); Child(input,"shadowRoots",shadow); Child(page,"children",input);
    UPDATE_CHECK(supermono::BrowserUpdateDomBlocker(page).empty());
    auto bad=Node("DIV"); bad->SetString("children","invalid"); Child(page,"children",bad);
    UPDATE_CHECK(supermono::BrowserUpdateDomBlocker(page)=="unknown-page-state");
    UPDATE_CHECK(supermono::BrowserUpdateDomBlocker(nullptr)=="unknown-page-state");
    auto large=Node("#document"); auto children=CefListValue::Create(); children->SetSize(20001); large->SetList("children",children);
    UPDATE_CHECK(supermono::BrowserUpdateDomBlocker(large)=="complex-page");
    std::puts("Passed: ordinary custom tags, closed shadows, user-agent roots, malformed and bounded DOM trees");
    return 0;
  }
}
