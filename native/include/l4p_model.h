#ifndef L4P_MODEL_H
#define L4P_MODEL_H
#include "l4p_entity.h"
#ifdef __cplusplus
extern "C" {
#endif
#define L4P_MODEL_FIELD 0u
#define L4P_MODEL_BONES 1u
#pragma pack(push,8)
/* Local-scope, Paint-only model scaling. Values are 0.1..5; 1 releases the lease.
 * FIELD owns m_flModelScale + its RecvProxy. BONES keeps that field at 1 and
 * scales BuildTransformations matrices around entity origin (slot 175, <=128
 * bones). Only matrices matching the native bone mask are changed.
 * Identity includes handle serial, object and map epoch. Release restores the
 * last native/server value if the field is still ours. Unknown hook entries
 * are preserved; retained per-slot thunks always forward to their own original.
 * release from control thread is applied next Paint. Scope exit restores live
 * objects; new-map epochs abandon old references. Collision data is untouched.
 */
typedef struct L4P_ModelStatusV1 {uint32_t struct_size,leases,build_hooks,proxy_hooks,conflicts,read_failures;} L4P_ModelStatusV1;
typedef struct L4P_ModelApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *scale)(uint32_t subscription,const L4P_EntityRefV1*,float value,uint32_t method);
    uint32_t (L4P_CALL *release)(uint32_t subscription,const L4P_EntityRefV1* optional_entity);
    uint32_t (L4P_CALL *status)(L4P_ModelStatusV1* output);
} L4P_ModelApiV1;
typedef uint32_t (L4P_CALL *L4P_GetModelApiFn)(uint32_t,L4P_ModelApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetModelApi(uint32_t,L4P_ModelApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
