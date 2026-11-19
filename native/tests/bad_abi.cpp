#include "l4p_plugin.h"
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetPluginApi(uint32_t, L4P_PluginApiV1* output) {
    if (!output) return L4P_BAD_ARGUMENT;
    output->api_version = 99;
    return L4P_OK;
}
