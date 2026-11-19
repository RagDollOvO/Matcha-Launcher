#include "common.hpp"
#include "l4p_plugin.h"
#include "release_gate.hpp"
#include <sddl.h>
#include <tlhelp32.h>
#include <nlohmann/json.hpp>
#include <fstream>
#include <sstream>
#include <map>
#include <set>
#include <memory>
#include <mutex>
#include <atomic>
#include <algorithm>
#include <cmath>
#include <cstring>

using json = nlohmann::json;
namespace fs = std::filesystem;
namespace {
constexpr size_t MaxRequest = 64 * 1024;
constexpr size_t MaxResponse = 256 * 1024;
constexpr size_t MaxDocument = 1024 * 1024;
struct Plugin {
    std::string id, version, directory, config_text;
    std::string state = "failed", error, load_kind = "sdk", stage = "validation", error_code = "invalid_plugin";
    bool mapped = false;
    DWORD native_error = 0;
    json manifest;
    L4P_PluginApiV1 api{};
    L4P_HostApiV1 host{};
    HMODULE module = nullptr;
    std::unique_ptr<beacon::Gate> release_gate;
};
struct Runtime {
    fs::path root;
    std::vector<std::unique_ptr<Plugin>> plugins;
    std::mutex log_mutex;
    std::atomic<uint32_t> factories{0};
    HANDLE stop = nullptr, worker = nullptr;
    std::atomic<bool> started{false}, stopped{false};
    bool attempted = false;
    uint32_t initialization_result = 1;
};
Runtime& runtime() { static Runtime* value = new Runtime; return *value; }
std::mutex& init_mutex() { static auto* value = new std::mutex; return *value; }
void log(const std::string& plugin, uint32_t level, const std::string& message) {
    auto& r = runtime();
    try {
        std::lock_guard<std::mutex> guard(r.log_mutex);
        std::ofstream out(r.root / L"logs" / (L"runtime-" + std::to_wstring(GetCurrentProcessId()) + L".jsonl"), std::ios::app | std::ios::binary);
        SYSTEMTIME now{}; GetSystemTime(&now);
        char time[40]{};
        std::snprintf(time, sizeof(time), "%04u-%02u-%02uT%02u:%02u:%02u.%03uZ", now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond, now.wMilliseconds);
        out << json{{"time", time}, {"pid", GetCurrentProcessId()}, {"pluginId", plugin}, {"level", level}, {"message", message}}.dump(-1, ' ', false, json::error_handler_t::replace) << '\n';
    } catch (...) { OutputDebugStringA("L4P: log write failed\n"); }
}
void L4P_CALL plugin_log(void* context, uint32_t level, const char* message) {
    auto* plugin = static_cast<Plugin*>(context);
    if (message && plugin) log(plugin->id, level, std::string(message).substr(0, 16384));
}
json read_json(const fs::path& path) {
    if (fs::file_size(path) > MaxDocument) throw std::runtime_error("JSON document exceeds 1 MiB");
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("JSON document cannot be opened");
    return json::parse(in);
}
std::string text_field(const json& j, const char* key, size_t max = 256) {
    if (!j.contains(key) || !j[key].is_string()) throw std::runtime_error(std::string("Missing string: ") + key);
    auto s = j[key].get<std::string>();
    if (s.empty() || s.size() > max || s.find('\0') != std::string::npos) throw std::runtime_error(std::string("Invalid string: ") + key);
    return s;
}
void validate_value(const json& spec, const json& value) {
    auto type = text_field(spec, "type");
    if (type == "string") {
        if (!value.is_string()) throw std::runtime_error("Expected string");
        const auto& s = value.get_ref<const std::string&>();
        if (s.find('\0') != std::string::npos) throw std::runtime_error("NUL is not accepted in strings");
        size_t count = 0; for (unsigned char c : s) if ((c & 0xc0) != 0x80) ++count;
        if (spec.contains("maxLength") && count > spec.at("maxLength").get<size_t>()) throw std::runtime_error("String exceeds maxLength");
    } else if (type == "boolean") {
        if (!value.is_boolean()) throw std::runtime_error("Expected boolean");
    } else if (type == "integer" || type == "number") {
        if ((type == "integer" && !value.is_number_integer()) || (type == "number" && !value.is_number())) throw std::runtime_error("Expected numeric value");
        double n = value.get<double>();
        if (!std::isfinite(n)) throw std::runtime_error("Expected finite number");
        if (spec.contains("minimum") && n < spec.at("minimum").get<double>()) throw std::runtime_error("Value below minimum");
        if (spec.contains("maximum") && n > spec.at("maximum").get<double>()) throw std::runtime_error("Value above maximum");
    } else if (type == "enum") {
        const auto& options = spec.at("options");
        if (!options.is_array() || std::find(options.begin(), options.end(), value) == options.end()) throw std::runtime_error("Value is outside enum options");
    } else throw std::runtime_error("Unsupported field type");
}
json parameters(const json& specs, json values) {
    if (!specs.is_object() || !values.is_object()) throw std::runtime_error("Parameters must be an object");
    for (const auto& item : values.items()) if (!specs.contains(item.key())) throw std::runtime_error("Unknown parameter: " + item.key());
    for (const auto& item : specs.items()) {
        if (!values.contains(item.key()) && item.value().contains("default")) values[item.key()] = item.value()["default"];
        if (!values.contains(item.key())) {
            if (item.value().value("required", false)) throw std::runtime_error("Missing parameter: " + item.key());
            continue;
        }
        try { validate_value(item.value(), values[item.key()]); }
        catch (const std::exception& e) { throw std::runtime_error(item.key() + ": " + e.what()); }
    }
    return values;
}
void ensure_local_file(const fs::path& directory, const fs::path& file) {
    auto parent = fs::canonical(directory);
    auto actual = fs::canonical(file);
    if (_wcsicmp(actual.parent_path().c_str(), parent.c_str())) throw std::runtime_error("Plugin file resolves outside its directory");
    if (!fs::is_regular_file(actual)) throw std::runtime_error("Expected regular plugin file");
}
void load_plugin(const std::string& id) {
    auto& r = runtime();
    auto plugin = std::make_unique<Plugin>();
    plugin->id = id;
    try {
        if (!l4p::valid_id(id)) throw std::runtime_error("Invalid plugin ID");
        fs::path dir = r.root / L"plugins" / l4p::wide(id);
        auto plugin_parent = fs::canonical(dir).parent_path();
        if (_wcsicmp(plugin_parent.c_str(), fs::canonical(r.root / L"plugins").c_str())) throw std::runtime_error("Plugin directory resolves outside plugins root");
        ensure_local_file(dir, dir / L"manifest.json");
        std::string expected;
        if (fs::exists(r.root / L"platform-state.json")) {
            auto state = read_json(r.root / L"platform-state.json");
            if (state.contains("plugins") && state["plugins"].contains(id)) expected = state["plugins"][id].value("releaseSha256", "");
        }
        plugin->stage = "verification"; plugin->error_code = "release_rejected";
        plugin->release_gate = beacon::verify(dir, r.root / L"release-trust.json", expected);
        plugin->stage = "validation"; plugin->error_code = "invalid_plugin";
        plugin->manifest = read_json(dir / L"manifest.json");
        const auto& m = plugin->manifest;
        if (!m.is_object() || m.value("schemaVersion", 0) != 1 || m.value("apiVersion", 0) != L4P_API_VERSION)
            throw std::runtime_error("Manifest schema or API version mismatch");
        if (text_field(m, "id") != id || text_field(m, "entry") != "plugin.dll" || text_field(m, "phase") != "render-init")
            throw std::runtime_error("Manifest ID, entry or phase mismatch");
        if (text_field(m, "architecture") != (sizeof(void*) == 4 ? "x86" : "x64")) throw std::runtime_error("Plugin architecture mismatch");
        (void)text_field(m, "name");
        plugin->version = text_field(m, "version");
        if (!m.at("dependencies").is_array() || !m.at("actions").is_array() || !m.at("config").is_array()) throw std::runtime_error("Expected dependencies/actions/config arrays");
        const auto kind = m.value("loadKind", std::string("sdk"));
        plugin->load_kind = kind;
        if (kind != "sdk" && kind != "library") throw std::runtime_error("Unknown DLL loading contract");
        if (kind == "library" && (!m.at("actions").empty() || !m.at("config").empty())) throw std::runtime_error("Whole DLL packages manage their own settings");
        plugin->stage = "dependencies"; plugin->error_code = "dependency_unavailable";
        for (const auto& dependency : m.at("dependencies")) {
            auto dependency_id = text_field(dependency, "id");
            if (!l4p::valid_id(dependency_id)) throw std::runtime_error("Invalid dependency ID");
            auto version = text_field(dependency, "version");
            bool found = false;
            for (const auto& other : r.plugins) if (other->id == dependency_id && other->version == version &&
                (other->state == "initialized" || other->state == "loaded")) found = true;
            if (!found) throw std::runtime_error("Dependency is not initialized at the required version: " + dependency_id);
        }
        plugin->stage = "validation"; plugin->error_code = "invalid_plugin";
        std::set<std::string> action_ids;
        for (const auto& action : m.at("actions")) {
            auto action_id = text_field(action, "id");
            if (!l4p::valid_id(action_id) || !action_ids.insert(action_id).second || !action.at("parameters").is_object()) throw std::runtime_error("Invalid or duplicate action");
            for (const auto& parameter : action.at("parameters").items())
                if (!l4p::valid_id(parameter.key())) throw std::runtime_error("Invalid action parameter ID");
            (void)text_field(action, "label");
            auto effect = text_field(action, "effect");
            if (effect != "read" && effect != "write") throw std::runtime_error("Unsupported action effect");
            if (!action.at("requiresConfirmation").is_boolean()) throw std::runtime_error("Missing action confirmation policy");
        }
        json specs = json::object();
        for (const auto& field : m.at("config")) {
            auto field_id = text_field(field, "id");
            if (!l4p::valid_id(field_id) || specs.contains(field_id)) throw std::runtime_error("Invalid or duplicate config ID");
            specs[field_id] = field;
        }
        json config = json::object();
        if (fs::exists(dir / L"config.json")) { ensure_local_file(dir, dir / L"config.json"); config = read_json(dir / L"config.json"); }
        plugin->config_text = parameters(specs, config).dump();
        plugin->directory = l4p::utf8(fs::canonical(dir).wstring());
        ensure_local_file(dir, dir / L"plugin.dll");
        plugin->stage = "verification"; plugin->error_code = "release_rejected";
        plugin->release_gate->prepare_runtime();
        plugin->stage = "load"; plugin->error_code = "dll_load_failed";
        plugin->module = l4p::load(dir / L"plugin.dll");
        if (!plugin->module) {
            plugin->native_error = GetLastError();
            throw std::runtime_error("LoadLibrary failed: " + std::to_string(plugin->native_error));
        }
        plugin->mapped = true;
        /* Keep all loaded plugin modules alive, including rejected ones: DLL attach
         * may have initialized state. DLL authors follow the minimal-DllMain rule. */
        if (!l4p::pin(plugin->module)) throw std::runtime_error("Could not pin plugin module");
        if (kind == "sdk") {
        plugin->stage = "abi"; plugin->error_code = "abi_mismatch";
        auto get_api = reinterpret_cast<L4P_GetPluginApiFn>(GetProcAddress(plugin->module, "L4P_GetPluginApi"));
        if (!get_api) throw std::runtime_error("Missing L4P_GetPluginApi export");
        plugin->api = {L4P_API_VERSION, sizeof(L4P_PluginApiV1), nullptr, nullptr, nullptr, nullptr, nullptr};
        if (get_api(L4P_API_VERSION, &plugin->api) != L4P_OK || plugin->api.api_version != L4P_API_VERSION || plugin->api.struct_size != sizeof(L4P_PluginApiV1))
            throw std::runtime_error("Plugin ABI negotiation failed");
        if (!plugin->api.id || !plugin->api.version || plugin->id != plugin->api.id || plugin->version != plugin->api.version || !plugin->api.init || !plugin->api.invoke)
            throw std::runtime_error("Plugin descriptor does not match manifest");
        plugin->host = {L4P_API_VERSION, sizeof(L4P_HostApiV1), plugin.get(), plugin_log, plugin->directory.c_str(), plugin->config_text.c_str()};
        plugin->stage = "init"; plugin->error_code = "init_failed";
        uint32_t result = plugin->api.init(&plugin->host);
        if (result != L4P_OK) throw std::runtime_error("Plugin init failed: " + std::to_string(result));
        }
        plugin->state = kind == "sdk" ? "initialized" : "loaded";
        plugin->stage = "ready"; plugin->error_code.clear();
        log(id, 1, kind == "sdk" ? "Plugin initialized" : "DLL loaded (no SDK initialization contract)");
    } catch (const std::exception& e) { plugin->error = e.what(); log(id, 3, plugin->error); }
      catch (...) { plugin->error = "Plugin threw across its ABI"; log(id, 3, plugin->error); }
    r.plugins.push_back(std::move(plugin));
}
json failure(const json& id, const std::string& code, const std::string& message) {
    return {{"id", id}, {"ok", false}, {"error", {{"code", code}, {"message", message}}}};
}
// Observe our own process only when a status request arrives, never per frame.
json external_modules() {
    json plugins = json::array();
    l4p::Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, GetCurrentProcessId()));
    if (snapshot.value == INVALID_HANDLE_VALUE) return {{"observed", false}, {"nativeError", GetLastError()}};
    MODULEENTRY32W entry{}; entry.dwSize = sizeof(entry);
    if (!Module32FirstW(snapshot.value, &entry)) return {{"observed", false}, {"nativeError", GetLastError()}};
    const auto bin = runtime().root.parent_path();
    const auto host = (bin / L"left4neko.dll").lexically_normal();
    const auto folder = (bin / L"neko/plugins").lexically_normal();
    bool host_loaded = false;
    do {
        const auto file = fs::path(entry.szExePath).lexically_normal();
        if (!_wcsicmp(file.c_str(), host.c_str())) host_loaded = true;
        if (!_wcsicmp(file.parent_path().c_str(), folder.c_str())) plugins.push_back(l4p::utf8(file.wstring()));
    } while (Module32NextW(snapshot.value, &entry));
    if (GetLastError() != ERROR_NO_MORE_FILES) return {{"observed", false}, {"nativeError", GetLastError()}};
    return {{"observed", true}, {"l4nLoaded", host_loaded}, {"l4nPlugins", plugins}};
}
json request(const json& input) {
    json id = input.is_object() ? input.value("id", json(nullptr)) : json(nullptr);
    if (!input.is_object() || !(id.is_string() || id.is_null())) return failure(nullptr, "invalid_request", "Request and id have invalid types");
    try {
        auto& r = runtime();
        auto type = text_field(input, "type");
        if (type == "status") {
            json list = json::array();
            for (const auto& p : r.plugins) {
                json item = {{"id", p->id}, {"version", p->version}, {"state", p->state},
                    {"loadKind", p->load_kind}, {"mapped", p->mapped}, {"stage", p->stage}};
                item["verification"] = p->release_gate ? p->release_gate->report : json{{"state", "rejected"}, {"integrity", "unverified"}};
                if (!p->error.empty()) { item["error"] = p->error; item["errorCode"] = p->error_code; }
                if (p->native_error) item["nativeError"] = p->native_error;
                list.push_back(std::move(item));
            }
            return {{"id", id}, {"ok", true}, {"result", {{"protocolVersion", 1}, {"apiVersion", 1}, {"phase", "render-init"},
                {"pid", GetCurrentProcessId()}, {"d3d9FactoryReadyCount", r.factories.load()}, {"plugins", list},
                {"externalModules", external_modules()}}}};
        }
        if (type != "invoke") return failure(id, "unknown_request", "Expected status or invoke");
        auto plugin_id = text_field(input, "pluginId");
        auto action_id = text_field(input, "actionId");
        if (!l4p::valid_id(plugin_id) || !l4p::valid_id(action_id)) return failure(id, "invalid_request", "Invalid plugin or action ID");
        Plugin* plugin = nullptr;
        for (const auto& p : r.plugins) if (p->id == plugin_id) plugin = p.get();
        if (!plugin || plugin->state != "initialized") return failure(id, "plugin_unavailable", "Plugin is not initialized");
        const json* action = nullptr;
        for (const auto& a : plugin->manifest["actions"]) if (a["id"] == action_id) action = &a;
        if (!action) return failure(id, "unknown_action", "Action is not declared by the plugin");
        if (action->value("effect", "") != "read" || action->value("requiresConfirmation", true)) {
            const auto confirmation = input.value("confirmation", json::object());
            if (!confirmation.is_object() || !confirmation.value("approved", false) || confirmation.value("source", "") != "user")
                return failure(id, "confirmation_required", "User confirmation receipt is required for this action");
        }
        json params;
        try { params = parameters(action->at("parameters"), input.value("params", json::object())); }
        catch (const std::exception& e) { return failure(id, "invalid_parameters", e.what()); }
        std::string encoded = params.dump();
        std::vector<char> output(MaxResponse, '\0');
        uint32_t size = 0;
        uint32_t result;
        try { result = plugin->api.invoke(action_id.c_str(), encoded.c_str(), output.data(), uint32_t(output.size()), &size); }
        catch (...) { return failure(id, "plugin_exception", "Plugin threw across invoke ABI"); }
        if (result != L4P_OK) return failure(id, "plugin_error", "Plugin returned code " + std::to_string(result));
        if (!size || size > output.size() || output[size - 1] != '\0' || std::memchr(output.data(), '\0', size - 1))
            return failure(id, "invalid_plugin_response", "Plugin output size or terminator is invalid");
        json value;
        try { value = json::parse(output.data(), output.data() + size - 1); }
        catch (...) { return failure(id, "invalid_plugin_response", "Plugin returned invalid JSON"); }
        log(plugin_id, 1, "Action completed: " + action_id);
        return {{"id", id}, {"ok", true}, {"result", value}};
    } catch (const std::exception& e) { return failure(id, "invalid_request", e.what()); }
      catch (...) { return failure(id, "internal_error", "Request failed"); }
}
bool wait_io(HANDLE pipe, OVERLAPPED& ov, DWORD timeout, DWORD& transferred) {
    HANDLE waits[] = {runtime().stop, ov.hEvent};
    DWORD result = WaitForMultipleObjects(2, waits, FALSE, timeout);
    if (result != WAIT_OBJECT_0 + 1) {
        CancelIoEx(pipe, &ov);
        GetOverlappedResult(pipe, &ov, &transferred, TRUE);
        return false;
    }
    return GetOverlappedResult(pipe, &ov, &transferred, FALSE) != FALSE;
}
bool write_line(HANDLE pipe, const json& reply) {
    std::string text = reply.dump(-1, ' ', false, json::error_handler_t::replace);
    if (text.size() > MaxResponse) text = failure(reply.value("id", json(nullptr)), "response_too_large", "Response exceeds 256 KiB").dump();
    text += '\n';
    size_t offset = 0;
    while (offset < text.size()) {
        l4p::Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
        OVERLAPPED ov{}; ov.hEvent = event.value;
        DWORD bytes = 0;
        BOOL ok = WriteFile(pipe, text.data() + offset, DWORD(text.size() - offset), &bytes, &ov);
        if (!ok && (GetLastError() != ERROR_IO_PENDING || !wait_io(pipe, ov, 5000, bytes))) return false;
        if (!bytes) return false;
        offset += bytes;
    }
    return true;
}
void serve(HANDLE pipe) {
    std::string pending;
    char buffer[4096];
    while (WaitForSingleObject(runtime().stop, 0) == WAIT_TIMEOUT) {
        l4p::Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
        OVERLAPPED ov{}; ov.hEvent = event.value;
        DWORD count = 0;
        BOOL ok = ReadFile(pipe, buffer, sizeof(buffer), &count, &ov);
        if (!ok && (GetLastError() != ERROR_IO_PENDING || !wait_io(pipe, ov, 15000, count))) return;
        if (!count) return;
        pending.append(buffer, count);
        size_t end;
        while ((end = pending.find('\n')) != std::string::npos) {
            if (end > MaxRequest) { write_line(pipe, failure(nullptr, "request_too_large", "Request exceeds 64 KiB")); return; }
            std::string line = pending.substr(0, end);
            pending.erase(0, end + 1);
            json reply;
            try { reply = request(json::parse(line)); }
            catch (...) { reply = failure(nullptr, "invalid_json", "Expected one JSON object per line"); }
            if (!write_line(pipe, reply)) return;
        }
        if (pending.size() > MaxRequest) { write_line(pipe, failure(nullptr, "request_too_large", "Request exceeds 64 KiB")); return; }
    }
}
DWORD WINAPI worker(void* raw) {
    HANDLE pipe = static_cast<HANDLE>(raw);
    while (WaitForSingleObject(runtime().stop, 0) == WAIT_TIMEOUT) {
        l4p::Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
        OVERLAPPED ov{}; ov.hEvent = event.value;
        DWORD count = 0;
        BOOL connected = ConnectNamedPipe(pipe, &ov);
        if (!connected) {
            DWORD error = GetLastError();
            if (error == ERROR_PIPE_CONNECTED) connected = TRUE;
            else if (error == ERROR_IO_PENDING) connected = wait_io(pipe, ov, INFINITE, count);
        }
        if (connected) { try { serve(pipe); } catch (...) { log("runtime", 3, "Control connection failed"); } }
        DisconnectNamedPipe(pipe);
        if (!connected && WaitForSingleObject(runtime().stop, 0) == WAIT_TIMEOUT) Sleep(25);
    }
    CloseHandle(pipe);
    return 0;
}
HANDLE create_pipe() {
    l4p::Handle token;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token.value)) throw std::runtime_error("Process token unavailable");
    DWORD size = 0; GetTokenInformation(token.value, TokenUser, nullptr, 0, &size);
    std::vector<unsigned char> info(size);
    if (!GetTokenInformation(token.value, TokenUser, info.data(), size, &size)) throw std::runtime_error("Current user unavailable");
    LPWSTR sid = nullptr;
    if (!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(info.data())->User.Sid, &sid)) throw std::runtime_error("SID conversion failed");
    std::wstring sddl = L"D:P(A;;GA;;;" + std::wstring(sid) + L")"; LocalFree(sid);
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr)) throw std::runtime_error("Pipe ACL creation failed");
    SECURITY_ATTRIBUTES attributes{sizeof(attributes), descriptor, FALSE};
    std::wstring name = L"\\\\.\\pipe\\l4p." + std::to_wstring(GetCurrentProcessId());
    HANDLE pipe = CreateNamedPipeW(name.c_str(), PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
        1, DWORD(MaxResponse + 1), DWORD(MaxRequest + 1), 5000, &attributes);
    LocalFree(descriptor);
    if (pipe == INVALID_HANDLE_VALUE) throw std::runtime_error("CreateNamedPipe failed: " + std::to_string(GetLastError()));
    return pipe;
}
}

