#ifndef L4P_EFFECTS_H
#define L4P_EFFECTS_H
#include "l4p_entity.h"
#ifdef __cplusplus
extern "C" {
#endif
#define L4P_TRACE_SHOT 0x46004003u
#pragma pack(push,8)
/* Trace/light calls require a Source PAINT callback and an allowed subscription.
 * A trace filter can be world-only or skip one checked entity. Light slots 0..15
 * are owned by the subscription; drop/unsubscribe/scope exit restores ownership.
 * Light pointers never cross the API or survive a map change. New declarations
 * are copied; ttl is 0.01..1 sec. Only explicit ongoing refresh keeps light alive.
 */
typedef struct L4P_TraceV1 {
    uint32_t struct_size;float end[3],normal[3],fraction;
    uint32_t all_solid,start_solid;int32_t contents,hit_group,hit_box;
    L4P_EntityRefV1 hit;
} L4P_TraceV1;
typedef struct L4P_LightV1 {
    uint32_t struct_size;float origin[3],radius,ttl;
    uint8_t red,green,blue;int8_t exponent;
} L4P_LightV1;
typedef struct L4P_EffectsApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *trace)(uint32_t token,const float from[3],const float to[3],uint32_t mask,uint32_t world_only,const L4P_EntityRefV1* skip,L4P_TraceV1* output);
    uint32_t (L4P_CALL *light)(uint32_t token,uint32_t slot,const L4P_LightV1* light);
    uint32_t (L4P_CALL *drop_light)(uint32_t token,uint32_t slot);
} L4P_EffectsApiV1;
typedef uint32_t (L4P_CALL *L4P_GetEffectsApiFn)(uint32_t,L4P_EffectsApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetEffectsApi(uint32_t,L4P_EffectsApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
