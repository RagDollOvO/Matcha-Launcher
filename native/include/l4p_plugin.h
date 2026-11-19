#ifndef L4P_PLUGIN_H
#define L4P_PLUGIN_H

#include <stdint.h>

#ifdef _WIN32
# define L4P_CALL __cdecl
# define L4P_EXPORT __declspec(dllexport)
#else
# define L4P_CALL
# define L4P_EXPORT
#endif
#ifdef __cplusplus
extern "C" {
#endif

#define L4P_API_VERSION 1u
#define L4P_OK 0u
#define L4P_ERROR 1u
#define L4P_BAD_ARGUMENT 2u
#define L4P_BUFFER_TOO_SMALL 3u
#define L4P_UNSUPPORTED_VERSION 4u
#define L4P_LOG_DEBUG 0u
#define L4P_LOG_INFO 1u
#define L4P_LOG_WARNING 2u
#define L4P_LOG_ERROR 3u

/* ABI v1: Windows, same-process x86, C calling convention, default packing 8.
 * All text is UTF-8. Every structure requires exact api_version/struct_size.
 * HostApi structure pointer and its text fields are borrowed during init; copy
 * needed text. log/context remain valid until explicit shutdown or process exit.
 * Other call buffers are borrowed during that call. No cross-DLL allocation.
 * Each plugin gets init once at render-init, outside DllMain on the factory thread.
 * invoke runs serially on the control thread: marshal game-thread work yourself.
 * SDK v1 provides initialization/logging/actions. Device/Present/Reset callbacks
 * and hot unload are reserved for a later version.
 */
#pragma pack(push, 8)
typedef void (L4P_CALL *L4P_LogFn)(void* context, uint32_t level, const char* message);
typedef struct L4P_HostApiV1 {
    uint32_t api_version;
    uint32_t struct_size;
    void* context;
    L4P_LogFn log;
    const char* plugin_directory;
    const char* config_json;
} L4P_HostApiV1;

typedef uint32_t (L4P_CALL *L4P_InitFn)(const L4P_HostApiV1* host);
/* output_size includes the terminating NUL. Host supplies one 256 KiB buffer.
 * A plugin validates capacity BEFORE any side effect; BUFFER_TOO_SMALL is an
 * error returned to the caller, and the host does not retry the action.
 * Write one valid JSON value on success. Parameters are a JSON object.
 */
typedef uint32_t (L4P_CALL *L4P_InvokeFn)(const char* action_id,
    const char* parameters_json, char* output_json, uint32_t output_capacity,
    uint32_t* output_size);
/* Optional explicit host shutdown, outside DllMain after control work has stopped.
 * Process termination may skip shutdown. Flush durable state during normal use.
 * Loaded modules remain mapped for the whole process lifetime.
 */
typedef void (L4P_CALL *L4P_ShutdownFn)(void);
typedef struct L4P_PluginApiV1 {
    uint32_t api_version;
    uint32_t struct_size;
    const char* id;
    const char* version;
    L4P_InitFn init;
    L4P_InvokeFn invoke;
    L4P_ShutdownFn shutdown;
} L4P_PluginApiV1;
typedef uint32_t (L4P_CALL *L4P_GetPluginApiFn)(uint32_t host_api_version,
    L4P_PluginApiV1* output);
/* Export this exact, undecorated symbol from the plugin. The caller initializes
 * output.api_version and output.struct_size before negotiating the interface. */
L4P_EXPORT uint32_t L4P_CALL L4P_GetPluginApi(uint32_t host_api_version,
    L4P_PluginApiV1* output);
#pragma pack(pop)

#ifdef __cplusplus
}
#endif
#endif
