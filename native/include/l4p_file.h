#ifndef L4P_FILE_H
#define L4P_FILE_H
#include "l4p_source.h"
#ifdef __cplusplus
extern "C" {
#endif
#pragma pack(push,8)
/* Read-only mounted GAME files (loose files and VPKs). Open/read/find run on
 * Paint outside loading; ANY subscriptions also work in menus. Paths are UTF-8,
 * game-relative with '/' separators; find accepts '*'/'?' in the last segment.
 * Each read is <=256 KiB; callers spread extraction over frames. max_bytes is
 * 1..1 GiB. File size is captured at open; premature EOF returns an error.
 * Handles are owned by the subscription. close/find_close accept control-thread
 * requests, applied on the next Paint. Unsubscribe closes that owner's handles.
 * Find entries preserve names and directory flags. done=1 means end, and the
 * caller still closes the search. No OS path or native pointer escapes the SDK.
 */
typedef struct L4P_FileEntryV1 {uint32_t struct_size,is_directory,done;char name[260];} L4P_FileEntryV1;
typedef struct L4P_FileApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *open)(uint32_t subscription,const char* path,uint32_t max_bytes,uint32_t* handle,uint32_t* size);
    uint32_t (L4P_CALL *read)(uint32_t subscription,uint32_t handle,void* bytes,uint32_t capacity,uint32_t* count);
    uint32_t (L4P_CALL *close)(uint32_t subscription,uint32_t handle);
    uint32_t (L4P_CALL *find_open)(uint32_t subscription,const char* glob,uint32_t* handle);
    uint32_t (L4P_CALL *find_next)(uint32_t subscription,uint32_t handle,L4P_FileEntryV1* entry);
    uint32_t (L4P_CALL *find_close)(uint32_t subscription,uint32_t handle);
} L4P_FileApiV1;
/* V2 retains V1 and adds a package-local GAME mount. mount_assets resolves
 * <Source sibling>/<subscription id>/assets, rejecting path-like IDs/reparse
 * roots. It adds that directory at the TAIL, preserving existing game/mod
 * overrides. No file is copied into the game. Calls require Paint outside
 * loading. unmount_assets queues control-thread cleanup; unsubscribe/scope exit
 * removes only this mount. A failed remove is retried on later Paints. */
typedef struct L4P_FileApiV2 {
    L4P_FileApiV1 base;
    uint32_t (L4P_CALL *mount_assets)(uint32_t subscription);
    uint32_t (L4P_CALL *unmount_assets)(uint32_t subscription);
} L4P_FileApiV2;
/* V3 retains V2. path_revision samples the mounted GAME search path (including
 * packs) without enumerating files. The opaque nonzero fingerprint is useful
 * for invalidating an asset catalog after a workshop mount changes. Compare
 * only for equality; it is not a version number. Paint outside loading, with
 * the same subscription scope as open. No filesystem path is returned. */
typedef struct L4P_FileApiV3 {
    L4P_FileApiV2 base;
    uint32_t (L4P_CALL *path_revision)(uint32_t subscription,uint32_t* revision);
} L4P_FileApiV3;
typedef uint32_t (L4P_CALL *L4P_GetFileApiFn)(uint32_t,L4P_FileApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetFileApi(uint32_t,L4P_FileApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
