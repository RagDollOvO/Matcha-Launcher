#ifndef L4P_SOURCE_H
#define L4P_SOURCE_H
#include "l4p_plugin.h"
#ifdef __cplusplus
extern "C" {
#endif
#define L4P_SOURCE_VERSION 1u
#define L4P_SOURCE_ANY 0u
#define L4P_SOURCE_LOCAL 1u
#define L4P_SOURCE_COOP 2u
#pragma pack(push, 8)
typedef struct L4P_SourceFrameV1 {
    uint32_t struct_size, sequence, time_ms, game_thread;
    uint32_t connected, in_game, loading, local_server, versus;
    int32_t local_player, local_user;
    char map[128], mode[64];
} L4P_SourceFrameV1;
typedef void (L4P_CALL *L4P_SourceFrameFn)(void*, const L4P_SourceFrameV1*);
typedef void (L4P_CALL *L4P_SourceEventFn)(void*, const L4P_SourceFrameV1*, const char*, void*);
/* Subscribe from init/invoke; callbacks run on the engine Paint/event thread.
 * events is a comma-separated list (max 32 identifiers); text is copied.
 * unsubscribe waits for callbacks to finish. Callback pointers/context stay valid
 * until it returns. Snapshot returns a COPY; no game objects cross to the caller.
 * Event pointers are borrowed only during their callback. Commands/getters are
 * game-thread-only. command submits ordinary ClientCmd; engine flags still apply.
 * exec_cfg accepts a bounded relative .cfg filename and submits trusted exec via
 * ClientCmd_Unrestricted. The caller validates the selected on-disk file.
 * Frame callbacks always receive disconnect/mode changes, including disallowed
 * sessions, so an owner can restore state. Event callbacks obey the scope gate.
 * allowed(frame,scope) must gate a feature's frame work as well.
 * Dependency: beacon.source 0.1.0. API 1 Host/Plugin layouts stay unchanged. */
typedef struct L4P_SourceApiV1 {
    uint32_t api_version, struct_size;
    uint32_t (L4P_CALL *subscribe)(const char* id, uint32_t scope, const char* events,
        void* context, L4P_SourceFrameFn frame, L4P_SourceEventFn event, uint32_t* token);
    uint32_t (L4P_CALL *unsubscribe)(uint32_t token);
    uint32_t (L4P_CALL *snapshot)(L4P_SourceFrameV1* frame);
    uint32_t (L4P_CALL *allowed)(const L4P_SourceFrameV1*, uint32_t scope);
    int32_t (L4P_CALL *event_int)(void* event, const char* key, int32_t fallback);
    float (L4P_CALL *event_float)(void* event, const char* key, float fallback);
    uint32_t (L4P_CALL *command)(const char* command);
    uint32_t (L4P_CALL *exec_cfg)(const char* relative_cfg);
} L4P_SourceApiV1;
/* V2 adds a copied UTF-8 event string; call only during its event callback.
 * size includes the terminator. V1 getters and layout remain unchanged. */
typedef struct L4P_SourceApiV2 {
    L4P_SourceApiV1 base;
    uint32_t (L4P_CALL *event_text)(void* event,const char* key,char* output,uint32_t capacity,uint32_t* size);
} L4P_SourceApiV2;
typedef uint32_t (L4P_CALL *L4P_GetSourceApiFn)(uint32_t, L4P_SourceApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
