#ifndef L4P_GLOW_H
#define L4P_GLOW_H
#include "l4p_entity.h"
#define L4P_GLOW_CONFLICT 5u
#ifdef __cplusplus
extern "C" {
#endif
#pragma pack(push,8)
/* Paint-owned glow leases. Colours use 0x00BBGGRR (Windows COLORREF).
 * survivor_colour changes only the native GetGlowColor result for that survivor.
 * -1 preserves native RGB; force_alpha=1 sets alpha to one and requires LOCAL.
 * outline creates native type-3 through-wall glow and also requires LOCAL.
 * It acquires only objects whose current glow type is zero, validates the native
 * layout/signatures, and restores each still-owned field on release/scope exit.
 * Never retain raw entity addresses. References use handles and map epochs.
 * release(null) releases all of this subscription's colour and outline leases;
 * control-thread releases queue to Paint. Loading/disconnected/new-map teardown
 * discards old outline references without calling the dismantling glow manager.
 * outline_state: 0 awaiting client, 1 native entries ready, 2 unsupported.
 */
typedef struct L4P_GlowStatusV1 {uint32_t struct_size,colours,outlines,hooks,outline_state,conflicts,failures;} L4P_GlowStatusV1;
typedef struct L4P_GlowApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *survivor_colour)(uint32_t subscription,const L4P_EntityRefV1*,int32_t colour,uint32_t force_alpha);
    uint32_t (L4P_CALL *outline)(uint32_t subscription,const L4P_EntityRefV1*,uint32_t colour,int32_t range);
    uint32_t (L4P_CALL *release)(uint32_t subscription,const L4P_EntityRefV1*);
    uint32_t (L4P_CALL *status)(L4P_GlowStatusV1*);
} L4P_GlowApiV1;
typedef uint32_t (L4P_CALL *L4P_GetGlowApiFn)(uint32_t,L4P_GlowApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetGlowApi(uint32_t,L4P_GlowApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
