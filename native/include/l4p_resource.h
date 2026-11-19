#ifndef L4P_RESOURCE_H
#define L4P_RESOURCE_H
#include "l4p_source.h"
#ifdef __cplusplus
extern "C" {
#endif
#define L4P_RESOURCE_CONFLICT 5u
#pragma pack(push,8)
/* Cooperative exclusion for features sharing an effect, e.g. DSP vs gun layers.
 * claim runs in Paint under an allowed subscription. First holder keeps ownership;
 * other callers receive CONFLICT and retain their saved settings. Release after
 * restoring that feature's game state. Control-thread releases queue to Paint.
 * Unsubscribe/scope exit releases after Source restores Cvars, lights and voices.
 * owner returns the subscription ID, or an empty string when unclaimed.
 */
typedef struct L4P_ResourceApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *claim)(uint32_t subscription,const char* name);
    uint32_t (L4P_CALL *release)(uint32_t subscription,const char* name);
    uint32_t (L4P_CALL *owner)(const char* name,char output[65]);
} L4P_ResourceApiV1;
typedef uint32_t (L4P_CALL *L4P_GetResourceApiFn)(uint32_t,L4P_ResourceApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetResourceApi(uint32_t,L4P_ResourceApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
