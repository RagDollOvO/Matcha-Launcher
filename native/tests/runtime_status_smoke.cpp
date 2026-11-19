#include "common.hpp"
#include "l4p_runtime.h"
#include <nlohmann/json.hpp>
#include <iostream>

using json = nlohmann::json;
namespace fs = std::filesystem;
void require(bool ok, const char* why) { if (!ok) throw std::runtime_error(why); }
json status() {
    const std::wstring name = L"\\\\.\\pipe\\l4p." + std::to_wstring(GetCurrentProcessId());
    HANDLE value = INVALID_HANDLE_VALUE;
    for (int i = 0; i < 100 && value == INVALID_HANDLE_VALUE; ++i) {
        value = CreateFileW(name.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
        if (value == INVALID_HANDLE_VALUE) { WaitNamedPipeW(name.c_str(), 20); Sleep(10); }
    }
    l4p::Handle pipe(value); require(value != INVALID_HANDLE_VALUE, "Status pipe unavailable");
    const std::string input = "{\"id\":\"status\",\"type\":\"status\"}\n";
    DWORD count = 0;
    require(WriteFile(value, input.data(), DWORD(input.size()), &count, nullptr) && count == input.size(), "Status write failed");
    std::string output; char bytes[4096];
    while (output.find('\n') == std::string::npos) {
        require(ReadFile(value, bytes, sizeof(bytes), &count, nullptr) && count, "Status read failed");
        output.append(bytes, count); require(output.size() < 256 * 1024, "Status response too large");
    }
    const auto response = json::parse(output.substr(0, output.find('\n')));
    require(response.at("ok") == true, "Status request rejected");
    return response.at("result");
}
int wmain(int argc, wchar_t** argv) {
    try {
        require(argc == 2, "runtime_status_smoke PLATFORM_ROOT");
        const auto root = fs::canonical(argv[1]), bin = root.parent_path();
        // Both are our fake D3D9 DLL, explicitly staged by the offline check.
        require(l4p::load(bin / L"left4neko.dll"), "Fake L4N module missing");
        require(l4p::load(bin / L"neko/plugins/offline-child.dll"), "Fake child module missing");
        auto module = l4p::load(root / L"l4p_runtime.dll"); require(module, "Runtime missing");
        require(GetProcAddress(module, "L4P_RuntimeModuleStatusV1"), "Status capability marker missing");
        auto init = reinterpret_cast<L4P_RuntimeInitializeFn>(GetProcAddress(module, "L4P_RuntimeInitialize"));
        auto shutdown = reinterpret_cast<L4P_RuntimeShutdownFn>(GetProcAddress(module, "L4P_RuntimeShutdown"));
        require(init && shutdown && init(root.c_str()) == 0, "Runtime initialization failed");
        const auto observed = status();
        std::cout << observed.dump() << '\n';
        shutdown();
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
