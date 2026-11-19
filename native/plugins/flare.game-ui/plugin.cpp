#define NOMINMAX
#include <windows.h>
#include <commctrl.h>
#include <atomic>
#include "vgui.hpp"

static_assert(sizeof(void*) == 4, "Game UI API 1 targets Windows x86");

namespace {
using namespace game_ui;
using Paint = void (__thiscall*)(void*,int);
using Bool = bool (__thiscall*)(void*);
using Channel = void* (__thiscall*)(void*);
using Screen = void (__thiscall*)(void*,int&,int&);
constexpr UINT_PTR SubclassId = 1;
constexpr int PaintUi = 1, PaintGame = 2;

struct Session {
    CRITICAL_SECTION lock{};
    std::atomic<bool> lockReady{false};
    std::atomic<Paint> original{nullptr};
    std::atomic<bool> wantsPaint{false};
    Menu menu;
    Presentation presentation;
    Surface surface;
    bool running{}, dispatchFrames{};
    HMODULE engineModule{};
    void* engine{};
    void* gui{};
    void** slot{};
    Bool inGame{}, inLoad{}, showGameUi{};
    Channel channel{};
    Screen screen{};
    void** chanTable{};
    Bool loopback{};
    HWND window{};
    unsigned windowAttempt{};
    HANDLE stop{}, bootstrap{};
    bool captured[256]{};
    uint32_t captureOwner[256]{};
    bool chars[512]{};
    L4P_LogFn log{};
    void* logCtx{};

