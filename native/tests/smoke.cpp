#include "common.hpp"
#include "l4p_runtime.h"
#include <d3d9.h>
#include <nlohmann/json.hpp>
#include <fstream>
#include <iostream>
#include <string>
#include <stdexcept>

using json = nlohmann::json;
namespace fs = std::filesystem;
void require(bool success, const char* message) { if (!success) throw std::runtime_error(message); }
json exchange(const json& value) {
    std::wstring name = L"\\\\.\\pipe\\l4p." + std::to_wstring(GetCurrentProcessId());
    HANDLE h = INVALID_HANDLE_VALUE;
    for (int i = 0; i < 100 && h == INVALID_HANDLE_VALUE; ++i) {
        h = CreateFileW(name.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
        if (h == INVALID_HANDLE_VALUE) { WaitNamedPipeW(name.c_str(), 20); Sleep(10); }
    }
    l4p::Handle pipe(h); require(h != INVALID_HANDLE_VALUE, "Control pipe unavailable");
    auto input = value.dump() + "\n";
    DWORD count = 0;
    require(WriteFile(h, input.data(), DWORD(input.size()), &count, nullptr) && count == input.size(), "Pipe write failed");
    std::string output; char buffer[2048];
    while (output.find('\n') == std::string::npos) {
        require(ReadFile(h, buffer, sizeof(buffer), &count, nullptr) && count, "Pipe read failed");
        output.append(buffer, count);
        require(output.size() <= 256 * 1024 + 1, "Oversized pipe response");
    }
    return json::parse(output.substr(0, output.find('\n')));
}
int wmain(int argc, wchar_t** argv) {
    try {
        require(argc == 3 || (argc == 4 && std::wstring(argv[2]) == L"serve"), "Usage: smoke <shim-path> <mode> [fake-steam-path for serve]");
        fs::path shim_path = fs::absolute(argv[1]);
        fs::path root = shim_path.parent_path() / L"l4p";
        std::wstring mode = argv[2];
        // Opt-in offline Steam fixture; never discover or load a real game library.
        HMODULE fake_steam = nullptr;
        if (argc == 4) {
            fake_steam = l4p::load(fs::absolute(argv[3]));
            require(fake_steam && GetProcAddress(fake_steam,"FixtureSetMode"), "Offline Steam fixture missing");
        }
        HMODULE shim = l4p::load(shim_path);
        require(shim, "Shim could not be loaded");
        auto version = reinterpret_cast<uint32_t(__cdecl*)()>(GetProcAddress(shim,"L4P_PlatformShimVersion"));
        require(version && version() == 1, "Shim marker export missing");
        const char* names[] = {"Direct3DCreate9", "Direct3DCreate9Ex", "Direct3DCreate9On12", "Direct3DCreate9On12Ex",
            "Direct3DShaderValidatorCreate9", "PSGPError", "PSGPSampleTexture", "D3DPERF_BeginEvent", "D3DPERF_EndEvent",
            "D3DPERF_GetStatus", "D3DPERF_QueryRepeatFrame", "D3DPERF_SetMarker", "D3DPERF_SetOptions", "D3DPERF_SetRegion",
            "DebugSetLevel", "DebugSetMute", "Direct3D9EnableMaximizedWindowedModeShim"};
        for (auto name : names) require(GetProcAddress(shim,name), "Named export missing");
        int ordinals[] = {16,20,21,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,28257,28258};
        for (auto ordinal : ordinals) require(GetProcAddress(shim,MAKEINTRESOURCEA(ordinal)), "Ordinal export missing");
        auto create = reinterpret_cast<IDirect3D9*(WINAPI*)(UINT)>(GetProcAddress(shim,"Direct3DCreate9"));
        auto create_ex = reinterpret_cast<HRESULT(WINAPI*)(UINT,IDirect3D9Ex**)>(GetProcAddress(shim,"Direct3DCreate9Ex"));
        IDirect3D9Ex* output = reinterpret_cast<IDirect3D9Ex*>(1);
        if (mode == L"missing") {
            require(!create(32), "Missing backend should return null");
            require(create_ex(32,&output) == D3DERR_NOTAVAILABLE && output == nullptr, "Missing backend HRESULT/output wrong");
            require(!GetModuleHandleW(L"l4p_runtime.dll"), "Runtime loaded after backend failure");
        } else if (mode == L"failed-factory") {
            require(!create(999), "Backend null result changed");
            require(create_ex(999,&output) == D3DERR_NOTAVAILABLE && output == nullptr, "Backend failure result changed");
            require(!GetModuleHandleW(L"l4p_runtime.dll"), "Runtime loaded after failed factory");
        } else {
            require(uintptr_t(create(32)) == 0x12340020u, "D3D9 factory argument/result changed");
            require(create_ex(7,&output) == S_OK && uintptr_t(output) == 0x56780007u, "D3D9Ex factory argument/result changed");
            auto begin = reinterpret_cast<int(WINAPI*)(D3DCOLOR,LPCWSTR)>(GetProcAddress(shim,"D3DPERF_BeginEvent"));
            require(begin(10,L"test") == 14, "D3DPERF forwarding changed arguments");
            auto status = exchange({{"id","s1"},{"type","status"}});
            require(status.at("ok").get<bool>(), "Status failed");
            require(status["result"]["d3d9FactoryReadyCount"] == 2, "Factory readiness count incorrect");
            if (mode == L"serve") {
                std::cout << json{{"pid",GetCurrentProcessId()},{"pipe","\\\\.\\pipe\\l4p." + std::to_string(GetCurrentProcessId())},
                    {"status",status["result"]},{"exit","Send a newline to stdin"}}.dump() << std::endl;
                std::string stop; std::getline(std::cin,stop);
                auto runtime_module = GetModuleHandleW(L"l4p_runtime.dll");
                auto shutdown = reinterpret_cast<L4P_RuntimeShutdownFn>(GetProcAddress(runtime_module,"L4P_RuntimeShutdown"));
                require(shutdown, "Explicit shutdown export missing"); shutdown();
                if (fake_steam) FreeLibrary(fake_steam);
                return 0;
            }
            int ready = 0, rejected = 0;
            for (const auto& p : status["result"]["plugins"]) {
                if (p["id"] == "demo.hello" && p["state"] == "initialized") ++ready;
                else if (p["state"] == "failed") ++rejected;
            }
            require(ready == 1 && rejected == 2, "Plugin init/id/ABI validation failed");
            json hello = {{"id","hello"},{"type","invoke"},{"pluginId","demo.hello"},{"actionId","hello"},{"params",{{"name","survivor"}}}};
            if (mode == L"confirmation") {
                require(exchange(hello)["error"]["code"] == "confirmation_required", "Missing confirmation accepted");
                hello["confirmation"] = {{"approved",true},{"source","user"}};
            }
            auto reply = exchange(hello);
            require(reply["ok"] == true && reply["result"]["message"] == "Hello, survivor!", "Declared action invocation failed");
            hello["params"] = {{"name",42}};
            require(exchange(hello)["error"]["code"] == "invalid_parameters", "Invalid argument type accepted");
            hello["params"] = {{"extra",true}};
            require(exchange(hello)["error"]["code"] == "invalid_parameters", "Unknown parameter accepted");
            hello["actionId"] = "undeclared";
            require(exchange(hello)["error"]["code"] == "unknown_action", "Undeclared action accepted");
            auto runtime_module = GetModuleHandleW(L"l4p_runtime.dll");
            auto shutdown = reinterpret_cast<L4P_RuntimeShutdownFn>(GetProcAddress(runtime_module,"L4P_RuntimeShutdown"));
            require(shutdown, "Explicit shutdown export missing");
            shutdown();
            std::ifstream log(root / L"logs" / (L"runtime-" + std::to_wstring(GetCurrentProcessId()) + L".jsonl"));
            std::string line; int init_count = 0, shutdown_count = 0;
            while (std::getline(log,line)) {
                auto entry = json::parse(line);
                if (entry["message"] == "Hello Platform initialized at render-init") ++init_count;
                if (entry["message"] == "Hello Platform explicit shutdown") ++shutdown_count;
            }
            require(init_count == 1 && shutdown_count == 1, "Plugin lifecycle ran an incorrect number of times");
        }
        std::cout << "PASS: " << l4p::utf8(mode) << " (" << sizeof(void*) * 8 << "-bit offline fixture)\n";
        return 0;
    } catch (const std::exception& e) { std::cerr << "FAIL: " << e.what() << '\n'; return 1; }
}
