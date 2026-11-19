#ifndef L4P_VIEWMODEL_H
#define L4P_VIEWMODEL_H
#include "l4p_entity.h"
#ifdef __cplusplus
extern "C" {
#endif
#define L4P_VIEWMODEL_CONFLICT 5u
/* Same-process first-person cosmetics, ANY subscription. snapshot/set run on
 * Paint; release/status may run on the control thread. Two slots are an atomic
 * publication. snapshot returns copied model identities, no native pointers.
 * binding_id guards weapon/header changes between reading and publishing.
 * Native Calc runs first, then the additive pose; completed bone matrices are
 * scaled about their centroid and reflected about the camera plane. Per-slot
 * opposite mirror states sharing a script pause mirror only. Scale continues.
 * release/scope exit/unsubscribe restore owned fields and hook slots. Resident
 * trampolines retain upstream pointers if a third-party hook still chains them.
 * Status: 0 idle/waiting, 1 active/supported, 2 unsupported, 3 native failure,
 * 5 shared-owner or mirror-identity conflict. */
#pragma pack(push,8)
typedef struct L4P_ViewmodelSlotV1 {
    uint32_t binding_id;L4P_EntityRefV1 ref;uint32_t checksum;
    char model[260];
} L4P_ViewmodelSlotV1;
typedef struct L4P_ViewmodelSnapshotV1 {
    uint32_t struct_size;L4P_ViewmodelSlotV1 slots[2];
} L4P_ViewmodelSnapshotV1;
typedef struct L4P_ViewmodelPoseV1 {
    uint32_t binding_id;float position[3],rotation[3],pivot[3];
    float scale;uint32_t mirror;
} L4P_ViewmodelPoseV1;
typedef struct L4P_ViewmodelStatusV1 {
    uint32_t struct_size,pose_state,mirror_state,scale_state;
    uint32_t calls,applied,builds,matrices,conflicts,failures;
} L4P_ViewmodelStatusV1;
typedef struct L4P_ViewmodelApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *snapshot)(uint32_t subscription,L4P_ViewmodelSnapshotV1*);
    uint32_t (L4P_CALL *set)(uint32_t subscription,const L4P_ViewmodelPoseV1 poses[2]);
    uint32_t (L4P_CALL *release)(uint32_t subscription);
    uint32_t (L4P_CALL *status)(L4P_ViewmodelStatusV1*);
} L4P_ViewmodelApiV1;
typedef uint32_t (L4P_CALL *L4P_GetViewmodelApiFn)(uint32_t,L4P_ViewmodelApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetViewmodelApi(uint32_t,L4P_ViewmodelApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
