#ifndef L4P_LOCALIZE_H
#define L4P_LOCALIZE_H
#include "l4p_source.h"
#ifdef __cplusplus
extern "C" {
#endif
#pragma pack(push,8)
/* Paint-time UTF-8 localization overrides; first owner wins for each token.
 * Token: 1..79 ASCII letters/digits/underscore (optional leading #, ignored,
 * case-insensitive). Value: 1..256 UTF-16 units, valid UTF-8, no controls.
 * Copied immutable values live for the process lifetime, including pointers
 * retained by native panels; max 4096 distinct values, 256 active overrides.
 * clear accepts a token or null for all owned values, on any thread. ANY
 * subscriptions also work in menus; LOCAL/COOP retain their session scope.
 * Native table contents are unchanged. VGUI_Localize005::Find slot 2 is
 * restored on Paint only while still owned; a later hook keeps a transparent
 * resident predecessor. read copies the effective native lookup as UTF-8 in
 * Paint (up to 1024 UTF-16 units); size includes NUL. On short capacity only
 * size changes. HUDs use read for BOT tokens and retain human network names.
 * State: 0 idle, 1 waiting, 2 hooked, 3 conflict/error. */
typedef struct L4P_LocalizeApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *set)(uint32_t token,const char* key,const char* value);
    uint32_t (L4P_CALL *clear)(uint32_t token,const char* key);
    uint32_t (L4P_CALL *status)(uint32_t* state);
    uint32_t (L4P_CALL *read)(const char* key,char* output,uint32_t capacity,uint32_t* size);
} L4P_LocalizeApiV1;
typedef uint32_t (L4P_CALL *L4P_GetLocalizeApiFn)(uint32_t,L4P_LocalizeApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetLocalizeApi(uint32_t,L4P_LocalizeApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
