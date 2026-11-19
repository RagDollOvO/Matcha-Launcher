#ifndef L4P_DISSOLVE_H
#define L4P_DISSOLVE_H
#include "l4p_entity.h"
#ifdef __cplusplus
extern "C" {
#endif
#define L4P_DISSOLVE_COMMON 0u
#define L4P_DISSOLVE_SPECIAL 1u
#define L4P_DISSOLVE_ALL 2u
#define L4P_DISSOLVE_CONFLICT 5u
#define L4P_DISSOLVE_LIMIT 9u
/* ANY cosmetics, same-process C_EntityDissolve. Start/busy are Paint-only;
 * life may be read in a Source event or frame. Caller establishes death from
 * zombie_death and selects a typed target, never nearest living infected.
 * Player targets require userid + the captured player_life epoch. The service
 * tracks player_spawn and refuses/retires references to an earlier life.
 * Default render mutation is native fade. Player pawns/common infected never
 * receive NODRAW. Witch/ragdolls may be hidden until release or map teardown.
 * Native think/draw stay with the engine. No manual Think in Paint.
 * release works from control thread; cleanup runs on Paint and retains failed
 * restorations. Completed target leases remain bounded and restore on disable.
 * Status backend: 0 waiting, 1 ready, 2 unsupported, 3 native fault. */
#pragma pack(push,8)
typedef struct L4P_DissolveRequestV1 {
    uint32_t struct_size;L4P_EntityRefV1 target;
    uint32_t category,type,duration_ms;int32_t player_user;uint32_t player_life;
} L4P_DissolveRequestV1;
typedef struct L4P_DissolveStatusV1 {
    uint32_t struct_size,backend,active,common_active,retained;
    uint32_t started,finished,failures,orphans,common_retained,special_retained;
} L4P_DissolveStatusV1;
typedef struct L4P_DissolveApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *player_life)(int32_t user,uint32_t* epoch);
    uint32_t (L4P_CALL *start)(uint32_t subscription,const L4P_DissolveRequestV1*);
    uint32_t (L4P_CALL *busy)(const L4P_EntityRefV1*,uint32_t*);
    uint32_t (L4P_CALL *release)(uint32_t subscription,uint32_t category);
    uint32_t (L4P_CALL *destroy_ragdolls)(uint32_t subscription);
    uint32_t (L4P_CALL *status)(uint32_t subscription,L4P_DissolveStatusV1*);
} L4P_DissolveApiV1;
typedef uint32_t (L4P_CALL *L4P_GetDissolveApiFn)(uint32_t,L4P_DissolveApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetDissolveApi(uint32_t,L4P_DissolveApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
