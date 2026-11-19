#include "common.hpp"
#include "l4p_runtime.h"
namespace {
HMODULE self;
INIT_ONCE once = INIT_ONCE_STATIC_INIT;
L4P_RuntimeFactoryReadyFn ready = nullptr;
BOOL CALLBACK initialize(PINIT_ONCE, PVOID, PVOID*) noexcept {
    try {
        const auto root = l4p::module_path(self).parent_path().parent_path().parent_path() / L"l4p";
        auto module = l4p::load(root / L"l4p_runtime.dll");
        if (!module) return FALSE;
        auto start = reinterpret_cast<L4P_RuntimeInitializeFn>(GetProcAddress(module, "L4P_RuntimeInitialize"));
        auto render = reinterpret_cast<L4P_RuntimeFactoryReadyFn>(GetProcAddress(module, "L4P_RuntimeFactoryReady"));
        if (!start || !render || !l4p::pin(module) || start(root.c_str()) != 0) return FALSE;
        ready = render; return TRUE;
    } catch (...) { return FALSE; }
}
}
extern "C" BOOL WINAPI DllMain(HINSTANCE module, DWORD reason, LPVOID) {
    if(reason==DLL_PROCESS_ATTACH) self=module;
    return TRUE;
}
extern "C" void matcha_game_ready() { InitOnceExecuteOnce(&once, initialize, nullptr, nullptr); }
extern "C" void matcha_render_ready() { if(InitOnceExecuteOnce(&once, initialize, nullptr, nullptr) && ready) ready(0); }

extern "C" void* matcha_instance();
extern "C" __declspec(dllexport) void* GetL4NPluginInstance() { return matcha_instance(); }
