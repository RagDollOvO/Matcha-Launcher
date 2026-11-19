#ifndef L4P_SOUND_H
#define L4P_SOUND_H
#include "l4p_source.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Source sound-start extension. A filter belongs to a live ANY subscription.
 * It runs on the engine's emitting thread, including menu/UI sounds. Keep it
 * allocation-free and nonblocking; never call Source/Cvar/Sound APIs from it.
 * The sample is a borrowed, normalized-by-the-consumer path; return the volume.
 * clear/unsubscribe drains the current callback before returning. Entry patches
 * install/restore on Paint; an empty filter set immediately passes all sounds.
 * Status 0=idle, 1=waiting for Paint/engine, 2=hooked, 3=unsupported signature,
 * 4=hook operation failed, 5=entry changed by another owner. Hooks are x86 only.
 */
typedef float (L4P_CALL *L4P_SoundFilterFn)(void* context,const char* sample,float volume);
#pragma pack(push,8)
typedef struct L4P_SoundStatusV1 {
    uint32_t struct_size,state,filters,matched_signatures;
    uint32_t sounds,modified,unresolved_names,callback_errors;
} L4P_SoundStatusV1;
typedef struct L4P_SoundApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *set_filter)(uint32_t subscription,void* context,L4P_SoundFilterFn filter);
    uint32_t (L4P_CALL *clear_filter)(uint32_t subscription);
    uint32_t (L4P_CALL *status)(L4P_SoundStatusV1* output);
} L4P_SoundApiV1;
typedef uint32_t (L4P_CALL *L4P_GetSoundApiFn)(uint32_t,L4P_SoundApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetSoundApi(uint32_t version,L4P_SoundApiV1* output);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
