#pragma once
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <filesystem>
#include <string>
#include <vector>
#include <stdexcept>

namespace l4p {
inline std::wstring wide(const std::string& s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), int(s.size()), nullptr, 0);
    if (!n) throw std::runtime_error("Invalid UTF-8");
    std::wstring result(n, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), int(s.size()), result.data(), n);
    return result;
}
inline std::string utf8(const std::wstring& s) {
    if (s.empty()) return {};
    int n = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, s.data(), int(s.size()), nullptr, 0, nullptr, nullptr);
    if (!n) throw std::runtime_error("Invalid UTF-16");
    std::string result(n, '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, s.data(), int(s.size()), result.data(), n, nullptr, nullptr);
    return result;
}
inline std::filesystem::path module_path(HMODULE module) {
    std::vector<wchar_t> buffer(32768);
    DWORD n = GetModuleFileNameW(module, buffer.data(), DWORD(buffer.size()));
    if (!n || n >= buffer.size()) throw std::runtime_error("Module path unavailable");
    return std::filesystem::path(std::wstring(buffer.data(), n));
}
inline bool pin(HMODULE module) {
    HMODULE pinned = nullptr;
    return GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
        reinterpret_cast<LPCWSTR>(module), &pinned) != FALSE;
}
inline HMODULE load(const std::filesystem::path& path) {
    return LoadLibraryExW(path.c_str(), nullptr,
        LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
}
inline bool valid_id(const std::string& id) {
    // Keep aligned with backend/core.mjs assertId: 1..64 lowercase ASCII,
    // alphanumeric endpoints, portable Windows basename before the first dot.
    if (id.empty() || id.size() > 64) return false;
    auto alnum = [](char c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'); };
    if (!alnum(id.front()) || !alnum(id.back())) return false;
    for (char c : id) if (!alnum(c) && c != '.' && c != '_' && c != '-') return false;
    const auto base = id.substr(0, id.find('.'));
    if (base == "con" || base == "prn" || base == "aux" || base == "nul") return false;
    if (base.size() == 4 && (base.compare(0, 3, "com") == 0 || base.compare(0, 3, "lpt") == 0)
        && base[3] >= '1' && base[3] <= '9') return false;
    return true;
}
struct Handle {
    HANDLE value = INVALID_HANDLE_VALUE;
    explicit Handle(HANDLE h = INVALID_HANDLE_VALUE) : value(h) {}
    ~Handle() { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
};
}
