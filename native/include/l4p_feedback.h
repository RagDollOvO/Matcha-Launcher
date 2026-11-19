#ifndef L4P_FEEDBACK_H
#define L4P_FEEDBACK_H
#include "l4p_entity.h"
#ifdef __cplusplus
extern "C" {
#endif
#pragma pack(push,8)
/* Health observation is read-only. watch/next/overlay require Paint and an
 * allowed subscription; release accepts control-thread cleanup. Each watcher
 * has a 32-entry player HP-drop queue, preserving the original receive time.
 * next drops stale identities, respawns, HP resets and samples older than
 * 400 ms; available=0 means drained. Consumers perform their own attribution.
 * Overlay owns the engine's one fullscreen material slot. An empty material
 * clears it. release/disable clear it and restore the command's owned flags.
 */
typedef struct L4P_HealthDropV1 {
    uint32_t struct_size;L4P_EntityRefV1 target;uint32_t time_ms;
    int32_t before,after,team,user_id;
} L4P_HealthDropV1;
typedef struct L4P_FeedbackApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *watch_health)(uint32_t token,uint32_t enabled);
    uint32_t (L4P_CALL *next_health)(uint32_t token,L4P_HealthDropV1* output,uint32_t* available);
    uint32_t (L4P_CALL *overlay)(uint32_t token,const char* material);
    uint32_t (L4P_CALL *release)(uint32_t token);
    /* Paint outside loading: 0 complete, 1 loading. MISSING means this GameUI
     * version has no recognized indicator; ordinary GAME discovery continues. */
    uint32_t (L4P_CALL *addon_loading)(uint32_t token,int32_t* output);
} L4P_FeedbackApiV1;
typedef uint32_t (L4P_CALL *L4P_GetFeedbackApiFn)(uint32_t,L4P_FeedbackApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetFeedbackApi(uint32_t,L4P_FeedbackApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
