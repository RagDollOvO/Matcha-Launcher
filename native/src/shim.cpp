#include "common.hpp"
#include "l4p_runtime.h"
#include <d3d9.h>
#include <fstream>
#include <mutex>
#include <atomic>

namespace {
HMODULE self = nullptr, backend = nullptr, runtime_module = nullptr;
INIT_ONCE backend_once = INIT_ONCE_STATIC_INIT, runtime_once = INIT_ONCE_STATIC_INIT;
thread_local bool loading_backend = false, loading_runtime = false;
std::filesystem::path root;
L4P_RuntimeFactoryReadyFn factory_ready = nullptr;
void report(const std::string& message) noexcept {
    OutputDebugStringA(("L4P shim: " + message + "\n").c_str());
    try {
        auto logs = l4p::module_path(self).parent_path() / L"l4p" / L"logs";
        std::filesystem::create_directories(logs);
        std::ofstream out(logs / (L"shim-" + std::to_wstring(GetCurrentProcessId()) + L".log"), std::ios::app | std::ios::binary);
        out << message << '\n';
    } catch (...) {}
}
BOOL CALLBACK initialize_backend(PINIT_ONCE, PVOID, PVOID*) {
    loading_backend = true;
    try {
        root = l4p::module_path(self).parent_path() / L"l4p";
        auto path = root / L"backend" / L"dxvk.dll";
        std::ifstream mode(root / L"render-backend.txt");
        std::string selected;
        if (mode) { std::getline(mode, selected); if (!selected.empty() && selected.back() == '\r') selected.pop_back(); }
        if (selected == "system-d3d9") {
            wchar_t system[MAX_PATH]{};
            auto n = GetSystemDirectoryW(system, MAX_PATH);
            if (!n || n >= MAX_PATH) throw std::runtime_error("Windows D3D9 directory unavailable");
            path = std::filesystem::path(system) / L"d3d9.dll";
        } else if (!selected.empty() && selected != "dxvk") throw std::runtime_error("Unknown rendering backend");
        backend = l4p::load(path);
        if (!backend) report("Backend load failed (Win32 " + std::to_string(GetLastError()) + ")");
        else if (backend == self || !GetProcAddress(backend, "Direct3DCreate9") || !GetProcAddress(backend, "Direct3DCreate9Ex")) {
            report("Backend is recursive or missing mandatory D3D9 factories"); backend = nullptr;
        } else if (!l4p::pin(self) || !l4p::pin(backend)) { report("Could not pin rendering modules"); backend = nullptr; }
        else report(selected == "system-d3d9" ? "Windows D3D9 backend loaded" : "DXVK backend loaded");
    } catch (const std::exception& e) { report(e.what()); backend = nullptr; }
      catch (...) { report("Backend initialization failed"); backend = nullptr; }
    loading_backend = false;
    return TRUE; // Record a failed attempt too: never repeat partial initialization.
}
bool ensure_backend() {
    if (loading_backend) return false;
    InitOnceExecuteOnce(&backend_once, initialize_backend, nullptr, nullptr);
    return backend != nullptr;
}
template<class T> T resolve(const char* name) {
    if (!ensure_backend()) return nullptr;
    return reinterpret_cast<T>(GetProcAddress(backend, name));
}
BOOL CALLBACK initialize_runtime(PINIT_ONCE, PVOID, PVOID*) {
    loading_runtime = true;
    try {
        runtime_module = l4p::load(root / L"l4p_runtime.dll");
        if (!runtime_module) report("Runtime load failed (Win32 " + std::to_string(GetLastError()) + ")");
        else {
            auto initialize = reinterpret_cast<L4P_RuntimeInitializeFn>(GetProcAddress(runtime_module, "L4P_RuntimeInitialize"));
            auto ready = reinterpret_cast<L4P_RuntimeFactoryReadyFn>(GetProcAddress(runtime_module, "L4P_RuntimeFactoryReady"));
            if (!initialize || !ready || !l4p::pin(runtime_module)) report("Runtime ABI unavailable");
            else if (initialize(root.c_str()) != 0) report("Runtime initialization failed; see runtime log");
            else factory_ready = ready;
        }
    } catch (const std::exception& e) { report(e.what()); }
      catch (...) { report("Runtime initialization failed"); }
    loading_runtime = false;
    return TRUE;
}
void notify_ready(bool ex) {
    // During a plugin init reentrant factory, the backend is ready and the new
    // object is valid. The outer call publishes readiness after init completes.
    if (loading_runtime) return;
    InitOnceExecuteOnce(&runtime_once, initialize_runtime, nullptr, nullptr);
    if (factory_ready) factory_ready(ex ? 1u : 0u);
}
}
extern "C" BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) self = instance;
    return TRUE;
}
extern "C" uint32_t __cdecl L4P_PlatformShimVersion() { return 1; }
extern "C" uint32_t __cdecl L4P_RenderBackendControlV1() { return 1; }
extern "C" IDirect3D9* WINAPI shim_Direct3DCreate9(UINT sdk) {
    auto fn = resolve<IDirect3D9* (WINAPI*)(UINT)>("Direct3DCreate9");
    auto result = fn ? fn(sdk) : nullptr;
    if (result) notify_ready(false);
    return result;
}
extern "C" HRESULT WINAPI shim_Direct3DCreate9Ex(UINT sdk, IDirect3D9Ex** output) {
    if (!output) return D3DERR_INVALIDCALL;
    *output = nullptr;
    auto fn = resolve<HRESULT (WINAPI*)(UINT, IDirect3D9Ex**)>("Direct3DCreate9Ex");
    HRESULT result = fn ? fn(sdk, output) : D3DERR_NOTAVAILABLE;
    if (SUCCEEDED(result) && *output) notify_ready(true);
    return result;
}
extern "C" IDirect3D9* WINAPI shim_Direct3DCreate9On12(UINT sdk, void* overrides, UINT count) {
    auto fn = resolve<IDirect3D9* (WINAPI*)(UINT, void*, UINT)>("Direct3DCreate9On12");
    auto result = fn ? fn(sdk, overrides, count) : nullptr;
    if (result) notify_ready(false);
    return result;
}
extern "C" HRESULT WINAPI shim_Direct3DCreate9On12Ex(UINT sdk, void* overrides, UINT count, IDirect3D9Ex** output) {
    if (!output) return D3DERR_INVALIDCALL;
    *output = nullptr;
    auto fn = resolve<HRESULT (WINAPI*)(UINT, void*, UINT, IDirect3D9Ex**)>("Direct3DCreate9On12Ex");
    HRESULT result = fn ? fn(sdk, overrides, count, output) : D3DERR_NOTAVAILABLE;
    if (SUCCEEDED(result) && *output) notify_ready(true);
    return result;
}
extern "C" void* WINAPI shim_Direct3DShaderValidatorCreate9() {
    auto fn = resolve<void* (WINAPI*)()>("Direct3DShaderValidatorCreate9"); return fn ? fn() : nullptr;
}
extern "C" void WINAPI shim_PSGPError(void* a, UINT b) {
    auto fn = resolve<void (WINAPI*)(void*, UINT)>("PSGPError"); if (fn) fn(a,b);
}
extern "C" void WINAPI shim_PSGPSampleTexture(void* a, UINT b, void* c, UINT d, void* e) {
    auto fn = resolve<void (WINAPI*)(void*, UINT, void*, UINT, void*)>("PSGPSampleTexture"); if (fn) fn(a,b,c,d,e);
}
extern "C" int WINAPI shim_D3DPERF_BeginEvent(D3DCOLOR color, LPCWSTR name) {
    auto fn = resolve<int (WINAPI*)(D3DCOLOR,LPCWSTR)>("D3DPERF_BeginEvent"); return fn ? fn(color,name) : -1;
}
extern "C" int WINAPI shim_D3DPERF_EndEvent() { auto fn = resolve<int (WINAPI*)()>("D3DPERF_EndEvent"); return fn ? fn() : -1; }
extern "C" DWORD WINAPI shim_D3DPERF_GetStatus() { auto fn = resolve<DWORD (WINAPI*)()>("D3DPERF_GetStatus"); return fn ? fn() : 0; }
extern "C" BOOL WINAPI shim_D3DPERF_QueryRepeatFrame() { auto fn = resolve<BOOL (WINAPI*)()>("D3DPERF_QueryRepeatFrame"); return fn ? fn() : FALSE; }
extern "C" void WINAPI shim_D3DPERF_SetMarker(D3DCOLOR color, LPCWSTR name) { auto fn = resolve<void (WINAPI*)(D3DCOLOR,LPCWSTR)>("D3DPERF_SetMarker"); if (fn) fn(color,name); }
extern "C" void WINAPI shim_D3DPERF_SetOptions(DWORD options) { auto fn = resolve<void (WINAPI*)(DWORD)>("D3DPERF_SetOptions"); if (fn) fn(options); }
extern "C" void WINAPI shim_D3DPERF_SetRegion(D3DCOLOR color, LPCWSTR name) { auto fn = resolve<void (WINAPI*)(D3DCOLOR,LPCWSTR)>("D3DPERF_SetRegion"); if (fn) fn(color,name); }
extern "C" int WINAPI shim_DebugSetLevel() { auto fn = resolve<int (WINAPI*)()>("DebugSetLevel"); return fn ? fn() : 0; }
extern "C" void WINAPI shim_DebugSetMute() { auto fn = resolve<void (WINAPI*)()>("DebugSetMute"); if (fn) fn(); }
extern "C" int WINAPI shim_Direct3D9EnableMaximizedWindowedModeShim(UINT value) { auto fn = resolve<int (WINAPI*)(UINT)>("Direct3D9EnableMaximizedWindowedModeShim"); return fn ? fn(value) : 0; }
extern "C" void WINAPI shim_Direct3D9ForceHybridEnumeration(UINT value) { auto fn = resolve<void (WINAPI*)(UINT)>(MAKEINTRESOURCEA(16)); if (fn) fn(value); }
extern "C" void WINAPI shim_DXVK_RegisterAnnotation(void* value) { auto fn = resolve<void (WINAPI*)(void*)>(MAKEINTRESOURCEA(28257)); if (fn) fn(value); }
extern "C" void WINAPI shim_DXVK_UnRegisterAnnotation(void* value) { auto fn = resolve<void (WINAPI*)(void*)>(MAKEINTRESOURCEA(28258)); if (fn) fn(value); }