extern "C" __declspec(dllexport) uint32_t __cdecl L4P_RuntimeReleaseGateV1() { return 1; }
extern "C" __declspec(dllexport) uint32_t __cdecl L4P_RuntimeModuleStatusV1() { return 1; }

extern "C" __declspec(dllexport) uint32_t __cdecl L4P_RuntimeInitialize(const wchar_t* root) {
    std::lock_guard<std::mutex> guard(init_mutex());
    auto& r = runtime();
    if (r.started) return r.stopped ? 1 : 0;
    if (!root || !fs::path(root).is_absolute()) return 1;
    if (r.attempted) return r.initialization_result;
    r.attempted = true;
    try {
        r.root = fs::canonical(root);
        fs::create_directories(r.root / L"logs");
        if (fs::file_size(r.root / L"enabled.txt") > MaxRequest) throw std::runtime_error("enabled.txt exceeds 64 KiB");
        std::ifstream enabled(r.root / L"enabled.txt", std::ios::binary);
        if (!enabled) throw std::runtime_error("enabled.txt unavailable");
        r.stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        if (!r.stop) throw std::runtime_error("Stop event unavailable");
        l4p::Handle pipe(create_pipe());
        std::set<std::string> seen;
        std::string line;
        while (std::getline(enabled, line)) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (line.empty()) continue;
            if (!seen.insert(line).second) { log(line, 3, "Duplicate enabled ID skipped"); continue; }
            load_plugin(line);
        }
        r.worker = CreateThread(nullptr, 0, worker, pipe.value, 0, nullptr);
        if (!r.worker) throw std::runtime_error("Control worker creation failed");
        pipe.value = INVALID_HANDLE_VALUE; // worker now owns the pipe
        r.started = true;
        r.initialization_result = 0;
        log("runtime", 1, "Runtime initialized; control pipe available");
        return 0;
    } catch (const std::exception& e) { log("runtime", 3, e.what()); }
      catch (...) { log("runtime", 3, "Runtime initialization failed"); }
    for (auto it = r.plugins.rbegin(); it != r.plugins.rend(); ++it) {
        auto& p = **it;
        if (p.state == "initialized") {
            if (p.api.shutdown) { try { p.api.shutdown(); } catch (...) {} }
            p.state = "stopped";
        }
    }
    if (r.stop) { CloseHandle(r.stop); r.stop = nullptr; }
    return 1;
}
extern "C" __declspec(dllexport) void __cdecl L4P_RuntimeFactoryReady(uint32_t is_ex) {
    auto& r = runtime();
    if (r.started && !r.stopped) { ++r.factories; log("runtime", 1, is_ex ? "D3D9Ex factory ready" : "D3D9 factory ready"); }
}
extern "C" __declspec(dllexport) void __cdecl L4P_RuntimeShutdown() {
    std::lock_guard<std::mutex> guard(init_mutex());
    auto& r = runtime();
    if (!r.started || r.stopped.exchange(true)) return;
    SetEvent(r.stop);
    if (r.worker) { WaitForSingleObject(r.worker, INFINITE); CloseHandle(r.worker); r.worker = nullptr; }
    for (auto it = r.plugins.rbegin(); it != r.plugins.rend(); ++it) {
        auto& p = **it;
        if (p.state == "initialized" && p.api.shutdown) { try { p.api.shutdown(); } catch (...) { log(p.id, 3, "Plugin shutdown threw"); } }
    }
    CloseHandle(r.stop); r.stop = nullptr;
    log("runtime", 1, "Explicit runtime shutdown complete");
}
