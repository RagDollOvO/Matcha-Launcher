#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Private shim/runtime ABI, separate from plugin ABI. root is an absolute path.
 * Exports are cdecl. Shutdown is an explicit offline-host/controlled-host action;
 * DllMain never calls it. FactoryReady reports only a successful backend factory.
 */
typedef uint32_t (__cdecl *L4P_RuntimeInitializeFn)(const wchar_t* root);
typedef void (__cdecl *L4P_RuntimeFactoryReadyFn)(uint32_t is_ex);
typedef void (__cdecl *L4P_RuntimeShutdownFn)(void);
#ifdef __cplusplus
}
#endif
