#ifndef L4P_AUDIO_H
#define L4P_AUDIO_H
#include "l4p_entity.h"
#ifdef __cplusplus
extern "C" {
#endif
#pragma pack(push,8)
/* Owned local playback, distinct from the sound-start volume filter API.
 * prepare/emit run only inside an allowed Source callback. sample is a relative
 * game sound path (mounted game/VPK assets); no file extraction or downloading.
 * spatial uses a checked entity ref and an explicit origin. Nonspatial emission
 * uses the local player. Slots 0..7 rotate within a private per-owner channel bank.
 * stop_all is callable from control threads; it queues game-thread GUID stops.
 * Unsubscribe/scope exit stops only this owner's voices. No StopAllSounds call.
 */
typedef struct L4P_AudioEmitV1 {
    uint32_t struct_size,slot,spatial;L4P_EntityRefV1 entity;float origin[3];
    float volume,attenuation;int32_t pitch;const char* sample;
} L4P_AudioEmitV1;
typedef struct L4P_AudioApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *prepare)(uint32_t subscription,const char* sample);
    uint32_t (L4P_CALL *emit)(uint32_t subscription,const L4P_AudioEmitV1*,int32_t* guid);
    uint32_t (L4P_CALL *stop_all)(uint32_t subscription);
} L4P_AudioApiV1;
typedef uint32_t (L4P_CALL *L4P_GetAudioApiFn)(uint32_t,L4P_AudioApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetAudioApi(uint32_t,L4P_AudioApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
