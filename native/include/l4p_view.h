#ifndef L4P_VIEW_H
#define L4P_VIEW_H
#include "l4p_source.h"
#ifdef __cplusplus
extern "C" {
#endif
#define L4P_PAINT_UI 1u
#define L4P_PAINT_GAME 2u
#pragma pack(push,8)
/* Paint-only, read-only engine view state. A combined pass has both bits.
 * Angles are available only in a connected non-loading match. Consumers select
 * their own pass (HUD: GAME, menu: UI); this prevents interleaved double drawing.
 */
typedef struct L4P_ViewV1 {
    uint32_t struct_size,paint_mode,game_ui,angles_valid;
    float angles[3];
} L4P_ViewV1;
typedef struct L4P_ViewApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *snapshot)(L4P_ViewV1* output);
} L4P_ViewApiV1;
typedef uint32_t (L4P_CALL *L4P_GetViewApiFn)(uint32_t,L4P_ViewApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetViewApi(uint32_t,L4P_ViewApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
