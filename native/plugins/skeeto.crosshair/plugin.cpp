// GPL-3.0. Skeeto drawing port; provenance and complete source in SOURCE.md.
#define NOMINMAX
#include <windows.h>
#include <gdiplus.h>
#include "l4p_plugin.h"
#include <nlohmann/json.hpp>
#include <atomic>
#include <cmath>
#include <cstring>
#include <string>
#include <mutex>
#include <filesystem>
#include <fstream>
using nlohmann::json;
struct Settings { int style=0, color=2, size=100, alpha=100; };
static Settings settings;
static std::mutex settingsMutex;
static std::atomic<bool> readyOk{false}, visible{false};
static HANDLE worker=nullptr, stopEvent=nullptr, readyEvent=nullptr;
static L4P_HostApiV1 host{};
static std::filesystem::path configPath;
// Drawing state below belongs exclusively to the overlay thread.
static int g_xhairStyle=0, g_xhairDrawH=1080;
static constexpr COLORREF kXhairColorRgb[] = {RGB(255,255,255),RGB(255,80,80),RGB(80,255,80),RGB(80,200,255),RGB(255,220,60),RGB(220,90,255)};
static constexpr int kXhairColorCount=6;
#include "drawing.inc"

static Settings parseSettings(const json& input) {
    if (!input.is_object()) throw std::runtime_error("object required");
    Settings s;
    auto get=[&](const char* key, int initial, int lo, int hi) {
        if (!input.contains(key)) return initial;
        const auto& v=input.at(key);
        if (!v.is_number_integer()) throw std::runtime_error("integer required");
        auto n=v.get<int64_t>(); if(n<lo || n>hi) throw std::runtime_error("out of range");
        return int(n);
    };
    for (auto it=input.begin();it!=input.end();++it)
        if(it.key()!="style" && it.key()!="color" && it.key()!="size" && it.key()!="alpha") throw std::runtime_error("unknown setting");
    s.style=get("style",0,0,19); s.color=get("color",2,0,5);
    s.size=get("size",100,25,300); s.alpha=get("alpha",100,10,100); return s;
}
static json settingsJson(const Settings& s) { return {{"style",s.style},{"color",s.color},{"size",s.size},{"alpha",s.alpha}}; }
static LRESULT CALLBACK windowProc(HWND w,UINT m,WPARAM a,LPARAM b) {
    if(m==WM_NCHITTEST) return HTTRANSPARENT;
    if(m==WM_MOUSEACTIVATE) return MA_NOACTIVATE;
    return DefWindowProcW(w,m,a,b);
}
static bool draw(HWND window,HWND target,const Settings& s) {
    RECT rc{}; POINT origin{};
    if(!GetClientRect(target,&rc) || rc.right<80 || rc.bottom<80 || !ClientToScreen(target,&origin)) return false;
    g_xhairStyle=s.style; g_xhairDrawH=rc.bottom;
    g_xhairCurrent=kXhairFactory[s.style];
    g_xhairCurrent.color=s.color; g_xhairCurrent.size=s.size; g_xhairCurrent.alpha=s.alpha;
    const int side=XhairWantWin();
    Gdiplus::Bitmap bitmap(side,side,PixelFormat32bppPARGB);
    {
        Gdiplus::Graphics graphics(&bitmap);
        graphics.SetSmoothingMode(Gdiplus::SmoothingModeAntiAlias);
        graphics.SetCompositingQuality(Gdiplus::CompositingQualityHighQuality);
        graphics.SetPixelOffsetMode(Gdiplus::PixelOffsetModeHalf);
        graphics.Clear(Gdiplus::Color(0,0,0,0));
        XhairDrawAll(graphics,side*.5f,side*.5f);
    }
    Gdiplus::BitmapData data{}; Gdiplus::Rect area(0,0,side,side);
    if(bitmap.LockBits(&area,Gdiplus::ImageLockModeRead,PixelFormat32bppPARGB,&data)!=Gdiplus::Ok) return false;
    BITMAPINFO info{}; info.bmiHeader={sizeof(BITMAPINFOHEADER),side,-side,1,32,BI_RGB,0,0,0,0,0};
    HDC screen=GetDC(nullptr), memory=CreateCompatibleDC(screen); void* pixels=nullptr;
    HBITMAP dib=memory ? CreateDIBSection(memory,&info,DIB_RGB_COLORS,&pixels,nullptr,0) : nullptr;
    bool ok=false;
    if(dib && pixels && data.Scan0) {
        HGDIOBJ previous=SelectObject(memory,dib);
        for(int y=0;y<side;++y) std::memcpy(static_cast<BYTE*>(pixels)+y*side*4,static_cast<BYTE*>(data.Scan0)+y*data.Stride,side*4);
        POINT at{origin.x+(rc.right-side)/2,origin.y+(rc.bottom-side)/2}, source{}; SIZE size{side,side};
        BLENDFUNCTION blend{AC_SRC_OVER,0,255,AC_SRC_ALPHA};
        ok=!!UpdateLayeredWindow(window,screen,&at,&size,memory,&source,0,&blend,ULW_ALPHA);
        SelectObject(memory,previous);
    }
    if(dib) DeleteObject(dib); if(memory) DeleteDC(memory); if(screen) ReleaseDC(nullptr,screen);
    bitmap.UnlockBits(&data); return ok;
}
static DWORD WINAPI run(void*) {
    // Use physical coordinates without changing the game's process DPI policy.
    SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    ULONG_PTR token=0; Gdiplus::GdiplusStartupInput startup;
    HINSTANCE instance=nullptr;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
        reinterpret_cast<LPCWSTR>(&run),&instance);
    WNDCLASSW wc{}; wc.hInstance=instance; wc.lpfnWndProc=windowProc; wc.lpszClassName=L"Flare.Skeeto.StaticCrosshair";
    HWND window=nullptr; const bool gdi=Gdiplus::GdiplusStartup(&token,&startup,nullptr)==Gdiplus::Ok;
    ATOM atom=gdi ? RegisterClassW(&wc) : 0;
    if(atom) window=CreateWindowExW(WS_EX_LAYERED|WS_EX_TRANSPARENT|WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE,
        wc.lpszClassName,L"Flare Static Crosshair",WS_POPUP,0,0,32,32,nullptr,nullptr,instance,nullptr);
    readyOk=window!=nullptr; SetEvent(readyEvent);
    if(window) {
        HWND lastTarget=nullptr; RECT lastRect{}; std::string lastSettings;
        while(WaitForSingleObject(stopEvent,0)==WAIT_TIMEOUT) {
            MSG message; while(PeekMessageW(&message,nullptr,0,0,PM_REMOVE)) { TranslateMessage(&message); DispatchMessageW(&message); }
            HWND target=GetForegroundWindow(); DWORD pid=0; wchar_t cls[128]{};
            GetWindowThreadProcessId(target,&pid); GetClassNameW(target,cls,128);
            const bool ownGame=pid==GetCurrentProcessId() && wcscmp(cls,L"Valve001")==0 && !IsIconic(target);
            if(ownGame) {
                Settings s; {std::lock_guard<std::mutex> lock(settingsMutex); s=settings;}
                RECT rect{}; GetWindowRect(target,&rect); auto signature=settingsJson(s).dump();
                if(target!=lastTarget || !EqualRect(&rect,&lastRect) || signature!=lastSettings || !visible) {
                    bool painted=draw(window,target,s);
                    if(painted) {SetWindowPos(window,HWND_TOPMOST,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE|SWP_SHOWWINDOW); lastTarget=target;lastRect=rect;lastSettings=signature;visible=true;}
                    else {ShowWindow(window,SW_HIDE);visible=false;}
                }
            } else if(visible.exchange(false)) ShowWindow(window,SW_HIDE);
            MsgWaitForMultipleObjects(1,&stopEvent,FALSE,33,QS_ALLINPUT);
        }
        visible=false; DestroyWindow(window);
    }
    if(atom) UnregisterClassW(wc.lpszClassName,instance);
    if(gdi) Gdiplus::GdiplusShutdown(token);
    return 0;
}
static void L4P_CALL shutdown() {
    if(stopEvent) SetEvent(stopEvent);
    if(worker) {WaitForSingleObject(worker,INFINITE);CloseHandle(worker);worker=nullptr;}
    if(stopEvent) {CloseHandle(stopEvent);stopEvent=nullptr;}
    if(readyEvent) {CloseHandle(readyEvent);readyEvent=nullptr;}
    readyOk=false;
}
static uint32_t L4P_CALL initialize(const L4P_HostApiV1* api) {
    if(!api || api->api_version!=1 || api->struct_size!=sizeof(*api) || !api->log || !api->plugin_directory || !api->config_json || worker) return L4P_BAD_ARGUMENT;
    try {settings=parseSettings(json::parse(api->config_json));configPath=std::filesystem::u8path(api->plugin_directory)/L"config.json";} catch(...) {return L4P_BAD_ARGUMENT;}
    host=*api; readyOk=false; stopEvent=CreateEventW(nullptr,TRUE,FALSE,nullptr);readyEvent=CreateEventW(nullptr,TRUE,FALSE,nullptr);
    if(stopEvent && readyEvent) worker=CreateThread(nullptr,0,run,nullptr,0,nullptr);
    if(!worker || WaitForSingleObject(readyEvent,5000)!=WAIT_OBJECT_0 || !readyOk) {shutdown();return L4P_ERROR;}
    host.log(host.context,L4P_LOG_INFO,"Skeeto-derived static crosshair ready; windowed display, local-only pending game validation"); return L4P_OK;
}
static uint32_t L4P_CALL invoke(const char* action,const char* params,char* output,uint32_t capacity,uint32_t* size) {
    if(!action || !params || !output || !size || !readyOk) return L4P_BAD_ARGUMENT;
    try {
        bool configure=std::strcmp(action,"configure")==0;
        if(!configure && std::strcmp(action,"status")) return L4P_BAD_ARGUMENT;
        auto input=json::parse(params); if(!input.is_object()) return L4P_BAD_ARGUMENT;
        Settings s; {std::lock_guard<std::mutex> lock(settingsMutex);s=settings;}
        if(configure) s=parseSettings(input);
        auto result=json{{"settings",settingsJson(s)},{"visible",visible.load()},{"scope","static-window-center"}}.dump();
        *size=uint32_t(result.size()+1); if(capacity<*size) return L4P_BUFFER_TOO_SMALL;
        if(configure) {
            auto pending=configPath; pending+=L".pending";
            {std::ofstream stream(pending,std::ios::binary|std::ios::trunc);stream<<settingsJson(s).dump(2);stream.flush();if(!stream) return L4P_ERROR;}
            if(!MoveFileExW(pending.c_str(),configPath.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)) {DeleteFileW(pending.c_str());return L4P_ERROR;}
            std::lock_guard<std::mutex> lock(settingsMutex);settings=s;
        }
        std::memcpy(output,result.c_str(),*size);return L4P_OK;
    } catch(...) {return L4P_BAD_ARGUMENT;}
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetPluginApi(uint32_t version,L4P_PluginApiV1* output) {
    if(version!=1) return L4P_UNSUPPORTED_VERSION;
    if(!output || output->api_version!=1 || output->struct_size!=sizeof(*output)) return L4P_BAD_ARGUMENT;
    *output={1,sizeof(*output),"skeeto.crosshair","0.1.0",initialize,invoke,shutdown};return L4P_OK;
}
