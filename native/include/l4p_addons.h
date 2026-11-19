#ifndef L4P_ADDONS_H
#define L4P_ADDONS_H
#include "l4p_source.h"
#ifdef __cplusplus
extern "C" {
#endif
#pragma pack(push,8)
/* Native attachment creation mask, independent of inventory. Filters only
 * remove bits (return value AND input), on the game thread. They receive a
 * copied five-slot weapon ID array, with no entity pointer. No SDK reentry,
 * blocking or filesystem work inside a filter. Register from a Paint callback.
 * Subscription scope is refreshed at Paint, matching the engine update cycle.
 * clear/unsubscribe drain filters; the next native update recreates attachments.
 * State: 0 idle,1 awaiting engine,2 hooked,3 unsupported,4 hook failed,5 foreign
 * entry,6 temporary mask restoration failed. Source retains all trampolines.
 */
typedef uint32_t (L4P_CALL *L4P_AddonFilterFn)(void* context,int32_t team,uint32_t bits,const int32_t weapon_ids[5]);
typedef struct L4P_AddonStatusV1 {
    uint32_t struct_size,state,filters,matched_signatures;
    uint32_t calls,filtered,wrong_thread,read_failures;
} L4P_AddonStatusV1;
typedef struct L4P_AddonApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *set_filter)(uint32_t subscription,void* context,L4P_AddonFilterFn callback);
    uint32_t (L4P_CALL *clear_filter)(uint32_t subscription);
    uint32_t (L4P_CALL *status)(L4P_AddonStatusV1* output);
} L4P_AddonApiV1;
typedef uint32_t (L4P_CALL *L4P_GetAddonApiFn)(uint32_t,L4P_AddonApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetAddonApi(uint32_t,L4P_AddonApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
