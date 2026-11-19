#ifndef L4P_CORPSE_H
#define L4P_CORPSE_H
#include "l4p_entity.h"
#ifdef __cplusplus
extern "C" {
#endif
#define L4P_CORPSE_CONFLICT 5u
/* LOCAL, game Paint only. The consumer establishes a death from game events;
 * hide accepts common/Witch/ragdoll classes, never player slots 1..64 or pawn
 * classes. It owns only NODRAW, render mode and render colour. Repeated calls
 * preserve or refresh native baselines. Entity address, full handle and epoch
 * protect reuse. Release restores fields still owned, preserving other bits
 * and external edits. Off-thread release queues cleanup; scope exit and
 * unsubscribe also restore. Failed writes remain queued for the next Paint.
 * destroy_ragdolls submits exactly cl_destroy_ragdolls through the native
 * interpreter; its finite scheduling belongs to the consumer. It removes
 * existing client ragdolls, which are recreated by subsequent game events. */
#pragma pack(push,8)
typedef struct L4P_CorpseApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *hide)(uint32_t subscription,const L4P_EntityRefV1*);
    uint32_t (L4P_CALL *release)(uint32_t subscription,const L4P_EntityRefV1*);
    uint32_t (L4P_CALL *destroy_ragdolls)(uint32_t subscription);
} L4P_CorpseApiV1;
typedef uint32_t (L4P_CALL *L4P_GetCorpseApiFn)(uint32_t,L4P_CorpseApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetCorpseApi(uint32_t,L4P_CorpseApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
