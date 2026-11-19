#ifndef L4P_WEAPON_H
#define L4P_WEAPON_H
#include "l4p_entity.h"
#ifdef __cplusplus
extern "C" {
#endif
#pragma pack(push,8)
/* Local weapon-script metadata. Paint-only, LOCAL subscription. No raw pointers.
 * clip_capacity returns the script's 1..65535 capacity; unsupported/missing
 * metadata returns ENTITY_MISSING with output untouched. Consumers retain their
 * documented vanilla fallback. Includes no dual-pistol multiplier.
 * status: 0 waiting, 1 native lookup ready, 2 unsupported, 3 native fault (disabled).
 */
typedef struct L4P_WeaponApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *clip_capacity)(uint32_t subscription,const L4P_EntityRefV1*,int32_t* output);
    uint32_t (L4P_CALL *status)(uint32_t* output);
} L4P_WeaponApiV1;
typedef uint32_t (L4P_CALL *L4P_GetWeaponApiFn)(uint32_t,L4P_WeaponApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetWeaponApi(uint32_t,L4P_WeaponApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
