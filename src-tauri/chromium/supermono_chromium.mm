#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>
#include <crt_externs.h>
#include <algorithm>
#include <climits>
#include <cmath>
#include <functional>
#include <map>
#include <memory>
#include <limits>
#include <string>
#include <vector>

#include "supermono_chromium.h"
#include "browser_viewport.h"
#include "browser_host_view.h"
#include "browser_tab_zoom.h"
#include "browser_actions_menu.h"
#include "browser_drop_indicator.h"
#include "browser_edit_capture.h"
#include "browser_edit_image.h"
#include "browser_edit_annotation.h"
#include "browser_edit_data.h"
#include "agent_dom_request.h"
#include "agent_dom_source.h"
#include "browser_edit_source.h"
#include "include/cef_app.h"
#include "include/cef_application_mac.h"
#include "include/cef_client.h"
#include "include/cef_image.h"
#include "include/cef_parser.h"
#include "include/cef_request_context.h"
#include "include/wrapper/cef_library_loader.h"

@interface SMChromiumPump : NSObject
- (void)scheduleWork:(NSNumber*)delay;
- (void)timerFired:(NSTimer*)timer;
@end

namespace {
using Dict = CefRefPtr<CefDictionaryValue>;
using Value = CefRefPtr<CefValue>;
using Completion = std::function<void(bool, Dict)>;
class Page;
std::map<std::string, CefRefPtr<Page>> pages;
std::map<std::string, CefRefPtr<CefRequestContext>> profiles;
sm_chromium_event_cb event_callback = nullptr;
void *event_context = nullptr;
std::string last_error, cache_root, download_root, dev_origin;
bool initialized = false, stopping = false, library_loaded = false;
int live_browser_count = 0;
__strong SMChromiumPump *pump_handler=nil;
__strong NSTimer *pump_timer=nil;
bool pump_active=false,pump_reentered=false;
constexpr int64_t kPumpFallback=INT_MAX;
constexpr int64_t kPumpMaximumDelay=1000/30;
bool handling_send_event = false;
IMP original_send_event = nullptr;

std::string Str(NSString *s) { return s ? std::string(s.UTF8String ?: "") : ""; }
NSString *Ns(const std::string& s) { return [[NSString alloc] initWithBytes:s.data() length:s.size() encoding:NSUTF8StringEncoding] ?: @""; }
Dict Object() { return CefDictionaryValue::Create(); }
Value Box(Dict d) { auto v = CefValue::Create(); v->SetDictionary(d); return v; }
std::string Json(Dict d) { return CefWriteJSON(Box(d), JSON_WRITER_DEFAULT).ToString(); }
Dict Parse(const std::string& text) {
  auto value = CefParseJSON(text, JSON_PARSER_RFC);
  return value && value->GetType() == VTYPE_DICTIONARY ? value->GetDictionary() : nullptr;
}
std::string Text(Dict d, const char *key) { return d && d->GetType(key) == VTYPE_STRING ? d->GetString(key).ToString() : ""; }
double Number(Dict d, const char *key, double fallback = 0) {
  if (!d) return fallback;
  if (d->GetType(key) == VTYPE_DOUBLE) return d->GetDouble(key);
  if (d->GetType(key) == VTYPE_INT) return d->GetInt(key);
  return fallback;
}
bool Boolean(Dict d, const char *key, bool fallback = false) { return d && d->GetType(key) == VTYPE_BOOL ? d->GetBool(key) : fallback; }
Dict Error(const std::string& error) { auto d=Object(); d->SetString("error",error.substr(0,500)); return d; }
void Emit(const std::string& id, Dict d) {
  if (event_callback) { const auto json=Json(d); event_callback(id.c_str(),json.c_str(),event_context); }
}
void Result(const std::string& id, const std::string& request, bool ok, Dict value) {
  if (request.empty()) return;
  auto d=Object(); d->SetString("type","result"); d->SetString("requestId",request); d->SetBool("ok",ok);
  if (ok) d->SetDictionary("result", value ?: Object());
  else d->SetString("error", Text(value,"error").empty() ? "Chromium operation failed" : Text(value,"error"));
  Emit(id,d);
}
int Fail(const std::string& message) { last_error=message.substr(0,500); return 0; }
bool MainThread() { if (![NSThread isMainThread]) { Fail("Chromium calls require the macOS main thread"); return false; } return true; }
bool ValidId(const char *id) {
  if (!id || !*id || strlen(id)>160) return false;
  for (const unsigned char *p=(const unsigned char*)id;*p;++p) if (!(isalnum(*p) || *p=='-' || *p=='_' || *p=='.')) return false;
  return true;
}
std::string Origin(NSURL *url) {
  const auto scheme=Str(url.scheme.lowercaseString), host=Str(url.host.lowercaseString);
  if (scheme.empty() || host.empty()) return "";
  auto port=url.port ? url.port.integerValue : scheme=="https" ? 443 : 80;
  return scheme+"://"+host+":"+std::to_string(port);
}
bool AllowedUrl(const std::string& url, bool navigation = false, bool download = false) {
  if (url.size()>32768) return false;
  if (navigation && (url=="about:blank" || url=="about:srcdoc")) return true;
  if ((navigation || download) && url.rfind("blob:",0)==0) {
    if (download && url.rfind("blob:null/",0)==0) return true;
    return AllowedUrl(url.substr(5));
  }
  if (download && url.rfind("data:",0)==0) return true;
  NSURL *parsed=[NSURL URLWithString:Ns(url)];
  const auto scheme=Str(parsed.scheme.lowercaseString), host=Str(parsed.host.lowercaseString);
  return (scheme=="http" || scheme=="https") && !host.empty() && host!="tauri.localhost" && host!="asset.localhost" &&
    host!="ipc.localhost" && !parsed.user.length && !parsed.password.length && (dev_origin.empty() || Origin(parsed)!=dev_origin);
}
bool Geometry(double x,double y,double w,double h) {
  return std::isfinite(x)&&std::isfinite(y)&&std::isfinite(w)&&std::isfinite(h)&&w>=0&&h>=0&&w<=32768&&h<=32768;
}
NSRect Frame(NSView *parent,double x,double y,double w,double h) {
  return NSMakeRect(x,parent.flipped ? y : parent.bounds.size.height-y-h,w,h);
}
NSView *WorkspaceWebView(NSView *parent,NSUInteger depth=0) {
  Class webview=NSClassFromString(@"WKWebView");
  if (webview && [parent isKindOfClass:webview]) return parent;
  if (depth>=8) return nil;
  for (NSView *child in parent.subviews) {
    if (NSView *found=WorkspaceWebView(child,depth+1)) return found;
  }
  return nil;
}
NSRect WorkspaceFrame(NSView *parent,double x,double y,double w,double h,double viewport_height=0) {
  NSView *webview=WorkspaceWebView(parent);
  if (!webview) return Frame(parent,x,y,w,h);
  NSRect bounds=webview.bounds;
  // WebKit's DOM viewport can exclude chrome despite a full native WK frame.
  // Use the measured DOM height; style masks do not describe this internal inset.
  const auto viewport=supermono::BrowserViewport(
    {bounds.origin.x,bounds.origin.y,bounds.size.width,bounds.size.height},
    viewport_height,webview.flipped);
  const auto rect=supermono::BrowserViewportFrame(viewport,webview.flipped,x,y,w,h);
  return [webview convertRect:NSMakeRect(rect.x,rect.y,rect.width,rect.height) toView:parent];
}

BOOL IsHandling(id,SEL) { return handling_send_event; }
void SetHandling(id,SEL,BOOL value) { handling_send_event=value; }
void SendEvent(id application,SEL selector,NSEvent *event) {
  CefScopedSendingEvent scoped;
  reinterpret_cast<void(*)(id,SEL,NSEvent*)>(original_send_event)(application,selector,event);
}
bool InstallApplicationIntegration() {
  Class cls=object_getClass(NSApp);
  if (!cls) return false;
  // Extend Tao's existing NSApplication subclass, preserving its event handler.
  // Replacing NSApp would break Tauri's window/delegate lifecycle.
  if (![NSApp respondsToSelector:@selector(isHandlingSendEvent)])
    class_addMethod(cls,@selector(isHandlingSendEvent),(IMP)IsHandling,"B@:");
  if (![NSApp respondsToSelector:@selector(setHandlingSendEvent:)])
    class_addMethod(cls,@selector(setHandlingSendEvent:),(IMP)SetHandling,"v@:B");
  class_addProtocol(cls,@protocol(CefAppProtocol));
  if (!original_send_event) {
    Method method=class_getInstanceMethod(cls,@selector(sendEvent:));
    original_send_event=method_getImplementation(method);
    class_replaceMethod(cls,@selector(sendEvent:),(IMP)SendEvent,method_getTypeEncoding(method));
  }
  return true;
}

bool HasPumpWork() { return initialized && (!pages.empty() || live_browser_count>0); }
void KillPumpTimer() { [pump_timer invalidate]; pump_timer=nil; }
void SchedulePump(int64_t delay_ms) {
  // CEF can schedule from any thread. Name concrete selector delivery modes:
  // the default event loop, native resize/menu tracking, and modal panels.
  // Timer registration below uses the separate common-mode timer facility.
  [pump_handler performSelector:@selector(scheduleWork:) onThread:NSThread.mainThread
    withObject:@(delay_ms) waitUntilDone:NO
    modes:@[NSDefaultRunLoopMode,NSEventTrackingRunLoopMode,NSModalPanelRunLoopMode]];
}
void PerformPumpWork() {
  if (!HasPumpWork()) return;
  if (pump_active) { pump_reentered=true; return; }
  pump_reentered=false; pump_active=true;
  CefDoMessageLoopWork();
  pump_active=false;
  if (pump_reentered) SchedulePump(0);
  else if (!pump_timer && HasPumpWork()) SchedulePump(kPumpFallback);
}
void HandlePumpSchedule(int64_t delay_ms) {
  if (!HasPumpWork()) { KillPumpTimer(); return; }
  if (delay_ms==kPumpFallback && pump_timer) return;
  KillPumpTimer();
  if (delay_ms<=0) { PerformPumpWork(); return; }
  // CEF's external-loop example requires this fallback even without another
  // scheduling callback; otherwise network/IPC work can stall after creation.
  // https://github.com/chromiumembedded/cef/blob/master/tests/shared/browser/main_message_loop_external_pump.cc
  // https://github.com/chromiumembedded/cef/blob/master/tests/shared/browser/main_message_loop_external_pump_mac.mm
  const double seconds=std::min(delay_ms,kPumpMaximumDelay)/1000.0;
  pump_timer=[NSTimer timerWithTimeInterval:seconds target:pump_handler
    selector:@selector(timerFired:) userInfo:nil repeats:NO];
  [NSRunLoop.mainRunLoop addTimer:pump_timer forMode:NSRunLoopCommonModes];
  [NSRunLoop.mainRunLoop addTimer:pump_timer forMode:NSEventTrackingRunLoopMode];
}
void HandlePumpTimer() { KillPumpTimer(); PerformPumpWork(); }
class Application final : public CefApp, public CefBrowserProcessHandler {
 public:
  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override { return this; }
  void OnScheduleMessagePumpWork(int64_t delay_ms) override { SchedulePump(delay_ms); }
 private:
  IMPLEMENT_REFCOUNTING(Application);
};
CefRefPtr<Application> application;
void FinishShutdown();

// DevTools is Chromium's own privileged UI. It must have a separate client
// from web pages: no page navigation policy or agent bridge, but full lifecycle
// accounting so CefShutdown cannot run while its window still exists.
class DevToolsClient final : public CefClient, public CefLifeSpanHandler {
 public:
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override {
    ++live_browser_count; browsers_[browser->GetIdentifier()]=browser;
    browser->GetHost()->SetAccessibilityState(STATE_ENABLED);
    if (closing_) browser->GetHost()->CloseBrowser(true);
  }
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
    --live_browser_count; browsers_.erase(browser->GetIdentifier()); FinishShutdown();
  }
  void Close() {
    closing_=true;
    auto browsers=browsers_;
    for (auto& entry:browsers) entry.second->GetHost()->CloseBrowser(true);
  }
 private:
  bool closing_=false;
  std::map<int,CefRefPtr<CefBrowser>> browsers_;
  IMPLEMENT_REFCOUNTING(DevToolsClient);
};

