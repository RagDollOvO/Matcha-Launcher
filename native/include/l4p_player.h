#ifndef L4P_PLAYER_H
#define L4P_PLAYER_H
#include "l4p_entity.h"
#ifdef __cplusplus
extern "C" {
#endif
#define L4P_PLAYER_FLASHLIGHT 100u
#pragma pack(push,8)
/* Paint-only local player's ordinary controls. A live subscription, connected
 * match, owned living survivor, observer mode zero and closed game UI are
 * required for writes. action accepts slot 1..5 or FLASHLIGHT (impulse 100),
 * dispatched through ClientCmd_Unrestricted; it accepts no command text and
 * changes no command flags. The server continues to decide the action.
 * Native camera mode is read/set only on the exact supported client image.
 * camera_status: 0 waiting, 1 supported, 2 unsupported, 3 native call fault.
 * Read outputs are preserved on failure. Angles use finite degrees, pitch
 * strictly between -90 and 90, yaw/roll within +/-360. */
typedef struct L4P_PlayerApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *set_angles)(uint32_t token,const float angles[3]);
    uint32_t (L4P_CALL *camera_mode)(uint32_t token,uint32_t* third_person);
    uint32_t (L4P_CALL *set_camera_mode)(uint32_t token,uint32_t third_person);
    uint32_t (L4P_CALL *action)(uint32_t token,uint32_t action);
    uint32_t (L4P_CALL *camera_status)(uint32_t* state);
} L4P_PlayerApiV1;
typedef uint32_t (L4P_CALL *L4P_GetPlayerApiFn)(uint32_t,L4P_PlayerApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetPlayerApi(uint32_t,L4P_PlayerApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
