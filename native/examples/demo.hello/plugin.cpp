#include "l4p_plugin.h"
#include <nlohmann/json.hpp>
#include <cstring>
#include <string>
static L4P_HostApiV1 host{};
static uint32_t L4P_CALL initialize(const L4P_HostApiV1* api) {
    if (!api || api->api_version != L4P_API_VERSION || api->struct_size != sizeof(*api) || !api->log)
        return L4P_BAD_ARGUMENT;
    host = *api;
    host.log(host.context, 1, "Hello Platform initialized at render-init");
    return L4P_OK;
}
static uint32_t L4P_CALL invoke(const char* action, const char* params, char* output,
    uint32_t capacity, uint32_t* size) {
    if (!action || !params || !output || !size || std::strcmp(action, "hello")) return L4P_BAD_ARGUMENT;
    try {
        auto input = nlohmann::json::parse(params);
        std::string result = nlohmann::json{{"message", "Hello, " + input.value("name", std::string("survivor")) + "!"},
            {"pluginId", "demo.hello"}}.dump();
        *size = uint32_t(result.size() + 1);
        if (capacity < *size) return L4P_BUFFER_TOO_SMALL;
        std::memcpy(output, result.c_str(), *size);
        host.log(host.context, 1, "hello action completed");
        return L4P_OK;
    } catch (...) { return L4P_BAD_ARGUMENT; }
}
static void L4P_CALL shutdown() { host.log(host.context, 1, "Hello Platform explicit shutdown"); }
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetPluginApi(uint32_t version, L4P_PluginApiV1* output) {
    if (version != L4P_API_VERSION) return L4P_UNSUPPORTED_VERSION;
    if (!output || output->api_version != L4P_API_VERSION || output->struct_size != sizeof(*output)) return L4P_BAD_ARGUMENT;
    *output = {L4P_API_VERSION, sizeof(*output), "demo.hello", "0.1.0", initialize, invoke, shutdown};
    return L4P_OK;
}
