#ifndef L4P_GAME_UI_H
#define L4P_GAME_UI_H
#include "l4p_plugin.h"
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

#define L4P_GAME_UI_VERSION 1u
#define L4P_GAME_UI_MAX_ROWS 48u
#define L4P_MENU_LINK 1u
#define L4P_MENU_TOGGLE 2u
#define L4P_MENU_RANGE 3u
#define L4P_MENU_CHOICE 4u
#define L4P_MENU_ACTION 5u
#define L4P_MENU_CLOSE 5u /* Result of a change callback: hand off to custom UI. */

#pragma pack(push,8)
typedef struct L4P_GameMenuRowV1 {
    uint32_t kind, id, disabled;
    int32_t value, minimum, maximum, step;
    wchar_t label[64], value_text[24];
} L4P_GameMenuRowV1;

typedef struct L4P_GameMenuPageV1 {
    uint32_t count;
    wchar_t title[64], note[96];
    L4P_GameMenuRowV1 rows[L4P_GAME_UI_MAX_ROWS];
} L4P_GameMenuPageV1;

typedef struct L4P_GameUiFrameV1 {
    uint32_t struct_size, time_ms, in_game, local_game, game_ui, menu_open;
    void* window;
} L4P_GameUiFrameV1;

typedef void (L4P_CALL *L4P_GameUiFrameFn)(void*, const L4P_GameUiFrameV1*);
typedef uint32_t (L4P_CALL *L4P_GameUiInputFn)(void*, uint32_t message, uint32_t key, int32_t data);
typedef uint32_t (L4P_CALL *L4P_GameUiPageFn)(void*, uint32_t page_id, L4P_GameMenuPageV1*);
typedef uint32_t (L4P_CALL *L4P_GameUiChangeFn)(void*, uint32_t row_id, int32_t value);
typedef void (L4P_CALL *L4P_GameUiVisibilityFn)(void*, uint32_t open);

/* Settings start at page 0. Link rows use their destination page ID.
 * Pages are copied on open/navigation/change, never rebuilt by drawing.
 * Use page=null and change(id=0,value=0) to open a custom settings UI.
 * A standard action may enter a custom editor by returning L4P_MENU_CLOSE.
 * Frame (optional) runs on the primary Paint pass (GAME in play, UI in menus);
 * begin_draw opens a shared surface
 * context on demand. Input (optional) receives game-window messages. A true
 * return takes ownership of that key press; the host pairs its key-up.
 * visibility describes the standard page; use it to commit a pending save or
 * leave a custom editor before entering the standard page.
 * Callbacks run on the game-window/Paint thread. Register/unregister from
 * plugin init/shutdown, never from callbacks. The host copies id and title.
 */
typedef struct L4P_GameUiModuleV1 {
    uint32_t struct_size;
    const char* id;
    const wchar_t* title;
    void* context;
    L4P_GameUiFrameFn frame;
    L4P_GameUiInputFn input;
    L4P_GameUiPageFn page;
    L4P_GameUiChangeFn change;
    L4P_GameUiVisibilityFn visibility;
} L4P_GameUiModuleV1;

typedef struct L4P_GameUiApiV1 {
    uint32_t api_version, struct_size;
    uint32_t (L4P_CALL *register_module)(const L4P_GameUiModuleV1*, uint32_t* token);
    uint32_t (L4P_CALL *unregister_module)(uint32_t token);
    uint32_t (L4P_CALL *begin_draw)(void);
} L4P_GameUiApiV1;
typedef uint32_t (L4P_CALL *L4P_GetGameUiApiFn)(uint32_t, L4P_GameUiApiV1*);
#pragma pack(pop)

#ifdef __cplusplus
}
#endif
#endif
