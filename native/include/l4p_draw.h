#ifndef L4P_DRAW_H
#define L4P_DRAW_H
#include "l4p_source.h"
#ifdef __cplusplus
extern "C" {
#endif
#pragma pack(push,8)
typedef struct L4P_ColorV1 {uint8_t r,g,b,a;} L4P_ColorV1;
typedef struct L4P_DrawStatusV1 {uint32_t struct_size,state,fonts,textures;} L4P_DrawStatusV1;
/* VGUI_Surface031 drawing, only inside a UI (1) or GAME (2) Paint callback.
 * Consumers use ViewApi.paint_mode to choose their pass and avoid double draws.
 * ANY subscribers may draw menus; LOCAL/COOP retain their session gates. HUD
 * consumers should additionally use Source.allowed to hide outside a match.
 * Source borrows an open surface context, or opens/closes its own current root
 * panel context for this Paint. Every primitive sets its own colour/texture.
 * Fonts/textures are opaque process-lifetime cached IDs; repeated requests share
 * them. Failed creations are cached too. All text is bounded, valid UTF-8.
 * status: 0 awaiting module, 1 ready, 2 unsupported drawing-context signature.
 */
typedef struct L4P_DrawApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *screen)(uint32_t subscription,int32_t* width,int32_t* height);
    uint32_t (L4P_CALL *project)(uint32_t subscription,const float world[3],float screen[2]);
    uint32_t (L4P_CALL *rect)(uint32_t subscription,int32_t x,int32_t y,int32_t width,int32_t height,L4P_ColorV1 color,uint32_t filled);
    uint32_t (L4P_CALL *line)(uint32_t subscription,int32_t x0,int32_t y0,int32_t x1,int32_t y1,L4P_ColorV1 color);
    uint32_t (L4P_CALL *font)(uint32_t subscription,const char* face,int32_t height,int32_t weight,uint32_t flags,uint32_t* id);
    uint32_t (L4P_CALL *measure)(uint32_t subscription,uint32_t font,const char* text,int32_t* width,int32_t* height);
    uint32_t (L4P_CALL *text)(uint32_t subscription,uint32_t font,int32_t x,int32_t y,L4P_ColorV1 color,const char* text);
    uint32_t (L4P_CALL *texture_file)(uint32_t subscription,const char* material,uint32_t* id,int32_t* width,int32_t* height);
    uint32_t (L4P_CALL *texture)(uint32_t subscription,uint32_t id,int32_t x,int32_t y,int32_t width,int32_t height,const float uv[4],L4P_ColorV1 color);
    uint32_t (L4P_CALL *status)(L4P_DrawStatusV1* output);
} L4P_DrawApiV1;
typedef uint32_t (L4P_CALL *L4P_GetDrawApiFn)(uint32_t,L4P_DrawApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetDrawApi(uint32_t,L4P_DrawApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