    void update() {
        bool clients = false; dispatchFrames = false;
        for (const auto& m : menu.modules) if (m.token) { clients = true; dispatchFrames |= m.api.frame != nullptr; }
        wantsPaint.store(running && clients && (dispatchFrames || !window || menu.open), std::memory_order_release);
    }
    bool local() {
        auto* nc = channel(engine);
        if (!nc) { chanTable = nullptr; loopback = nullptr; return false; }
        // The already-verified engine owns the channel. Check a changed vtable
        // once, then reuse the IsLoopback dispatch through the current object.
        auto** v = *static_cast<void***>(nc);
        if (v != chanTable) { chanTable = v; loopback = method<Bool>(table(nc,7),6); }
        return loopback && loopback(nc);
    }
};
Session session;
Session& state() { return session; }
struct Guard {
    CRITICAL_SECTION& lock;
    explicit Guard(CRITICAL_SECTION& value):lock(value) { EnterCriticalSection(&lock); }
    ~Guard(){ LeaveCriticalSection(&lock); }
    Guard(const Guard&)=delete;
};
thread_local bool painting{}, drawingAllowed{};

// Steady milliseconds for the menu's opening transition (GetTickCount is ~16 ms coarse).
uint32_t clock_ms() {
    static const int64_t frequency = [] { LARGE_INTEGER f{}; QueryPerformanceFrequency(&f); return f.QuadPart; }();
    LARGE_INTEGER c{};
    if (frequency <= 0 || !QueryPerformanceCounter(&c)) return 1;
    const auto ms = uint32_t(c.QuadPart / frequency * 1000 + c.QuadPart % frequency * 1000 / frequency);
    return ms ? ms : 1;
}

LRESULT CALLBACK game_window(HWND hwnd,UINT msg,WPARAM w,LPARAM l,UINT_PTR,DWORD_PTR) {
    // Paint and raw mouse traffic use the existing game's window procedure.
    if (msg != WM_NCDESTROY && msg != WM_KILLFOCUS && msg != WM_ACTIVATEAPP &&
        msg != WM_SIZE && msg != WM_DISPLAYCHANGE &&
        (msg < WM_KEYFIRST || msg > WM_SYSCHAR)) return DefSubclassProc(hwnd,msg,w,l);
    auto& s = state(); bool eat = false;
    {
        Guard lock(s.lock);
        if (msg == WM_NCDESTROY || !s.running) {
            RemoveWindowSubclass(hwnd, game_window, SubclassId);
            if (s.window == hwnd) { s.menu.close(s.running); s.window = nullptr; s.update(); }
        } else {
            const bool lost = msg == WM_KILLFOCUS || (msg == WM_ACTIVATEAPP && !w);
            if (lost) {
                s.menu.close();
                std::fill(std::begin(s.captured), std::end(s.captured), false);
                std::fill(std::begin(s.captureOwner), std::end(s.captureOwner), 0);
                std::fill(std::begin(s.chars), std::end(s.chars), false);
                s.update();
            }
            const bool keyDown = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
            const unsigned scan = (uint32_t(l)>>16)&0x1ffu;
            if (keyDown && w < 256 && s.window == GetForegroundWindow()) {
                const bool repeat = (uint32_t(l) & (1u << 30)) != 0;
                uint32_t owner = 0;
                if (repeat && s.captured[w]) {
                    eat = true; owner = s.captureOwner[w];
                    if (s.menu.open && !owner && w != VK_F7) s.menu.key(unsigned(w), true);
                    else if (!s.menu.open && owner) {
                        if (auto* m = s.menu.find(owner); m && m->api.input)
                            m->api.input(m->api.context,msg,uint32_t(w),int32_t(l));
                    }
                } else if (!repeat && w == VK_F7 && (GetKeyState(VK_CONTROL)&0x8000)) {
                    eat = s.menu.toggle();
                } else if (!repeat && s.menu.open && msg == WM_KEYDOWN) {
                    eat = s.menu.key(unsigned(w), false);
                } else if (!repeat && !s.menu.open) {
                    for (const auto& m : s.menu.modules) if (m.token && m.api.input &&
                        m.api.input(m.api.context, msg, uint32_t(w), int32_t(l))) { eat = true; owner=m.token; break; }
                }
                if (eat) { s.captured[w] = true; s.captureOwner[w]=owner; s.chars[scan] = true; s.update(); }
            } else if ((msg == WM_KEYUP || msg == WM_SYSKEYUP) && w < 256) {
                eat = s.captured[w]; s.captured[w] = false; s.captureOwner[w]=0; s.chars[scan] = false;
            } else if (msg == WM_CHAR || msg == WM_SYSCHAR) {
                eat = s.chars[scan];
            } else if (lost || msg == WM_SIZE || msg == WM_DISPLAYCHANGE || msg == WM_ACTIVATEAPP) {
                for (const auto& m : s.menu.modules) if (m.token && m.api.input)
                    m.api.input(m.api.context, msg, uint32_t(w), int32_t(l));
            }
        }
    }
    return eat ? 0 : DefSubclassProc(hwnd,msg,w,l);
}
BOOL CALLBACK find_window(HWND hwnd,LPARAM arg) {
    wchar_t cls[32]{};
    if (!IsWindowVisible(hwnd) || !GetClassNameW(hwnd, cls, 32) || std::wcscmp(cls, L"Valve001")) return TRUE;
    auto& s = *reinterpret_cast<Session*>(arg);
    if (!SetWindowSubclass(hwnd,game_window,SubclassId,0)) return TRUE;
    s.window = hwnd;
    return FALSE;
}
void __fastcall paint(void* self,void*,int mode) {
    auto& s = state();
    auto original = s.original.load(std::memory_order_acquire);
    if (painting || !s.wantsPaint.load(std::memory_order_acquire) || !(mode&(PaintUi|PaintGame))) {
        if (original) original(self,mode);
        return;
    }
    painting = true;
    if (original) original(self,mode);
    {
        Guard lock(s.lock);
        if (s.running) {
            const auto now = GetTickCount();
            // Only search on the Paint thread, and only until its game window
            // has been found (or recreated).
            if (!s.window && (!s.windowAttempt || now-s.windowAttempt>=350)) {
                s.windowAttempt = now;
                EnumThreadWindows(GetCurrentThreadId(),find_window,reinterpret_cast<LPARAM>(&s));
                s.update();
            }
            if (s.window && (s.dispatchFrames || s.menu.open)) {
                const bool inGame = s.inGame(s.engine) && !s.inLoad(s.engine);
                const bool defaultUi = s.showGameUi(s.gui);
                const bool primary = (mode & (inGame && !defaultUi ? PaintGame : PaintUi)) != 0;
                drawingAllowed = true;
                if (s.dispatchFrames && primary) {
                    L4P_GameUiFrameV1 f{sizeof(f),now,inGame,inGame && s.local(),defaultUi,s.menu.open,s.window};
                    for (const auto& m : s.menu.modules) if (m.token && m.api.frame)
                        m.api.frame(m.api.context,&f);
                }
                if (s.menu.open && primary) {
                    int w = 0, h = 0;
                    s.screen(s.engine,w,h);
                    if (s.surface.begin()) s.presentation.draw(s.surface,s.menu,w,h,clock_ms());
                    else if (s.surface.unsupported) {
                        s.menu.close(); s.update();
                        s.log(s.logCtx,L4P_LOG_ERROR,"Game UI could not establish this build's VGUI drawing context.");
                    }
                }
                s.surface.finish();
                drawingAllowed = false;
            }
        }
    }
    painting = false;
}

enum class Attach { wait, ready, unsupported };
Attach attach(Session& s) {
    auto dll = GetModuleHandleW(L"engine.dll");
    if (!dll) return Attach::wait;
    if (!profile(dll,0x6a440ed6,0x73f000)) return Attach::unsupported;
    auto* eng = iface(dll,"VEngineClient013");
    auto* gui = iface(dll,"VEngineVGui001");
    if (!eng || !gui) return Attach::wait;
    auto** e = table(eng,75); auto** g = table(gui,15);
    s.screen = method<Screen>(e,5); s.inGame = method<Bool>(e,26); s.inLoad = method<Bool>(e,28);
    s.channel = method<Channel>(e,74); s.showGameUi = method<Bool>(g,2);
    auto prior = method<Paint>(g,14);
    if (!s.screen || !s.inGame || !s.inLoad || !s.channel || !s.showGameUi || !prior ||
        reinterpret_cast<void*>(prior) == reinterpret_cast<void*>(&paint))
        return Attach::unsupported;
    auto** slot = &g[14]; DWORD old{};
    if (!VirtualProtect(slot,sizeof(*slot),PAGE_READWRITE,&old)) return Attach::unsupported;
    s.engineModule = dll; s.engine = eng; s.gui = gui;
    s.original.store(prior,std::memory_order_release);
    auto* current = InterlockedCompareExchangePointer(slot,reinterpret_cast<void*>(&paint),reinterpret_cast<void*>(prior));
    DWORD ignored{}; VirtualProtect(slot,sizeof(*slot),old,&ignored);
    if (current != reinterpret_cast<void*>(prior)) return Attach::unsupported;
    s.slot = slot;
    return Attach::ready;
}
DWORD WINAPI bootstrap(void*) {
    auto& s = state();
    for (unsigned attempt=0; attempt<200; ++attempt) {
        if (WaitForSingleObject(s.stop,125) != WAIT_TIMEOUT) return 0;
        Guard lock(s.lock);
        const auto result = attach(s);
        if (result == Attach::ready) return 0;
        if (result == Attach::unsupported) break;
    }
    s.log(s.logCtx,L4P_LOG_ERROR,"Game UI could not attach to a supported VEngineVGui001.");
    return 0;
}
uint32_t L4P_CALL add(const L4P_GameUiModuleV1* api,uint32_t* token) {
    auto& s = state();
    Guard lock(s.lock);
    if (!s.running || !api || api->struct_size != sizeof(*api) || !api->id || !api->title ||
        !*api->title || !token || (api->page && !api->change) || (!api->change && !api->frame)) return L4P_BAD_ARGUMENT;
    auto n = std::strlen(api->id);
    if (!n || n > 64) return L4P_BAD_ARGUMENT;
    Module* target = nullptr;
    for (auto& m : s.menu.modules) {
        if (m.token && !std::strcmp(m.id,api->id)) return L4P_BAD_ARGUMENT;
        if (!m.token && !target) target = &m;
    }
    if (!target || !copy(target->title,api->title)) return L4P_ERROR;
    std::memcpy(target->id,api->id,n+1);
    target->api = *api;
    *token = target->token = s.menu.next++;
    s.update();
    return L4P_OK;
}
uint32_t L4P_CALL remove(uint32_t token) {
    auto& s = state(); Guard lock(s.lock);
    auto* m = s.menu.find(token);
    if (!m) return L4P_BAD_ARGUMENT;
    // Removal may be requested by the control thread. No plugin callbacks in
    // that thread; the caller owns its shutdown and pending saves.
    s.menu.close(false); *m = {}; s.update();
    return L4P_OK;
}
uint32_t L4P_CALL begin_draw() {
    return drawingAllowed && state().surface.begin() ? L4P_OK : L4P_ERROR;
}
uint32_t L4P_CALL init(const L4P_HostApiV1* host) {
    auto& s = state();
    if (s.lockReady || !host || !host->log || host->api_version!=1 || host->struct_size!=sizeof(*host)) return L4P_BAD_ARGUMENT;
    if (!InitializeCriticalSectionEx(&s.lock,0,0)) return L4P_ERROR;
    s.lockReady.store(true,std::memory_order_release);
    Guard lock(s.lock);
    s.log = host->log; s.logCtx = host->context;
    const auto result = attach(s);
    if (result == Attach::unsupported) {
        s.log(s.logCtx,L4P_LOG_ERROR,"Game UI supports this project's pinned L4D2 x86 engine build.");
        return L4P_ERROR;
    }
    if (result == Attach::wait) {
        s.stop = CreateEventW(nullptr,TRUE,FALSE,nullptr);
        if (!s.stop) return L4P_ERROR;
        s.bootstrap = CreateThread(nullptr,0,bootstrap,nullptr,0,nullptr);
        if (!s.bootstrap) { CloseHandle(s.stop); s.stop = nullptr; return L4P_ERROR; }
    }
    s.running = true;
    return L4P_OK;
}
uint32_t L4P_CALL invoke(const char*,const char*,char*,uint32_t,uint32_t*) { return L4P_BAD_ARGUMENT; }
void L4P_CALL shutdown() {
    auto& s = state();
    // Join only the one-shot bootstrap, outside the dispatch lock.
    if (s.stop) SetEvent(s.stop);
    if (s.bootstrap) { WaitForSingleObject(s.bootstrap,INFINITE); CloseHandle(s.bootstrap); s.bootstrap=nullptr; }
    if (s.stop) { CloseHandle(s.stop); s.stop=nullptr; }
    Guard lock(s.lock);
    s.running = false; s.menu.close(false); s.update();
    if (s.window && GetWindowThreadProcessId(s.window,nullptr)==GetCurrentThreadId()) {
        RemoveWindowSubclass(s.window,game_window,SubclassId); s.window=nullptr;
    }
    if (!s.slot || s.engineModule != GetModuleHandleW(L"engine.dll")) return;
    DWORD old{};
    if (VirtualProtect(s.slot,sizeof(void*),PAGE_READWRITE,&old)) {
        InterlockedCompareExchangePointer(s.slot,reinterpret_cast<void*>(s.original.load()),reinterpret_cast<void*>(&paint));
        DWORD ignored{}; VirtualProtect(s.slot,sizeof(void*),old,&ignored);
    }
    s.slot = nullptr;
}
}

extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetGameUiApi(uint32_t version,L4P_GameUiApiV1* out) {
    if (version != L4P_GAME_UI_VERSION) return L4P_UNSUPPORTED_VERSION;
    if (!out || out->api_version!=version || out->struct_size!=sizeof(*out)) return L4P_BAD_ARGUMENT;
    if (!state().lockReady.load(std::memory_order_acquire)) return L4P_ERROR;
    *out = {version,sizeof(*out),add,remove,begin_draw};
    return L4P_OK;
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetPluginApi(uint32_t version,L4P_PluginApiV1* out) {
    if (version != L4P_API_VERSION) return L4P_UNSUPPORTED_VERSION;
    if (!out || out->api_version!=version || out->struct_size!=sizeof(*out)) return L4P_BAD_ARGUMENT;
    *out = {version,sizeof(*out),"flare.game-ui","0.1.0",init,invoke,shutdown};
    return L4P_OK;
}