class FaviconDownload final : public CefDownloadImageCallback {
 public:
  explicit FaviconDownload(std::function<void(const std::string&)> done) : done_(std::move(done)) {}
  void OnDownloadImageFinished(const CefString&,int,CefRefPtr<CefImage> image) override {
    std::string icon;
    if (image && !image->IsEmpty()) {
      int width=0,height=0;
      auto png=image->GetAsPNG(1.0f,true,width,height);
      if (png && width<=64 && height<=64 && png->GetSize()<=24000) {
        std::vector<unsigned char> bytes(png->GetSize());
        png->GetData(bytes.data(),bytes.size(),0);
        icon="data:image/png;base64,"+CefBase64Encode(bytes.data(),bytes.size()).ToString();
      }
    }
    done_(icon);
  }
 private:
  std::function<void(const std::string&)> done_;
  IMPLEMENT_REFCOUNTING(FaviconDownload);
};

class Page final : public CefClient, public CefLifeSpanHandler, public CefDisplayHandler,
  public CefLoadHandler, public CefRequestHandler, public CefDownloadHandler,
  public CefPermissionHandler, public CefKeyboardHandler, public CefFindHandler, public CefFocusHandler,
  public CefDevToolsMessageObserver {
 public:
  explicit Page(std::string id) : id_(std::move(id)) {}
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
  CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }
  CefRefPtr<CefDownloadHandler> GetDownloadHandler() override { return this; }
  CefRefPtr<CefPermissionHandler> GetPermissionHandler() override { return this; }
  CefRefPtr<CefKeyboardHandler> GetKeyboardHandler() override { return this; }
  CefRefPtr<CefFindHandler> GetFindHandler() override { return this; }
  CefRefPtr<CefFocusHandler> GetFocusHandler() override { return this; }
  bool OnSetFocus(CefRefPtr<CefBrowser> browser,FocusSource source) override { return Main(browser) && (!visible_ || closing_); }
  void OnGotFocus(CefRefPtr<CefBrowser> browser) override { if (Main(browser)) State(); }
  void OnTakeFocus(CefRefPtr<CefBrowser> browser,bool next) override {
    if (!Main(browser)) return;
    auto d=Object(); d->SetString("type","state"); d->SetBool("focused",false); Emit(id_,d);
  }

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override {
    ++live_browser_count;
    // Windowed CEF uses Complete mode here and provides native macOS AX nodes.
    // This covers page frames and normal popup windows without exposing app IPC.
    browser->GetHost()->SetAccessibilityState(STATE_ENABLED);
    if (browser->IsPopup()) { popups_[browser->GetIdentifier()]=browser; return; }
    browser_=browser;
    registration_=browser->GetHost()->AddDevToolsMessageObserver(this);
    Layout();
    auto d=Object(); d->SetString("type","created"); Emit(id_,d); State();
    if (closing_) browser->GetHost()->CloseBrowser(true);
  }
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
    --live_browser_count;
    DismissPrompts(browser->GetIdentifier());
    if (browser_ && browser->IsSame(browser_)) {
      registration_=nullptr; browser_=nullptr; context_id_=0;
      [drop_indicator_ clear]; drop_indicator_=nil;
      [edit_annotation_ clear]; [edit_annotation_ removeFromSuperview]; edit_annotation_=nil;
      [clip_view_ removeFromSuperview]; clip_view_=nil;
      auto pending=std::move(pending_); pending_.clear();
      for (auto& item:pending) item.second(false,Error("Browser closed"));
      downloads_.clear(); download_names_.clear();
      auto d=Object(); d->SetString("type","closed"); Emit(id_,d);
      // Popup callbacks retain this client until Chromium closes them.
      pages.erase(id_);
    } else popups_.erase(browser->GetIdentifier());
    MaybeShutdown();
  }
  bool DoClose(CefRefPtr<CefBrowser> browser) override {
    // Child browser closure must not close its owning Tauri NSWindow.
    if (!Main(browser)) return false;
    NSView *view=(__bridge NSView*)browser->GetHost()->GetWindowHandle();
    dispatch_async(dispatch_get_main_queue(),^{
      // Releasing CEF's wrapper view completes its WindowDestroyed lifecycle.
      // Defer teardown until the DoClose callback has left Chromium's stack.
      [view removeFromSuperview];
    });
    return true;
  }
  void OnBeforeDevToolsPopup(CefRefPtr<CefBrowser> browser,CefWindowInfo& window_info,
      CefRefPtr<CefClient>& client,CefBrowserSettings& settings,Dict& extra_info,bool *use_default_window) override {
    if (!devtools_client_) devtools_client_=new DevToolsClient;
    client=devtools_client_; *use_default_window=true;
    window_info.runtime_style=CEF_RUNTIME_STYLE_CHROME;
  }
  bool OnBeforePopup(CefRefPtr<CefBrowser> browser,CefRefPtr<CefFrame> frame,int popup_id,
    const CefString& target_url,const CefString& target_frame_name,WindowOpenDisposition disposition,
    bool user_gesture,const CefPopupFeatures& features,CefWindowInfo& window_info,
    CefRefPtr<CefClient>& client,CefBrowserSettings& settings,Dict& extra_info,bool *no_javascript_access) override {
    const auto destination=target_url.empty() ? "about:blank" : target_url.ToString();
    if (!AllowedUrl(destination,true)) { Notice("This popup address is not available in the browser"); return true; }
    // Real Chromium popup windows preserve opener/postMessage and form POST for
    // authentication. They share this page's request context, never Tauri IPC.
    client=this;
    window_info.runtime_style=CEF_RUNTIME_STYLE_ALLOY;
    return false;
  }
  bool OnBeforeBrowse(CefRefPtr<CefBrowser> browser,CefRefPtr<CefFrame> frame,
      CefRefPtr<CefRequest> request,bool user_gesture,bool redirect) override {
    const auto url=request->GetURL().ToString();
    // Data subdocuments remain in Chromium's opaque origin and sandbox. They
    // have no app bridge; user-entered main-frame addresses remain HTTP(S).
    const bool data_subframe=!frame->IsMain() && url.rfind("data:",0)==0;
    if (!AllowedUrl(url,true) && !data_subframe) {
      Notice("This address cannot be opened inside the browser"); return true;
    }
    if (frame->IsMain()) DismissPrompts(browser->GetIdentifier());
    return false;
  }
  bool OnOpenURLFromTab(CefRefPtr<CefBrowser> browser,CefRefPtr<CefFrame> frame,
      const CefString& url,WindowOpenDisposition disposition,bool user_gesture) override {
    if (!AllowedUrl(url.ToString(),true)) { Notice("This address cannot be opened inside the browser"); return true; }
    return false;
  }
  void OnAddressChange(CefRefPtr<CefBrowser> browser,CefRefPtr<CefFrame> frame,const CefString& url) override {
    if (Main(browser) && frame->IsMain()) {
      if (EditActive()) EditMode(false);
      context_id_=0; error_.clear(); State();
    }
  }
  void OnTitleChange(CefRefPtr<CefBrowser> browser,const CefString& title) override { if (Main(browser)) { title_=title.ToString(); State(); } }
  void OnLoadStart(CefRefPtr<CefBrowser> browser,CefRefPtr<CefFrame> frame,TransitionType) override {
    if (Main(browser) && frame->IsMain()) {
      // Previous builds stored Chromium's host-shared zoom. Keep that baseline
      // at 100%; all user zoom changes below belong only to this live target.
      if (browser->GetHost()->GetZoomLevel()!=0) browser->GetHost()->SetZoomLevel(0);
      Zoom(zoom_.factor());
      if (EditActive()) EditMode(false);
      ++favicon_generation_; favicon_url_.clear(); favicon_.clear(); State();
    }
  }
  void OnFaviconURLChange(CefRefPtr<CefBrowser> browser,const std::vector<CefString>& urls) override {
    if (!Main(browser) || closing_) return;
    const auto candidate=std::find_if(urls.begin(),urls.end(),[](const CefString& url) { return AllowedUrl(url.ToString()); });
    const std::string url=candidate==urls.end() ? "" : candidate->ToString();
    if (url==favicon_url_) return;
    favicon_url_=url;
    const auto generation=++favicon_generation_;
    if (url.empty()) { favicon_.clear(); State(); return; }
    CefRefPtr<Page> page=this;
    // Let Chromium decode/cache the website icon; the app receives only a tiny PNG.
    browser->GetHost()->DownloadImage(url,true,32,false,new FaviconDownload([page,generation](const std::string& icon) {
      if (page->closing_ || page->favicon_generation_!=generation) return;
      page->favicon_=icon; page->State();
    }));
  }
  void OnLoadingStateChange(CefRefPtr<CefBrowser> browser,bool loading,bool back,bool forward) override {
    if (Main(browser)) State();
  }
  void OnLoadError(CefRefPtr<CefBrowser> browser,CefRefPtr<CefFrame> frame,ErrorCode code,
      const CefString& error_text,const CefString& failed_url) override {
    if (Main(browser) && frame->IsMain() && code!=ERR_ABORTED) { error_=error_text.ToString().substr(0,500); State(); }
  }
  void OnRenderProcessTerminated(CefRefPtr<CefBrowser> browser,TerminationStatus status,int code,const CefString& text) override {
    if (Main(browser)) { if (EditActive()) EditMode(false); context_id_=0; error_="The page process stopped. Reload this tab to continue."; State(); }
  }
  bool OnPreKeyEvent(CefRefPtr<CefBrowser> browser,const CefKeyEvent& event,CefEventHandle os_event,bool *shortcut) override {
    if (Main(browser) && EditActive() && event.windows_key_code==27 &&
        (event.type==KEYEVENT_RAWKEYDOWN || event.type==KEYEVENT_KEYDOWN)) {
      EditMode(false); return true;
    }
    if ((event.type!=KEYEVENT_RAWKEYDOWN && event.type!=KEYEVENT_KEYDOWN) || !(event.modifiers & EVENTFLAG_COMMAND_DOWN)) return false;
    auto c=event.unmodified_character;
    if (c=='f' || c=='F' || c=='l' || c=='L') {
      if (Main(browser)) { auto d=Object(); d->SetString("type","toolbar"); d->SetString("action",c=='f'||c=='F' ? "find" : "address"); Emit(id_,d); return true; }
    }
    if (c=='+' || c=='=' || c=='-' || c=='0') {
      if (!Main(browser)) return false;
      const double factor=c=='0' ? 1.0 : zoom_.factor()*(c=='-' ? 1/1.2 : 1.2);
      Zoom(factor); return true;
    }
    return false;
  }
  void OnFindResult(CefRefPtr<CefBrowser> browser,int identifier,int count,const CefRect& selection,int ordinal,bool final_update) override {
    if (!Main(browser)) return;
    find_count_=count; find_ordinal_=ordinal; State();
  }
  bool CanDownload(CefRefPtr<CefBrowser>,const CefString& url,const CefString&) override { return AllowedUrl(url.ToString(),false,true); }
  bool OnBeforeDownload(CefRefPtr<CefBrowser> browser,CefRefPtr<CefDownloadItem> item,
      const CefString& suggested,CefRefPtr<CefBeforeDownloadCallback> callback) override {
    if (!AllowedUrl(item->GetURL().ToString(),false,true)) return true;
    const auto filename=Str(Ns(suggested.ToString()).lastPathComponent);
    const auto key=std::to_string(browser->GetIdentifier())+":"+std::to_string(item->GetId());
    download_names_[key]=filename.empty()?"Download":filename;
    NSString *directory=download_root.empty() ? NSSearchPathForDirectoriesInDomains(NSDownloadsDirectory,NSUserDomainMask,YES).firstObject : Ns(download_root);
    NSString *path=[directory stringByAppendingPathComponent:Ns(filename.empty()?"Download":filename)];
    // CEF's native Save As chooser makes overwrites an explicit user choice.
    callback->Continue(Str(path),true);
    return true;
  }
  void OnDownloadUpdated(CefRefPtr<CefBrowser> browser,CefRefPtr<CefDownloadItem> item,CefRefPtr<CefDownloadItemCallback> callback) override {
    const auto key=std::to_string(browser->GetIdentifier())+":"+std::to_string(item->GetId());
    // Chromium may clear the suggested name after Save As or completion.
    // Prefer the user's chosen path, then retain the last known display name.
    auto filename=Str(Ns(item->GetFullPath().ToString()).lastPathComponent);
    if (filename.empty()) filename=Str(Ns(item->GetSuggestedFileName().ToString()).lastPathComponent);
    if (filename.empty()) { auto found=download_names_.find(key); if (found!=download_names_.end()) filename=found->second; }
    if (filename.empty()) filename="Download";
    download_names_[key]=filename;
    if (item->IsInProgress()) downloads_[key]=callback; else downloads_.erase(key);
    auto d=Object(), entry=Object();
    entry->SetString("id",key); entry->SetString("filename",filename);
    entry->SetString("path",item->GetFullPath());
    entry->SetDouble("receivedBytes",item->GetReceivedBytes()); entry->SetDouble("totalBytes",item->GetTotalBytes());
    entry->SetString("state",item->IsComplete()?"completed":item->IsCanceled()?"cancelled":item->IsInProgress()?"in-progress":"failed");
    if (!item->IsComplete()&&!item->IsCanceled()&&!item->IsInProgress()) entry->SetString("error","Download could not be completed");
    d->SetString("type","download"); d->SetDictionary("download",entry); Emit(id_,d);
    if (!item->IsInProgress()) download_names_.erase(key);
  }
  bool OnRequestMediaAccessPermission(CefRefPtr<CefBrowser> browser,CefRefPtr<CefFrame> frame,
      const CefString& origin,uint32_t permissions,CefRefPtr<CefMediaAccessCallback> callback) override {
    std::string resources;
    if (permissions & CEF_MEDIA_PERMISSION_DEVICE_AUDIO_CAPTURE) resources+="microphone ";
    if (permissions & CEF_MEDIA_PERMISSION_DEVICE_VIDEO_CAPTURE) resources+="camera ";
    if (permissions & (CEF_MEDIA_PERMISSION_DESKTOP_AUDIO_CAPTURE|CEF_MEDIA_PERMISSION_DESKTOP_VIDEO_CAPTURE)) resources+="screen sharing ";
    Prompt(browser,"media:"+std::to_string(++prompt_sequence_),origin.ToString(),"Use your "+resources,
      [callback,permissions](bool allow) { if (allow) callback->Continue(permissions); else callback->Cancel(); });
    return true;
  }
  bool OnShowPermissionPrompt(CefRefPtr<CefBrowser> browser,uint64_t id,const CefString& origin,
      uint32_t permissions,CefRefPtr<CefPermissionPromptCallback> callback) override {
    std::vector<std::string> names;
    if (permissions & CEF_PERMISSION_TYPE_GEOLOCATION) names.push_back("location");
    if (permissions & CEF_PERMISSION_TYPE_NOTIFICATIONS) names.push_back("notifications");
    if (permissions & CEF_PERMISSION_TYPE_CLIPBOARD) names.push_back("clipboard");
    if (permissions & (CEF_PERMISSION_TYPE_STORAGE_ACCESS|CEF_PERMISSION_TYPE_TOP_LEVEL_STORAGE_ACCESS)) names.push_back("cross-site cookies and storage");
    if (permissions & (CEF_PERMISSION_TYPE_LOCAL_NETWORK_ACCESS_DEPRECATED|CEF_PERMISSION_TYPE_LOCAL_NETWORK)) names.push_back("devices and services on your local network");
    if (permissions & CEF_PERMISSION_TYPE_LOOPBACK_NETWORK) names.push_back("services running on this Mac");
    std::string description;
    for (const auto& name:names) { if (!description.empty()) description+=", "; description+=name; }
    // Unknown capabilities must not be granted under a vague catch-all prompt.
    const uint32_t supported=CEF_PERMISSION_TYPE_GEOLOCATION|CEF_PERMISSION_TYPE_NOTIFICATIONS|CEF_PERMISSION_TYPE_CLIPBOARD|
      CEF_PERMISSION_TYPE_STORAGE_ACCESS|CEF_PERMISSION_TYPE_TOP_LEVEL_STORAGE_ACCESS|CEF_PERMISSION_TYPE_LOCAL_NETWORK_ACCESS_DEPRECATED|
      CEF_PERMISSION_TYPE_LOCAL_NETWORK|CEF_PERMISSION_TYPE_LOOPBACK_NETWORK;
    if ((permissions & ~supported) || !permissions) { callback->Continue(CEF_PERMISSION_RESULT_DENY); Notice("This website requested a permission that is not yet supported"); return true; }
    Prompt(browser,"permission:"+std::to_string(id),origin.ToString(),"Access "+description,
      [callback](bool allow) { callback->Continue(allow?CEF_PERMISSION_RESULT_ACCEPT:CEF_PERMISSION_RESULT_DENY); });
    return true;
  }
  void OnDismissPermissionPrompt(CefRefPtr<CefBrowser> browser,uint64_t id,cef_permission_request_result_t result) override {
    const auto key=std::to_string(browser->GetIdentifier())+":permission:"+std::to_string(id);
    auto found=prompts_.find(key);
    if (found!=prompts_.end()) { auto prompt=found->second; prompt->completion=nullptr; [prompt->alert.window.sheetParent endSheet:prompt->alert.window returnCode:NSAlertSecondButtonReturn]; prompts_.erase(found); }
  }
  bool GetAuthCredentials(CefRefPtr<CefBrowser> browser,const CefString& origin,bool proxy,
      const CefString& host,int port,const CefString& realm,const CefString& scheme,CefRefPtr<CefAuthCallback> callback) override {
    CefRefPtr<Page> self=this;
    const auto label=origin.ToString();
    dispatch_async(dispatch_get_main_queue(),^{
      if (!browser->IsValid() || self->closing_) { callback->Cancel(); return; }
      NSWindow *window=[(__bridge NSView*)browser->GetHost()->GetWindowHandle() window];
      if (!window || self->prompts_.size()>=4) { callback->Cancel(); return; }
      NSAlert *alert=[NSAlert new]; alert.messageText=proxy?@"Proxy sign-in":@"Website sign-in"; alert.informativeText=Ns(label);
      [alert addButtonWithTitle:@"Sign in"]; [alert addButtonWithTitle:@"Cancel"];
      NSView *fields=[[NSView alloc] initWithFrame:NSMakeRect(0,0,300,60)];
      NSTextField *username=[[NSTextField alloc] initWithFrame:NSMakeRect(0,34,300,24)]; username.placeholderString=@"Username";
      NSSecureTextField *password=[[NSSecureTextField alloc] initWithFrame:NSMakeRect(0,0,300,24)]; password.placeholderString=@"Password";
      [fields addSubview:username]; [fields addSubview:password]; alert.accessoryView=fields;
      auto prompt=std::make_shared<PromptState>(); prompt->alert=alert;
      prompt->completion=[callback,username,password](bool allow) {
        if (allow) callback->Continue(Str(username.stringValue),Str(password.stringValue)); else callback->Cancel();
      };
      const auto key=std::to_string(browser->GetIdentifier())+":auth:"+std::to_string(++self->prompt_sequence_);
      self->prompts_[key]=prompt;
      [alert beginSheetModalForWindow:window completionHandler:^(NSModalResponse response) {
        self->prompts_.erase(key);
        if (prompt->completion) {
          auto done=std::move(prompt->completion); prompt->completion=nullptr;
          done(response==NSAlertFirstButtonReturn && !self->closing_ && browser->IsValid());
        }
      }];
    });
    return true;
  }

  bool Main(CefRefPtr<CefBrowser> browser) const { return browser_ && browser->IsSame(browser_); }
  bool Focused() const {
    if (!browser_ || !visible_ || closing_) return false;
    NSView *view=(__bridge NSView*)browser_->GetHost()->GetWindowHandle();
    if (!view.window.keyWindow) return false;
    // Floating windows contain only this browser. Their native tab bar and
    // titlebar controls should retain browser shortcuts while they have focus.
    if (auto_resize_) return true;
    NSResponder *responder=view.window.firstResponder;
    return [responder isKindOfClass:NSView.class] && [(NSView*)responder isDescendantOf:view];
  }
  void State() {
    if (!browser_) return;
    [actions_menu_ updateZoom:zoom_.factor()];
    auto d=Object(); d->SetString("type","state");
    auto frame=browser_->GetMainFrame(); d->SetString("url",frame?frame->GetURL():CefString());
    d->SetString("title",browser_->GetHost()->GetWindowHandle() ? title_ : "");
    d->SetString("favicon",favicon_);
    d->SetBool("loading",browser_->IsLoading()); d->SetBool("canGoBack",browser_->CanGoBack()); d->SetBool("canGoForward",browser_->CanGoForward());
    d->SetBool("focused",Focused());
    d->SetString("error",error_); d->SetString("notice",notice_); d->SetDouble("zoomFactor",zoom_.factor());
    auto find=Object(); find->SetString("query",find_query_); find->SetInt("activeMatch",find_ordinal_); find->SetInt("totalMatches",find_count_); d->SetDictionary("findResult",find);
    Emit(id_,d);
  }
  void Notice(const std::string& notice) { notice_=notice; State(); }
  void Zoom(double factor,Completion done={}) {
    if (EditActive()) EditMode(false);
    if (!zoom_.Request(factor)) { if (done) done(false,Error("Invalid zoom")); return; }
    if (done) zoom_waiters_.push_back(std::move(done));
    State();
    ApplyZoom();
  }
  void ApplyZoom() {
    if (!browser_ || closing_) {
      auto waiters=std::move(zoom_waiters_); zoom_waiters_.clear();
      for (auto& done:waiters) done(false,Error("Browser closed"));
      return;
    }
    // CDP restores its saved emulation after a screenshot. Apply newer zoom
    // only once that restoration has completed, including canceled captures.
    if (screenshot_running_) return;
    const auto factor=zoom_.Begin();
    if (!factor) return;
    auto waiters=std::move(zoom_waiters_); zoom_waiters_.clear();
    // CEF SetZoomLevel writes the shared host zoom map. Desktop metrics apply
    // to this DevTools target only: zero dimensions follow the actual widget,
    // divided by scale for layout, while Chromium keeps its real compositor
    // pixel density and maps input through the same transform. No mobile or
    // touch emulation, document mutation, or separate cookie profile is needed.
    // Chromium: ScreenMetricsEmulator::Apply / DevToolsEmulator::EnableDeviceEmulation.
    auto params=Object(); params->SetInt("width",0); params->SetInt("height",0);
    params->SetDouble("deviceScaleFactor",0); params->SetBool("mobile",false);
    params->SetDouble("scale",*factor); params->SetBool("dontSetVisibleSize",true);
    CefRefPtr<Page> self=this;
    Dev("Emulation.setDeviceMetricsOverride",params,[self,waiters=std::move(waiters)](bool ok,Dict result) {
      self->zoom_.Complete(ok);
      self->State();
      for (const auto& done:waiters) done(ok,result);
      self->ApplyZoom();
    });
  }
  void Layout() {
    if (!visible_) [drop_indicator_ clear];
    if (!browser_) return;
    NSView *view=(__bridge NSView*)browser_->GetHost()->GetWindowHandle();
    // CEF enables a layer-backed content view for its own macOS windows so
    // native siblings retain their compositing order. External hosts must do
    // the same: otherwise a WK repaint can cover the live Chromium page.
    parent_.wantsLayer=YES;
    clip_view_.wantsLayer=YES;
    supermono::EnsureBrowserHost(parent_,clip_view_,view,WorkspaceWebView(parent_));
    // Clip only the obscured edges. The page retains its full viewport size,
    // scroll position and live rendering while a workspace sidebar hovers.
    // Disable autoresizing before changing the wrapper, including PiP returns.
    view.autoresizingMask=NSViewNotSizable;
    const double left=auto_resize_ ? 0 : clip_left_;
    const double right=auto_resize_ ? 0 : clip_right_;
    const double exposed=std::max(0.0,w_-left-right);
    const NSRect full_frame=auto_resize_ ? Frame(parent_,x_,y_,w_,h_)
                                        : WorkspaceFrame(parent_,x_,y_,w_,h_,viewport_height_);
    const NSRect clip_frame=auto_resize_ ? Frame(parent_,x_+left,y_,exposed,h_)
                                        : WorkspaceFrame(parent_,x_+left,y_,exposed,h_,viewport_height_);
    const auto aligned=supermono::AlignedBrowserHostFrames(parent_,full_frame,clip_frame);
    // A comment refers to the captured element, not a new layout of the page.
    // Keep the live browser attached; retire the annotation if its viewport changes.
    if (edit_annotation_.active && (!visible_ || exposed<=0 ||
        edit_annotation_.superview!=clip_view_ || clip_view_.superview!=parent_ ||
        !NSEqualRects(edit_annotation_.frame,aligned.browser) ||
        !NSEqualSizes(clip_view_.bounds.size,aligned.clip.size)))
      EditMode(false);
    clip_view_.frame=aligned.clip;
    clip_view_.autoresizingMask=auto_resize_ ? NSViewWidthSizable|NSViewHeightSizable : NSViewNotSizable;
    view.frame=aligned.browser;
    view.autoresizingMask=auto_resize_ ? NSViewWidthSizable|NSViewHeightSizable : NSViewNotSizable;
    supermono::ApplyBrowserBottomCornerMask(clip_view_,aligned.browser,auto_resize_ ? 0 : bottom_corner_radius_);
    if (!visible_ || exposed<=0)
      supermono::ReturnHiddenBrowserFocus(clip_view_,WorkspaceWebView(parent_));
    clip_view_.hidden=!visible_ || exposed<=0;
    view.hidden=!visible_;
    if (clip_view_.hidden) [drop_indicator_ clear];
    [drop_indicator_ placeAboveBrowser:view frame:aligned.browser];
    browser_->GetHost()->NotifyMoveOrResizeStarted();
  }
  void Close() {
    ++edit_generation_; editing_=false; edit_selection_pending_=false;
    [edit_annotation_ clear];
    closing_=true; visible_=false; Layout();
    [actions_menu_ cancel];
    if (devtools_client_) devtools_client_->Close();
    auto popups=popups_; for (auto& item:popups) item.second->GetHost()->CloseBrowser(true);
    if (browser_) { browser_->GetHost()->CloseDevTools(); browser_->GetHost()->CloseBrowser(true); }
  }
  // Objective-C blocks preserve C++ reference captures. Own this request ID so
  // dismissal can finish the correct waiter after the FFI call has returned.
  void Menu(std::string request,NSView *anchor_parent,Dict command) {
    if (!browser_ || closing_ || !anchor_parent.window || actions_menu_) {
      Result(id_,request,false,Error("Browser menu is unavailable")); return;
    }
    const double x=Number(command,"x"),y=Number(command,"y"),w=Number(command,"width"),h=Number(command,"height");
    const double viewport=Number(command,"viewportHeight");
    if (!Geometry(x,y,w,h) || w<1 || h<1 || !std::isfinite(viewport) || viewport<0 || viewport>262144) {
      Result(id_,request,false,Error("Invalid browser menu anchor")); return;
    }
    supermono::BrowserMenuOptions options;
    options.can_add_to_chat=Boolean(command,"canAddToChat");
    options.can_float=Boolean(command,"canFloat");
    options.floating=Boolean(command,"floating");
    options.can_use_page=Boolean(command,"canUsePage");
    CefRefPtr<Page> self=this;
    actions_menu_=[[SMBrowserActionsMenu alloc] initWithOptions:options zoom:zoom_.factor() onZoom:^(NSString *action) {
      if (self->closing_) return;
      double factor=self->zoom_.factor();
      if ([action isEqualToString:@"zoom-in"]) factor=std::min(5.0,factor*1.2);
      else if ([action isEqualToString:@"zoom-out"]) factor=std::max(.25,factor/1.2);
      else factor=1;
      self->Zoom(factor);
    }];
    // Return to Rust before AppKit starts its tracking loop. The caller waits
    // for dismissal, without treating a menu left open as a command timeout.
    dispatch_async(dispatch_get_main_queue(),^{
      SMBrowserActionsMenu *menu=self->actions_menu_;
      NSString *selection=nil;
      if (!self->closing_ && anchor_parent.window) {
        NSRect anchor=WorkspaceFrame(anchor_parent,x,y,w,h,viewport);
        NSPoint point=NSMakePoint(std::max(0.0,NSMaxX(anchor)-224),
            anchor_parent.flipped ? NSMaxY(anchor)+4 : NSMinY(anchor)-4);
        selection=[menu showAt:point inView:anchor_parent];
      }
      self->actions_menu_=nil;
      auto result=Object();
      if (selection && !self->closing_) result->SetString("selection",Str(selection));
      Result(self->id_,request,true,result);
    });
  }
  bool DropIndicator(Dict command) {
    if (command->GetType("indicator")==VTYPE_NULL) { [drop_indicator_ clear]; return true; }
    if (command->GetType("indicator")!=VTYPE_DICTIONARY) return false;
    auto indicator=command->GetDictionary("indicator");
    if (indicator->GetType("title")!=VTYPE_STRING) return false;
    const double missing=std::numeric_limits<double>::quiet_NaN();
    NSRect target=NSMakeRect(Number(indicator,"x",missing),Number(indicator,"y",missing),
        Number(indicator,"width",missing),Number(indicator,"height",missing));
    NSView *view=(__bridge NSView*)browser_->GetHost()->GetWindowHandle();
    if (!drop_indicator_) drop_indicator_=[[SMBrowserDropIndicator alloc] initWithFrame:view.frame];
    [drop_indicator_ placeAboveBrowser:view frame:view.frame];
    const BOOL accepted=[drop_indicator_ updateTarget:target edge:Ns(Text(indicator,"edge"))
        kind:Ns(Text(indicator,"kind")) title:Ns(Text(indicator,"title"))];
    if (!visible_ || clip_view_.hidden) [drop_indicator_ clear];
    return accepted;
  }
  void Command(const std::string& request,Dict cmd) {
    if (!browser_ || closing_) { Result(id_,request,false,Error("Browser is still opening or has closed")); return; }
    const auto action=Text(cmd,"action"); auto host=browser_->GetHost();
    if (edit_annotation_.active && (action=="navigate" || action=="back" ||
        action=="forward" || action=="reload" || action=="dom" ||
        action=="scroll" || action=="press" || action=="devtools"))
      EditMode(false);
    if (action=="navigate") { const auto url=Text(cmd,"url"); if (!AllowedUrl(url)) { Result(id_,request,false,Error("Unsupported browser address")); return; } browser_->GetMainFrame()->LoadURL(url); }
    else if (action=="back") browser_->GoBack();
    else if (action=="forward") browser_->GoForward();
    else if (action=="reload") { error_.clear(); browser_->Reload(); }
    else if (action=="stop") browser_->StopLoad();
    else if (action=="focus") { host->SetFocus(true); [parent_.window makeFirstResponder:(__bridge NSView*)host->GetWindowHandle()]; }
    else if (action=="zoom") {
      const auto factor=Number(cmd,"factor",1);
      CefRefPtr<Page> self=this;
      Zoom(factor,[self,request](bool ok,Dict result) { Result(self->id_,request,ok,result); });
      return;
    }
    else if (action=="find") { find_query_=Text(cmd,"text").substr(0,1000); host->Find(find_query_,Boolean(cmd,"forward",true),Boolean(cmd,"matchCase"),Boolean(cmd,"findNext")); }
    else if (action=="findStop") { host->StopFinding(true); find_query_.clear(); find_count_=find_ordinal_=0; State(); }
    else if (action=="devtools") { if (!devtools_client_) devtools_client_=new DevToolsClient; CefWindowInfo window; window.runtime_style=CEF_RUNTIME_STYLE_CHROME; CefBrowserSettings settings; host->ShowDevTools(window,devtools_client_,settings,CefPoint()); }
    else if (action=="edit-start" || action=="edit-stop") { EditMode(action=="edit-start",request,Text(cmd,"token")); return; }
    else if (action=="downloadCancel") { auto item=downloads_.find(Text(cmd,"downloadId")); if (item==downloads_.end()) { Result(id_,request,false,Error("This download is no longer active")); return; } item->second->Cancel(); }
    else if (action=="drop-indicator") {
      if (!DropIndicator(cmd)) { Result(id_,request,false,Error("Invalid browser drop indicator")); return; }
    }
    else if (action=="snapshot") { Screenshot(request); return; }
    else if (action=="dom") { Dom(request,cmd->GetDictionary("request")); return; }
    else if (action=="press") { Press(request,Text(cmd,"key")); return; }
    else if (action=="scroll") { Scroll(request,Number(cmd,"deltaX"),Number(cmd,"deltaY")); return; }
    else { Result(id_,request,false,Error("Unknown Chromium command")); return; }
    Result(id_,request,true,Object());
  }

  void OnDevToolsMethodResult(CefRefPtr<CefBrowser>,int message_id,bool success,const void* raw,size_t size) override {
    auto found=pending_.find(message_id); if (found==pending_.end()) return;
    auto callback=std::move(found->second); pending_.erase(found);
    if (size>12*1024*1024) { callback(false,Error("Browser result exceeded its size limit")); return; }
    auto result=Parse(raw?std::string((const char*)raw,size):"{}");
    if (!result) { callback(false,Error("Browser returned an invalid result")); return; }
    if (!success) result=Error(Text(result,"message"));
    callback(success,result);
  }
  void OnDevToolsEvent(CefRefPtr<CefBrowser>,const CefString& method,const void* raw,size_t size) override {
    if (method=="Overlay.inspectModeCanceled" && editing_) EditMode(false);
    if (method=="Overlay.inspectNodeRequested" && editing_ && size<4096) {
      auto value=Parse(std::string((const char*)raw,size));
      const int node=(int)Number(value,"backendNodeId");
      if (node>0) SelectEditElement(node);
    }
    if (method=="Runtime.executionContextsCleared") context_id_=0;
    if (method=="Runtime.executionContextDestroyed" && size<4096) {
      auto value=Parse(std::string((const char*)raw,size)); if (Number(value,"executionContextId")==context_id_) context_id_=0;
    }
  }
  void Dev(const std::string& method,Dict params,Completion callback,Completion timeout=nullptr) {
    if (!browser_ || pending_.size()>=32) { callback(false,Error("Browser is unavailable or busy")); return; }
    const int sequence=++dev_sequence_;
    pending_[sequence]=std::move(callback);
    if (!browser_->GetHost()->ExecuteDevToolsMethod(sequence,method,params)) {
      auto done=std::move(pending_[sequence]); pending_.erase(sequence); done(false,Error("Browser command could not be submitted")); return;
    }
    CefRefPtr<Page> self=this;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,10*NSEC_PER_SEC),dispatch_get_main_queue(),^{
      auto found=self->pending_.find(sequence); if (found==self->pending_.end()) return;
      // Captures may restore Chromium's viewport after this user-facing timeout.
      // Keep their real completion registered until the reply or browser close.
      if (timeout) { timeout(false,Error("Browser operation timed out")); return; }
      auto done=std::move(found->second); self->pending_.erase(found); done(false,Error("Browser operation timed out"));
    });
  }
  void EnsureWorld(Completion done) {
    if (context_id_) { auto d=Object(); d->SetInt("executionContextId",context_id_); done(true,d); return; }
    CefRefPtr<Page> self=this;
    Dev("Page.getFrameTree",Object(),[self,done](bool ok,Dict result) {
      if (!ok) { done(false,result); return; }
      auto tree=result->GetDictionary("frameTree"); auto frame=tree?tree->GetDictionary("frame"):nullptr;
      if (Text(frame,"id").empty()) { done(false,Error("Page is still navigating. Take a new snapshot.")); return; }
      auto params=Object(); params->SetString("frameId",Text(frame,"id")); params->SetString("worldName","supermono-agent"); params->SetBool("grantUniveralAccess",false);
      self->Dev("Page.createIsolatedWorld",params,[self,done](bool ok,Dict world) {
        if (ok) self->context_id_=(int)Number(world,"executionContextId");
        if (ok&&!self->context_id_) { done(false,Error("The isolated browser context is not ready")); return; }
        done(ok,world);
      });
    });
  }
  bool EditActive() const { return editing_ || edit_selection_pending_ || edit_annotation_.active; }
  void EditEvent(Dict selection=nullptr,const std::string& error="",Dict screenshot=nullptr,const std::string& comment="") {
    auto event=Object(); event->SetString("type","edit"); event->SetBool("active",EditActive());
    event->SetString("token",edit_token_);
    if (selection) event->SetDictionary("selection",selection);
    if (screenshot) event->SetDictionary("screenshot",screenshot);
    if (selection && !comment.empty()) event->SetString("comment",comment);
    if (!error.empty()) event->SetString("error",error.substr(0,500));
    Emit(id_,event);
  }
  void HideEditHighlight(Completion done=[](bool,Dict) {}) {
    const auto generation=edit_generation_;
    CefRefPtr<Page> self=this;
    auto params=Object(); params->SetString("mode","none");
    // Chromium validates this even for mode:none. Omitting it leaves the
    // node picker running, so its tooltip reappears on the next pointer move.
    params->SetDictionary("highlightConfig",Object());
    Dev("Overlay.setInspectMode",params,[self,generation,done](bool ok,Dict result) {
      if (generation!=self->edit_generation_ || self->closing_) {
        done(false,Error("Page selection was cancelled")); return;
      }
      if (!ok) { done(false,result); return; }
      self->Dev("Overlay.hideHighlight",Object(),done);
    });
  }
  void EditMode(bool active,const std::string& request="",const std::string& token="") {
    // A delayed stop from a prior renderer/run cannot cancel a newer picker.
    if (!active && !token.empty() && token!=edit_token_) { Result(id_,request,true,Object()); return; }
    if (!token.empty()) edit_token_=token;
    const auto generation=++edit_generation_;
    [edit_annotation_ clear];
    editing_=active;
    edit_selection_pending_=false;
    CefRefPtr<Page> self=this;
    if (!active) {
      HideEditHighlight([self,generation,request](bool ok,Dict result) {
        if (generation!=self->edit_generation_ || self->closing_) {
          Result(self->id_,request,false,Error("Page selection was cancelled")); return;
        }
        self->editing_=!ok;
        self->EditEvent(nullptr,ok ? "" : "Could not exit edit mode. Click Done or press Esc to retry.");
        Result(self->id_,request,ok,result);
      });
      return;
    }
    const auto finish=[self,generation,request](bool ok,Dict result) {
      if (generation!=self->edit_generation_ || self->closing_) {
        Result(self->id_,request,false,Error("Page selection was cancelled")); return;
      }
      if (!ok) { self->editing_=false; self->HideEditHighlight(); }
      self->EditEvent(nullptr,ok ? "" : "Could not start page selection. Try reloading this tab.");
      Result(self->id_,request,ok,result);
    };
    Dev("DOM.enable",Object(),[self,generation,finish](bool ok,Dict result) {
      if (!ok || generation!=self->edit_generation_) { finish(false,result); return; }
      self->Dev("Overlay.enable",Object(),[self,generation,finish](bool ok,Dict result) {
        if (!ok || generation!=self->edit_generation_) { finish(false,result); return; }
        auto color=Object(); color->SetInt("r",108); color->SetInt("g",184); color->SetInt("b",239); color->SetDouble("a",.12);
        auto border=Object(); border->SetInt("r",108); border->SetInt("g",184); border->SetInt("b",239); border->SetDouble("a",.9);
        auto highlight=Object(); highlight->SetBool("showInfo",false); highlight->SetDictionary("contentColor",color); highlight->SetDictionary("borderColor",border);
        auto params=Object(); params->SetString("mode","searchForNode"); params->SetDictionary("highlightConfig",highlight);
        self->Dev("Overlay.setInspectMode",params,finish);
      });
    });
  }
  void CaptureEditElement(Dict selection,Dict capture,uint64_t generation,Completion finish) {
    // Runtime.callFunctionOn owns these child dictionaries. Retaining their
    // wrapper does not retain the data after the DevTools result is released.
    selection=supermono::OwnBrowserEditData(selection);
    capture=supermono::OwnBrowserEditData(capture);
    if (!selection || !capture) { finish(false,Error("The selected element expired. Select it again.")); return; }
    auto rect=capture->GetDictionary("rect");
    auto viewport=capture ? capture->GetDictionary("viewport") : nullptr;
    const auto box=[](Dict value) {
      return supermono::BrowserRect{Number(value,"x"),Number(value,"y"),Number(value,"width"),Number(value,"height")};
    };
    const auto crop=supermono::ElementCaptureClip(box(rect),box(viewport),
      Number(capture,"scrollX"),Number(capture,"scrollY"),Number(capture,"deviceScale"),
      auto_resize_ || w_<=0 ? 0 : clip_left_/w_,auto_resize_ || w_<=0 ? 0 : clip_right_/w_,
      Number(capture->GetDictionary("rasterViewport"),"width"),Number(capture->GetDictionary("rasterViewport"),"height"));
    if (!crop) { finish(false,Error("This element has no visible area to capture. Select a larger visible element.")); return; }
    CefRefPtr<Page> self=this;
    NSView *parent=parent_;
    const auto parent_size=parent_.bounds.size;
    NSView *view=(__bridge NSView*)browser_->GetHost()->GetWindowHandle();
    const NSRect view_frame=view.frame,clip_frame=clip_view_.frame;
    NSWindow *window=view.window;
    const double width=w_,height=h_,left=clip_left_,right=clip_right_;
    const auto current=[self,generation,parent,parent_size,view,view_frame,clip_frame,window,width,height,left,right]() {
      return generation==self->edit_generation_ && !self->closing_ && self->visible_ &&
        self->parent_==parent && NSEqualSizes(self->parent_.bounds.size,parent_size) &&
        self->w_==width && self->h_==height && self->clip_left_==left && self->clip_right_==right &&
        view.window==window && NSEqualRects(view.frame,view_frame) && NSEqualRects(self->clip_view_.frame,clip_frame);
    };
    // Surface captures with a clip resize Chromium's live widget to that clip
    // and restore it afterward. Even an unclipped surface capture re-emulates
    // our per-tab zoom. Snapshot the existing view instead, then crop its pixels
    // locally so selecting an element never changes the visible page geometry.
    auto params=Object(); params->SetString("format","png"); params->SetBool("fromSurface",false);
    params->SetBool("captureBeyondViewport",false);
    auto target=Object(); target->SetDouble("x",crop->target.x); target->SetDouble("y",crop->target.y);
    target->SetDouble("width",crop->target.width); target->SetDouble("height",crop->target.height);
    // Wait for the picker highlight to be removed before capturing its pixels.
    Dev("Overlay.hideHighlight",Object(),[self,selection,target,params,current,finish](bool ok,Dict result) {
      if (!current()) { finish(false,Error("The page moved while capturing. Select the element again.")); return; }
      if (!ok) { finish(false,Error("Could not clear the selection highlight. Try selecting the element again.")); return; }
      if (self->screenshot_running_ || self->zoom_.pending()) {
        finish(false,Error("The browser is finishing another image or zoom change. Select the element again.")); return;
      }
      self->CaptureScreenshot(params,[selection,target,current,finish](bool ok,Dict result) {
        if (!current()) { finish(false,Error("The page moved while capturing. Select the element again.")); return; }
        const auto data=Text(result,"data");
        if (!ok || data.empty() || data.size()>12*1024*1024) {
          finish(false,Error("Could not capture the visible page. Try making the browser pane smaller and select the element again.")); return;
        }
        NSData *viewport_png=[[NSData alloc] initWithBase64EncodedString:Ns(data) options:0];
        uint32_t width=0,height=0;
        NSData *png=supermono::CropBrowserEditImage(viewport_png,
          {Number(target,"x"),Number(target,"y"),Number(target,"width"),Number(target,"height")},width,height);
        if (!png) {
          finish(false,Error("Could not crop the element image. Try making the browser pane smaller and select the element again.")); return;
        }
        const auto encoded=Str([png base64EncodedStringWithOptions:0]);
        if (encoded.size()>supermono::kEditCaptureMaxBase64) {
          finish(false,Error("Could not capture this element within the image limit. Select a smaller area.")); return;
        }
        auto screenshot=Object(); screenshot->SetString("dataUrl","data:image/png;base64,"+encoded);
        screenshot->SetInt("width",width); screenshot->SetInt("height",height);
        auto captured=Object(); captured->SetDictionary("selection",selection); captured->SetDictionary("screenshot",screenshot);
        captured->SetDictionary("target",target);
        finish(true,captured);
      });
    });
  }
  void AnnotateEditElement(Dict captured,uint64_t generation) {
    if (generation!=edit_generation_ || closing_ || !visible_ || !browser_) return;
    // Own the captured values until the user explicitly adds the annotation.
    // The comment is collected in our native view, never from page JavaScript.
    const auto selection=supermono::OwnBrowserEditData(captured ? captured->GetDictionary("selection") : nullptr);
    const auto screenshot=supermono::OwnBrowserEditData(captured ? captured->GetDictionary("screenshot") : nullptr);
    const auto target=supermono::OwnBrowserEditData(captured ? captured->GetDictionary("target") : nullptr);
    if (!selection || !screenshot || !target) {
      EditEvent(nullptr,"The selected element expired. Select it again."); return;
    }
    const NSRect anchor=NSMakeRect(Number(target,"x"),Number(target,"y"),
      Number(target,"width"),Number(target,"height"));
    NSView *view=(__bridge NSView*)browser_->GetHost()->GetWindowHandle();
    if (!edit_annotation_) edit_annotation_=[[SMBrowserEditAnnotation alloc] initWithFrame:view.frame];
    CefRefPtr<Page> self=this;
    const BOOL shown=[edit_annotation_ showAboveBrowser:view target:anchor
      onSubmit:^(NSString *comment) {
        if (generation!=self->edit_generation_ || self->closing_ || !self->visible_) return;
        ++self->edit_generation_;
        self->editing_=false; self->edit_selection_pending_=false;
        self->EditEvent(selection->Copy(false),"",screenshot->Copy(false),Str(comment));
      } onCancel:^{
        if (generation==self->edit_generation_ && !self->closing_) self->EditMode(false);
      } onReselect:^{
        if (generation==self->edit_generation_ && !self->closing_ && self->visible_) self->EditMode(true);
      }];
    self->EditEvent(nullptr,shown ? "" : "There is not enough room for a comment. Enlarge the browser and select again.");
  }
  void SelectEditElement(int node) {
    editing_=false;
    edit_selection_pending_=true;
    const auto generation=++edit_generation_;
    CefRefPtr<Page> self=this;
    const auto finish=[self,generation](bool ok,Dict result) {
      if (generation!=self->edit_generation_ || self->closing_) return;
      self->edit_selection_pending_=false;
      if (ok) { self->AnnotateEditElement(result,generation); return; }
      const auto error=Text(result,"error");
      self->EditEvent(nullptr,error.empty() ? "Could not select this element. Try an element in the main page." : error);
    };
    HideEditHighlight([self,generation,node,finish](bool ok,Dict result) {
      if (generation!=self->edit_generation_) return;
      if (!ok) { self->editing_=true; finish(false,Error("Could not exit edit mode. Click Done or press Esc to retry.")); return; }
      self->EnsureWorld([self,generation,node,finish](bool ok,Dict result) {
        if (!ok || generation!=self->edit_generation_) { finish(false,result); return; }
        auto params=Object(); params->SetInt("backendNodeId",node); params->SetInt("executionContextId",self->context_id_);
        self->Dev("DOM.resolveNode",params,[self,generation,finish](bool ok,Dict result) {
          auto object=result ? result->GetDictionary("object") : nullptr;
          const auto object_id=Text(object,"objectId");
          if (!ok || object_id.empty() || generation!=self->edit_generation_) {
            if (!object_id.empty()) {
              auto release=Object(); release->SetString("objectId",object_id);
              self->Dev("Runtime.releaseObject",release,[](bool,Dict) {});
            }
            finish(false,result); return;
          }
          auto params=Object(); params->SetString("objectId",object_id); params->SetString("functionDeclaration",kBrowserEditSelection);
          params->SetBool("returnByValue",true); params->SetBool("awaitPromise",false);
          auto argument=Object(); argument->SetBool("value",true);
          auto arguments=CefListValue::Create(); arguments->SetSize(1); arguments->SetDictionary(0,argument); params->SetList("arguments",arguments);
          self->Dev("Runtime.callFunctionOn",params,[self,object_id,generation,finish](bool ok,Dict result) {
            auto release=Object(); release->SetString("objectId",object_id);
            self->Dev("Runtime.releaseObject",release,[](bool,Dict) {});
            auto remote=result ? result->GetDictionary("result") : nullptr;
            auto value=remote ? remote->GetDictionary("value") : nullptr;
            auto selection=value ? value->GetDictionary("selection") : nullptr;
            auto capture=value ? value->GetDictionary("capture") : nullptr;
            if (!ok || !result || result->HasKey("exceptionDetails") || !selection || !capture || generation!=self->edit_generation_) {
              finish(false,Error("Could not select this element. Try an element in the main page.")); return;
            }
            self->CaptureEditElement(selection,capture,generation,finish);
          });
        });
      });
    });
  }
  void Dom(const std::string& request,Dict operation) {
    operation=supermono::OwnAgentDomRequest(operation);
    const auto action=Text(operation,"action");
    if (!operation || (action!="snapshot"&&action!="fill"&&action!="click") || Json(operation).size()>70000) { Result(id_,request,false,Error("Invalid browser action")); return; }
    CefRefPtr<Page> self=this;
    EnsureWorld([self,request,operation](bool ok,Dict world) {
      if (!ok) { Result(self->id_,request,false,world); return; }
      auto params=Object(); params->SetString("expression",std::string(kAgentDomSource)+"("+Json(operation)+")");
      params->SetInt("contextId",self->context_id_); params->SetBool("returnByValue",true); params->SetBool("awaitPromise",false);
      params->SetBool("userGesture",true); params->SetInt("timeout",5000);
      self->Dev("Runtime.evaluate",params,[self,request](bool ok,Dict value) {
        if (!ok) { self->context_id_=0; Result(self->id_,request,false,value); return; }
        if (value->HasKey("exceptionDetails")) { Result(self->id_,request,false,Error("Page changed during the operation. Take a new snapshot.")); return; }
        auto remote=value->GetDictionary("result"); const auto serialized=Text(remote,"value");
        if (serialized.size()>512*1024) { Result(self->id_,request,false,Error("Browser snapshot exceeded its limit")); return; }
        auto result=Parse(serialized);
        if (!result) { Result(self->id_,request,false,Error("Browser returned an invalid action result")); return; }
        auto error=Text(result,"__supermonoAgentError");
        Result(self->id_,request,error.empty(),error.empty()?result:Error(error));
      });
    });
  }
  void Screenshot(const std::string& request) {
    if (screenshot_running_ || zoom_.pending()) { Result(id_,request,false,Error("The browser is finishing another image or zoom change")); return; }
    auto params=Object(); params->SetString("format","png"); params->SetBool("captureBeyondViewport",false);
    CefRefPtr<Page> self=this;
    CaptureScreenshot(params,[self,request](bool ok,Dict result) {
      if (ok) { if (Text(result,"data").size()>10*1024*1024) { Result(self->id_,request,false,Error("Screenshot exceeded its limit")); return; } result->SetString("mimeType","image/png"); }
      Result(self->id_,request,ok,result);
    });
  }
  void CaptureScreenshot(Dict params,Completion callback) {
    screenshot_running_=true;
    const bool restores_geometry=params->GetType("fromSurface")!=VTYPE_BOOL || params->GetBool("fromSurface");
    CefRefPtr<Page> self=this;
    auto delivered=std::make_shared<bool>(false);
    const auto notify=[delivered,callback](bool ok,Dict result) {
      if (*delivered) return;
      *delivered=true;
      callback(ok,result);
    };
    Dev("Page.captureScreenshot",params,[self,notify,restores_geometry](bool ok,Dict result) {
      self->ScreenshotFinished(restores_geometry);
      notify(ok,result);
    },notify);
  }
  void ScreenshotFinished(bool restores_geometry) {
    screenshot_running_=false;
    // Screenshot completion restores old widget bounds even after cancellation.
    // Reconcile the current host geometry and any zoom requested meanwhile.
    if (restores_geometry) Layout();
    ApplyZoom();
  }
  void Press(const std::string& request,const std::string& key) {
    static const std::map<std::string,int> keys={{"Enter",13},{"Tab",9},{"Escape",27},{"Backspace",8},{"Delete",46},
      {"ArrowUp",38},{"ArrowDown",40},{"ArrowLeft",37},{"ArrowRight",39},{"Home",36},{"End",35},{"PageUp",33},{"PageDown",34}};
    auto found=keys.find(key);
    if (found==keys.end()) { Result(id_,request,false,Error("Unsupported browser key")); return; }
    auto params=Object(); params->SetString("type","keyDown"); params->SetString("key",key); params->SetString("code",key);
    params->SetInt("windowsVirtualKeyCode",found->second);
    if (key=="Enter") { params->SetString("text","\r"); params->SetString("unmodifiedText","\r"); }
    CefRefPtr<Page> self=this;
    Dev("Input.dispatchKeyEvent",params,[self,request,key,code=found->second](bool ok,Dict result) {
      if (!ok) { Result(self->id_,request,false,result); return; }
      auto up=Object(); up->SetString("type","keyUp"); up->SetString("key",key); up->SetString("code",key); up->SetInt("windowsVirtualKeyCode",code);
      self->Dev("Input.dispatchKeyEvent",up,[self,request](bool ok,Dict result) { Result(self->id_,request,ok,result); });
    });
  }
  void Scroll(const std::string& request,double dx,double dy) {
    if (!std::isfinite(dx)||!std::isfinite(dy)||std::abs(dx)>2000||std::abs(dy)>2000) { Result(id_,request,false,Error("Scroll distances must be finite and at most 2000 pixels")); return; }
    auto params=Object(); params->SetString("type","mouseWheel"); params->SetDouble("x",std::max(1.0,w_/2)); params->SetDouble("y",std::max(1.0,h_/2));
    params->SetDouble("deltaX",dx); params->SetDouble("deltaY",dy);
    CefRefPtr<Page> self=this;
    Dev("Input.dispatchMouseEvent",params,[self,request](bool ok,Dict result) { Result(self->id_,request,ok,result); });
  }

  std::string id_;
  __strong NSView *parent_=nil;
  __strong NSView *clip_view_=nil;
  __strong SMBrowserDropIndicator *drop_indicator_=nil;
  __strong SMBrowserEditAnnotation *edit_annotation_=nil;
  double x_=0,y_=0,w_=1,h_=1,clip_left_=0,clip_right_=0,viewport_height_=0,bottom_corner_radius_=0;
  bool visible_=false, auto_resize_=false;

 private:
  struct PromptState {
    __strong NSAlert *alert=nil;
    std::function<void(bool)> completion;
  };
  void Prompt(CefRefPtr<CefBrowser> browser,const std::string& kind,const std::string& origin,
      const std::string& description,std::function<void(bool)> completion) {
    NSWindow *window=[(__bridge NSView*)browser->GetHost()->GetWindowHandle() window];
    if (!window || closing_ || !AllowedUrl(origin) || prompts_.size()>=4) { completion(false); return; }
    auto prompt=std::make_shared<PromptState>(); prompt->completion=std::move(completion);
    prompt->alert=[NSAlert new]; prompt->alert.messageText=Ns(description+"?"); prompt->alert.informativeText=Ns(origin);
    [prompt->alert addButtonWithTitle:@"Deny"]; [prompt->alert addButtonWithTitle:@"Allow"];
    const auto key=std::to_string(browser->GetIdentifier())+":"+kind;
    prompts_[key]=prompt; CefRefPtr<Page> self=this;
    [prompt->alert beginSheetModalForWindow:window completionHandler:^(NSModalResponse response) {
      self->prompts_.erase(key);
      if (prompt->completion) { auto done=std::move(prompt->completion); prompt->completion=nullptr; done(response==NSAlertSecondButtonReturn && !self->closing_); }
    }];
  }
  void DismissPrompts(int browser_id) {
    const auto prefix=std::to_string(browser_id)+":";
    std::vector<std::shared_ptr<PromptState>> close;
    for (auto it=prompts_.begin();it!=prompts_.end();) {
      if (it->first.rfind(prefix,0)==0) { close.push_back(it->second); it=prompts_.erase(it); } else ++it;
    }
    for (auto& prompt:close) {
      if (prompt->completion) { auto done=std::move(prompt->completion); prompt->completion=nullptr; done(false); }
      [prompt->alert.window.sheetParent endSheet:prompt->alert.window returnCode:NSAlertFirstButtonReturn];
    }
  }
  static void MaybeShutdown();
  CefRefPtr<CefBrowser> browser_;
  __strong SMBrowserActionsMenu *actions_menu_=nil;
  CefRefPtr<DevToolsClient> devtools_client_;
  CefRefPtr<CefRegistration> registration_;
  std::map<int,CefRefPtr<CefBrowser>> popups_;
  std::map<int,Completion> pending_;
  std::map<std::string,CefRefPtr<CefDownloadItemCallback>> downloads_;
  std::map<std::string,std::string> download_names_;
  std::map<std::string,std::shared_ptr<PromptState>> prompts_;
  int dev_sequence_=0,context_id_=0,find_count_=0,find_ordinal_=0;
  uint64_t prompt_sequence_=0;
  supermono::BrowserTabZoom zoom_;
  std::vector<Completion> zoom_waiters_;
  bool closing_=false;
  bool editing_=false;
  bool edit_selection_pending_=false;
  bool screenshot_running_=false;
  uint64_t edit_generation_=0;
  std::string edit_token_;
  std::string title_,error_,notice_,find_query_;
  std::string favicon_,favicon_url_;
  uint64_t favicon_generation_=0;
  IMPLEMENT_REFCOUNTING(Page);
};

