#ifndef L4P_PARTICLE_H
#define L4P_PARTICLE_H
#include "l4p_source.h"
#ifdef __cplusplus
extern "C" {
#endif
#pragma pack(push,8)
/* Cosmetic particles. precache/exists/dispatch require Paint and an allowed
 * subscription. Precache selected assets after map setup, before combat.
 * dispatch preserves Skeeto's 32 calls / 1000 ms budget per owner. World space
 * uses the supplied origin and {0,270,0}; screen space uses zero vectors.
 *
 * boot_manifests registers <particles>/<prefix>*.txt at initialization. The
 * original engine manifest is built first. Appending runs on the engine's
 * manifest-building thread; neither Paint nor the setup worker parses PCFs.
 * prefix is a simple filename prefix; limit is 1..48. One owner at a time.
 * release/unsubscribe stops future appends. Already registered libraries stay
 * with the engine until process exit, so a settings UI applies this option on
 * the next game launch. No game files or base manifests are replaced.
 */
typedef struct L4P_ParticleStatusV1 {
    uint32_t struct_size;
    uint32_t backend; /* 0 waiting, 1 ready, 2 unsupported, 3 native failure */
    uint32_t manifest; /* 0 off, 1 waiting, 2 ready, 3 unsupported, 4 failure, 5 foreign hook */
    uint32_t manifests_appended,dispatched,throttled,failures;
} L4P_ParticleStatusV1;
typedef struct L4P_ParticleApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *boot_manifests)(uint32_t token,const char* prefix,uint32_t limit);
    uint32_t (L4P_CALL *release_manifests)(uint32_t token);
    uint32_t (L4P_CALL *precache)(uint32_t token,const char* name);
    uint32_t (L4P_CALL *exists)(uint32_t token,const char* name,uint32_t* present);
    uint32_t (L4P_CALL *dispatch)(uint32_t token,const char* name,const float origin[3],uint32_t world_space);
    uint32_t (L4P_CALL *status)(uint32_t token,L4P_ParticleStatusV1* output);
} L4P_ParticleApiV1;
typedef uint32_t (L4P_CALL *L4P_GetParticleApiFn)(uint32_t,L4P_ParticleApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetParticleApi(uint32_t,L4P_ParticleApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
