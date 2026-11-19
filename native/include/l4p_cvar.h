#ifndef L4P_CVAR_H
#define L4P_CVAR_H
#include "l4p_source.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Independent extension; L4P_SourceApiV1 and the host ABI remain unchanged.
 * Acquire using a live Source subscription token, on its game callback thread.
 * One owner per case-insensitive name. Original values are retained until release.
 * A release/unsubscribe from another thread queues restoration at the next Paint.
 * Leaving the subscription's allowed scope restores values before callbacks.
 * Restricted/server-owned variables require a LOCAL subscription and a live
 * loopback server; flags are restored immediately after the engine setter call.
 * Values must be finite, within +/- 1e8. No raw address or command input.
 */
#define L4P_CVAR_CONFLICT 5u
#define L4P_CVAR_SCOPE 6u
#define L4P_CVAR_MISSING 7u
#pragma pack(push, 8)
typedef struct L4P_CvarApiV1 {
    uint32_t api_version, struct_size;
    uint32_t (L4P_CALL *pin)(uint32_t subscription, const char* name, float value);
    uint32_t (L4P_CALL *release)(uint32_t subscription, const char* name);
    uint32_t (L4P_CALL *read)(const char* name, float* value);
} L4P_CvarApiV1;
typedef uint32_t (L4P_CALL *L4P_GetCvarApiFn)(uint32_t, L4P_CvarApiV1*);
/* V2 adds an opt-in setter clamp. V1 negotiation and layout are unchanged.
 * pin_locked uses the same lease/scope rules, additionally intercepting native
 * IConVar::SetValue(float) writes for exactly the leased object. Other variables
 * sharing its vtable pass through. Release restores the baseline and hook slot.
 * Interface/slot changes return CONFLICT; failed installation stays visible.
 */
typedef struct L4P_CvarApiV2 {
    uint32_t api_version, struct_size;
    uint32_t (L4P_CALL *pin)(uint32_t subscription, const char* name, float value);
    uint32_t (L4P_CALL *release)(uint32_t subscription, const char* name);
    uint32_t (L4P_CALL *read)(const char* name, float* value);
    uint32_t (L4P_CALL *pin_locked)(uint32_t subscription, const char* name, float value);
} L4P_CvarApiV2;
typedef uint32_t (L4P_CALL *L4P_GetCvarApiV2Fn)(uint32_t, L4P_CvarApiV2*);
/* V3: baseline-relative values, e.g. original brightness * 1.5. Pass the V1
 * cast of &api.base, with base.api_version=3 and struct_size=sizeof(V3).
 * factor is finite, 0..10. Repeated calls retain the captured baseline;
 * an engine variable identity change captures the new object's baseline.
 * Ordinary pin scope, ownership, value bounds and restoration rules apply.
 */
typedef struct L4P_CvarApiV3 {
    L4P_CvarApiV2 base;
    uint32_t (L4P_CALL *pin_relative)(uint32_t subscription, const char* name, float factor);
} L4P_CvarApiV3;
/* V4 adds non-writing numeric checkpoints for native CFG execution. Pass the
 * V1 cast of &api.base.base; version=4, size=sizeof(V4). checkpoint captures
 * the first baseline and exact variable identity without pinning its value.
 * It shares name ownership/scope/limits with numeric leases; a held pin and
 * a checkpoint conflict even for the same subscription. Repeating checkpoint
 * preserves the baseline, recapturing only if the native identity changed.
 * restore_checkpoints returns OK when all are restored, ERROR while pending;
 * off-thread calls queue the work. Failed restores retain their baseline and
 * retry on Paint. Scope exit/unsubscribe/shutdown also restore checkpoints.
 * forget_checkpoints intentionally discards only this owner's checkpoints,
 * keeping the current engine values. It is valid on the control thread.
 * These operations never execute CFG text or alter the native interpreter. */
typedef struct L4P_CvarApiV4 {
    L4P_CvarApiV3 base;
    uint32_t (L4P_CALL *checkpoint)(uint32_t subscription,const char* name);
    uint32_t (L4P_CALL *restore_checkpoints)(uint32_t subscription);
    uint32_t (L4P_CALL *forget_checkpoints)(uint32_t subscription);
} L4P_CvarApiV4;
L4P_EXPORT uint32_t L4P_CALL L4P_GetCvarApi(uint32_t version, L4P_CvarApiV1* output);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