void FinishShutdownNow() {
  if (!initialized || !stopping || !pages.empty() || live_browser_count) return;
  KillPumpTimer();
  profiles.clear(); CefShutdown(); initialized=false; application=nullptr;
  // Cocoa runtime classes remain registered until process exit, so retain the
  // loaded framework. CefScopedSendingEvent itself only calls NSApp selectors.
}
void FinishShutdown() {
  if (!initialized || !stopping || !pages.empty() || live_browser_count) return;
  // Do not call CefShutdown from inside a CEF callback stack.
  dispatch_async(dispatch_get_main_queue(),^{
    if (!initialized || !pages.empty() || live_browser_count) return;
    FinishShutdownNow();
  });
}
void Page::MaybeShutdown() { FinishShutdown(); }
CefRefPtr<Page> FindPage(const char *id) {
  if (!ValidId(id)) { Fail("Invalid browser ID"); return nullptr; }
  auto it=pages.find(id); if (it==pages.end()) { Fail("Browser does not exist"); return nullptr; } return it->second;
}
} // namespace

@implementation SMChromiumPump
- (void)scheduleWork:(NSNumber*)delay { HandlePumpSchedule(delay.longLongValue); }
- (void)timerFired:(NSTimer*)timer { HandlePumpTimer(); }
@end

