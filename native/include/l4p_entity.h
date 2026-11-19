#ifndef L4P_ENTITY_H
#define L4P_ENTITY_H
#include "l4p_source.h"
#ifdef __cplusplus
extern "C" {
#endif
#define L4P_ENTITY_MISSING 7u
#define L4P_ENTITY_STALE 8u
#define L4P_ENTITY_SCOPE 6u
#define L4P_FIELD_INT 0u
#define L4P_FIELD_FLOAT 1u
#define L4P_FIELD_VECTOR 2u
#define L4P_FIELD_BYTE 3u
#define L4P_FIELD_SHORT 4u
#pragma pack(push,8)
/* References contain the engine handle (including serial), plus map epoch.
 * No entity address escapes the SDK. Use only on Source callbacks; reads copy
 * values. Field names are RecvProp names, resolved per concrete network class.
 * BYTE copies 1 byte (lifeState / bool), SHORT copies 2 (model index),
 * and INT copies 4. The caller chooses the native field's storage width.
 * A dotted field path selects a specific child table; unqualified names search
 * recursively. Outputs remain untouched on missing/stale/type-mismatched reads.
 */
typedef struct L4P_EntityRefV1 {uint32_t index,handle,epoch;} L4P_EntityRefV1;
typedef struct L4P_EntityInfoV1 {
    uint32_t struct_size;L4P_EntityRefV1 ref;char class_name[96];
    int32_t user_id;uint32_t is_bot;char player_name[128];
} L4P_EntityInfoV1;
typedef struct L4P_EntityApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *reference)(int32_t index,L4P_EntityRefV1* output);
    uint32_t (L4P_CALL *describe)(const L4P_EntityRefV1*,L4P_EntityInfoV1* output);
    uint32_t (L4P_CALL *read)(const L4P_EntityRefV1*,const char* field,uint32_t type,void* output);
    uint32_t (L4P_CALL *highest)(int32_t* output);
    uint32_t (L4P_CALL *from_handle)(uint32_t handle,L4P_EntityRefV1* output);
    uint32_t (L4P_CALL *client_time)(float* output);
    uint32_t (L4P_CALL *eye)(const L4P_EntityRefV1*,float output[3]);
    uint32_t (L4P_CALL *for_user)(int32_t user_id,L4P_EntityRefV1* output);
    uint32_t (L4P_CALL *model_name)(const L4P_EntityRefV1*,char* output,uint32_t capacity,uint32_t* size);
} L4P_EntityApiV1;

/* V2 embeds the complete V1 prefix. Pass &api.base to GetEntityApi(2,...),
 * with base.api_version=2 and base.struct_size=sizeof(L4P_EntityApiV2).
 * read_index reads a native integer RecvTable array (strides 1,2,4; indices
 * 0..64), promoting byte as unsigned and short/int as signed, as in L4D2's
 * PlayerResource. player_info works even when a player entity is not present
 * in the local PVS; ref/class are filled when that entity is available.
 */
typedef struct L4P_EntityApiV2 {
    L4P_EntityApiV1 base;
    uint32_t (L4P_CALL *read_index)(const L4P_EntityRefV1*,const char* field,int32_t index,int32_t* output);
    uint32_t (L4P_CALL *player_info)(int32_t index,L4P_EntityInfoV1* output);
} L4P_EntityApiV2;
/* V3 keeps V2 as its prefix. move_type resolves m_MoveType / m_nMoveType /
 * movetype, or the byte immediately following native m_nRenderMode. This
 * specific Source layout stays inside the service; arbitrary offsets are not
 * exposed. Missing/stale reads preserve output. Velocity remains a named read
 * of m_vecVelocity[0] with FIELD_VECTOR. */
typedef struct L4P_EntityApiV3 {
    L4P_EntityApiV2 base;
    uint32_t (L4P_CALL *move_type)(const L4P_EntityRefV1*,uint8_t* output);
} L4P_EntityApiV3;
typedef uint32_t (L4P_CALL *L4P_GetEntityApiFn)(uint32_t,L4P_EntityApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetEntityApi(uint32_t,L4P_EntityApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
