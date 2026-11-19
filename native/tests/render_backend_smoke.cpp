#include "common.hpp"
#include "l4p_runtime.h"
#include <d3d9.h>
#include <iostream>
#include <stdexcept>
static void check(bool ok, const char* message) { if (!ok) throw std::runtime_error(message); }
int wmain(int argc, wchar_t** argv) {
    try {
        check(argc == 3, "render_backend_smoke SHIM system|fake");
        const bool system = std::wstring(argv[2]) == L"system";
        auto shim = l4p::load(std::filesystem::absolute(argv[1]));
        check(shim != nullptr, "Shim load");
        const auto create = reinterpret_cast<IDirect3D9* (WINAPI*)(UINT)>(GetProcAddress(shim,"Direct3DCreate9"));
        check(create != nullptr, "Factory export");
        auto* d3d = create(D3D_SDK_VERSION);
        check(d3d != nullptr, "Factory result");
        check((GetModuleHandleW(L"dxvk.dll") == nullptr) == system, "Expected renderer mapped");
        check(GetModuleHandleW(L"l4p_runtime.dll") != nullptr, "Own runtime remains active");
        check(GetModuleHandleW(L"plugin.dll") != nullptr, "Selected plain DLL mapped");
        if (system) d3d->Release();
        const auto stop = reinterpret_cast<L4P_RuntimeShutdownFn>(GetProcAddress(GetModuleHandleW(L"l4p_runtime.dll"),"L4P_RuntimeShutdown"));
        check(stop != nullptr,"Shutdown export"); stop();
        std::cout << "Rendering backend and own DLL loading: OK\n";
        return 0;
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