extern "C" int sm_chromium_initialize(const char *config_json,sm_chromium_event_cb cb,void *context) {
  @autoreleasepool { try {
    if (!MainThread()) return 0;
    if (initialized) return stopping ? Fail("Chromium is shutting down") : 1;
    if (stopping) return Fail("Chromium cannot restart during application shutdown");
    if (!config_json || strlen(config_json)>65536 || !cb) return Fail("Invalid Chromium configuration");
    // Parse configuration with Foundation before any dynamic CEF calls.
    NSData *data=[Ns(config_json) dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *config=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (![config isKindOfClass:NSDictionary.class]) return Fail("Invalid Chromium configuration");
    auto string=[&](NSString *key)->NSString* { id value=config[key]; return [value isKindOfClass:NSString.class]?value:@""; };
    NSString *framework=string(@"frameworkPath"), *cache=string(@"cachePath"), *helper=string(@"helperPath");
    if (!framework.isAbsolutePath || !cache.isAbsolutePath || !helper.isAbsolutePath) return Fail("Chromium requires absolute framework, cache and helper paths");
    NSString *binary=[framework stringByAppendingPathComponent:@"Chromium Embedded Framework"];
    if (![NSFileManager.defaultManager isExecutableFileAtPath:helper] || ![NSFileManager.defaultManager fileExistsAtPath:binary]) return Fail("The Chromium framework or sandbox helper is missing");
    if (!library_loaded) { if (!cef_load_library(binary.UTF8String)) return Fail("Chromium framework could not be loaded"); library_loaded=true; }
    if (!InstallApplicationIntegration()) return Fail("Chromium could not attach to the macOS application");
    NSError *directory_error=nil;
    if (![NSFileManager.defaultManager createDirectoryAtPath:cache withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:&directory_error]) return Fail("Chromium profile directory is not writable");
    cache_root=Str(cache.stringByStandardizingPath); download_root=Str(string(@"downloadPath")); dev_origin=Origin([NSURL URLWithString:string(@"devUrl")]);
    CefSettings settings; settings.no_sandbox=false; settings.external_message_pump=true; settings.multi_threaded_message_loop=false; settings.command_line_args_disabled=true;
    CefString(&settings.framework_dir_path)=Str(framework); CefString(&settings.browser_subprocess_path)=Str(helper);
    CefString(&settings.main_bundle_path)=Str(NSBundle.mainBundle.bundlePath);
    CefString(&settings.root_cache_path)=cache_root; CefString(&settings.cache_path)=cache_root+"/Default";
    if (string(@"resourcesPath").length) CefString(&settings.resources_dir_path)=Str(string(@"resourcesPath"));
    settings.persist_session_cookies=true; settings.log_severity=LOGSEVERITY_ERROR;
    CefString(&settings.log_file)=cache_root+"/chromium.log";
    pump_handler=[SMChromiumPump new];
    application=new Application; event_callback=cb; event_context=context;
    initialized=true;
    if (!CefInitialize(CefMainArgs(*_NSGetArgc(),*_NSGetArgv()),settings,application,nullptr)) { initialized=false; application=nullptr; return Fail("Chromium initialization failed"); }
    SchedulePump(0); last_error.clear(); return 1;
  } catch (const std::exception& e) { return Fail(e.what()); } catch (...) { return Fail("Chromium initialization failed"); } }
}
extern "C" int sm_chromium_create(const char *id,void *parent,const char *url,const char *profile,
    double x,double y,double w,double h) {
  @autoreleasepool { try {
    if (!MainThread()) return 0;
    if (!initialized || stopping) return Fail("Chromium is not available");
    if (!ValidId(id) || !parent || !url || !Geometry(x,y,w,h) || !AllowedUrl(url)) return Fail("Invalid browser creation request");
    if (pages.contains(id) || pages.size()>=128) return Fail("Browser ID already exists or tab limit reached");
    std::string path=profile&&*profile ? Str(Ns(profile).stringByStandardizingPath) : cache_root+"/Default";
    if (path!=cache_root && path.rfind(cache_root+"/",0)!=0) return Fail("Browser profile must be inside the app Chromium profile directory");
    auto found=profiles.find(path); CefRefPtr<CefRequestContext> request_context;
    if (found!=profiles.end()) request_context=found->second;
    else { CefRequestContextSettings settings; CefString(&settings.cache_path)=path; settings.persist_session_cookies=true; request_context=CefRequestContext::CreateContext(settings,nullptr); profiles[path]=request_context; }
    CefRefPtr<Page> page=new Page(id); page->parent_=(__bridge NSView*)parent; page->x_=x; page->y_=y; page->w_=w; page->h_=h;
    page->parent_.wantsLayer=YES;
    page->clip_view_=[[NSView alloc] initWithFrame:WorkspaceFrame(page->parent_,x,y,w,h)];
    page->clip_view_.wantsLayer=YES;
    page->clip_view_.clipsToBounds=YES; page->clip_view_.hidden=YES;
    [page->parent_ addSubview:page->clip_view_];
    CefWindowInfo window; window.SetAsChild((__bridge CefWindowHandle)page->clip_view_,CefRect(0,0,std::max(w,1.0),std::max(h,1.0)));
    window.runtime_style=CEF_RUNTIME_STYLE_ALLOY;
    window.hidden=true;
    // Unstyled documents and legacy frames expect the browser's white canvas.
    // This fallback must not inherit the surrounding application's dark theme.
    CefBrowserSettings settings; settings.background_color=CefColorSetARGB(255,255,255,255);
    pages[id]=page;
    if (!CefBrowserHost::CreateBrowser(window,page,url,settings,nullptr,request_context)) { [page->clip_view_ removeFromSuperview]; pages.erase(id); return Fail("Chromium could not create the tab"); }
    // Pumping stops at zero pages. Explicitly wake when a new page is accepted,
    // even if Chromium already considers an older scheduling callback pending.
    SchedulePump(0);
    last_error.clear(); return 1;
  } catch (const std::exception& e) { return Fail(e.what()); } catch (...) { return Fail("Chromium tab creation failed"); } }
}
extern "C" int sm_chromium_layout(const char *id,double x,double y,double w,double h,int visible,double clip_left,double clip_right,double viewport_height,double bottom_corner_radius) {
  @autoreleasepool { if (!MainThread()) return 0; auto page=FindPage(id); if (!page) return 0;
    if (!Geometry(x,y,w,h) || !std::isfinite(clip_left) || !std::isfinite(clip_right) || clip_left<0 || clip_right<0 || clip_left+clip_right>w || !std::isfinite(viewport_height) || viewport_height<0 || viewport_height>262144 || !std::isfinite(bottom_corner_radius) || bottom_corner_radius<0 || bottom_corner_radius>262144) return Fail("Invalid browser bounds");
    page->x_=x; page->y_=y; page->w_=w; page->h_=h; page->clip_left_=clip_left; page->clip_right_=clip_right; page->viewport_height_=viewport_height; page->bottom_corner_radius_=bottom_corner_radius; page->visible_=visible; page->Layout(); return 1; }
}
extern "C" int sm_chromium_reparent(const char *id,void *parent,double x,double y,double w,double h,double inset) {
  @autoreleasepool { if (!MainThread()) return 0; auto page=FindPage(id); if (!page) return 0;
    if (!parent || !Geometry(x,y,w,h) || !std::isfinite(inset)) return Fail("Invalid browser parent or bounds");
    [page->drop_indicator_ clear];
    if (page->EditActive()) page->EditMode(false);
    page->parent_=(__bridge NSView*)parent; page->x_=x; page->y_=y; page->w_=w; page->h_=h; page->clip_left_=page->clip_right_=page->viewport_height_=page->bottom_corner_radius_=0; page->auto_resize_=inset>=0; page->Layout(); return 1; }
}
extern "C" int sm_chromium_command(const char *id,const char *request_id,const char *json) {
  @autoreleasepool { try {
    if (!MainThread()) return 0; auto page=FindPage(id); if (!page) return 0;
    if (!json || strlen(json)>128*1024 || (request_id && strlen(request_id)>200)) return Fail("Invalid browser command");
    auto command=Parse(json); if (!command) return Fail("Invalid browser command JSON");
    page->Command(request_id?request_id:"",command); return 1;
  } catch (const std::exception& e) { return Fail(e.what()); } catch (...) { return Fail("Chromium command failed"); } }
}
extern "C" int sm_chromium_menu(const char *id,const char *request_id,void *parent,const char *json) {
  @autoreleasepool { try {
    if (!MainThread()) return 0; auto page=FindPage(id); if (!page) return 0;
    if (!parent || !json || strlen(json)>4096 || !request_id || strlen(request_id)>200) return Fail("Invalid browser menu request");
    auto command=Parse(json); if (!command) return Fail("Invalid browser menu JSON");
    page->Menu(request_id,(__bridge NSView*)parent,command); return 1;
  } catch (const std::exception& e) { return Fail(e.what()); } catch (...) { return Fail("Browser menu failed"); } }
}
extern "C" int sm_chromium_close(const char *id) {
  @autoreleasepool { if (!MainThread()) return 0; auto page=FindPage(id); if (!page) return 0; page->Close(); return 1; }
}
extern "C" int sm_chromium_is_focused(const char *id) {
  @autoreleasepool { if (!MainThread()) return 0; auto page=FindPage(id); return page && page->Focused(); }
}
extern "C" int sm_chromium_live_browser_count() { return MainThread() ? live_browser_count : -1; }
extern "C" void sm_chromium_shutdown() {
  @autoreleasepool { if (!MainThread() || !initialized) return; stopping=true; auto close=pages; for (auto& entry:close) entry.second->Close(); FinishShutdownNow(); }
}
extern "C" const char *sm_chromium_last_error() { return last_error.c_str(); }
