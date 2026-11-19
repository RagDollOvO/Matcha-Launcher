#ifndef L4P_INPUT_H
#define L4P_INPUT_H
#include "l4p_source.h"
#ifdef __cplusplus
extern "C" {
#endif
#define L4P_INPUT_CONFLICT 5u
#define L4P_INPUT_SCOPE 6u
#define L4P_INPUT_MISSING 7u
#define L4P_INPUT_HELD 9u
#define L4P_INPUT_NOT_HELD 10u
#pragma pack(push,8)
/* Owned bound-key edges for local gameplay. Only +reload/+attack/+attack2 are
 * accepted. Lookup uses the engine's current binding; no bind is rewritten.
 * Press requires Paint, a LOCAL subscription, the game's foreground process,
 * and a closed game UI. Keyboard edges use scan codes, mouse binds use their
 * native button. An already-held key returns HELD without synthesizing input.
 * One down per subscription; another owner of the same key returns CONFLICT.
 * Release uses the captured key even after a rebind. Control-thread release and
 * unsubscribe immediately release owned input under the service lock. Scope/UI/
 * focus exit releases at the next Paint; failed releases remain for retry.
 */
typedef struct L4P_InputStateV1 {
    uint32_t struct_size,foreground,game_ui,owned,presses,failures;
} L4P_InputStateV1;
typedef struct L4P_BindingV1 {
    uint32_t struct_size;char key[32];uint32_t held;
} L4P_BindingV1;
typedef struct L4P_InputApiV1 {
    uint32_t api_version,struct_size;
    uint32_t (L4P_CALL *snapshot)(L4P_InputStateV1*);
    uint32_t (L4P_CALL *binding)(const char* command,L4P_BindingV1*);
    uint32_t (L4P_CALL *press)(uint32_t subscription,const char* command);
    uint32_t (L4P_CALL *release)(uint32_t subscription);
} L4P_InputApiV1;
/* API 2 retains the entire API 1 prefix. A LOCAL Paint subscription may watch
 * physical left-button edges. A dedicated message-pump thread ignores injected
 * events and always chains the hook. It exists only while there are watchers.
 * watch_mouse(token,0), release and unsubscribe also allow the control thread.
 * mouse_edge(token,0) begins a release window; mouse_edge(token,1) ends it
 * only while the physical button is still held and foreground/UI/scope allow it.
 * An existing input owner of MOUSE1 excludes a pulse for its whole cycle.
 * Release during a physical hold hands ownership back without cancelling that
 * hold; release during an up window sends nothing. Every synthetic DOWN is
 * rechecked. Neither the callback nor its thread calls engine APIs.
 */
typedef struct L4P_MouseStateV1 {
    uint32_t struct_size,watching,hook_state,physical_down,physical_events,phase,last_error;
    /* hook_state: 0 idle, 1 starting, 2 ready, 3 failed, 4 stopping.
     * phase: 0 no owned pulse, 1 release window, 2 synthetic down. */
} L4P_MouseStateV1;
typedef struct L4P_InputApiV2 {
    L4P_InputApiV1 base;
    uint32_t (L4P_CALL *watch_mouse)(uint32_t subscription,uint32_t enabled);
    uint32_t (L4P_CALL *mouse_state)(uint32_t subscription,L4P_MouseStateV1*);
    uint32_t (L4P_CALL *mouse_edge)(uint32_t subscription,uint32_t down);
} L4P_InputApiV2;
typedef uint32_t (L4P_CALL *L4P_GetInputApiFn)(uint32_t,L4P_InputApiV1*);
L4P_EXPORT uint32_t L4P_CALL L4P_GetInputApi(uint32_t,L4P_InputApiV1*);
#pragma pack(pop)
#ifdef __cplusplus
}
#endif
#endif
