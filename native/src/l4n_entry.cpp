// The L4N SDK exposes a Microsoft x86 C++ interface. Keep the ABI boundary here.
#include "l4n_plugin.h"
extern "C" void matcha_game_ready();
extern "C" void matcha_render_ready();
class Bridge final : public IL4NPlugin {
public:
    static void operator delete(void*) noexcept {} // singleton, owned for the process lifetime
    static void* operator new(decltype(sizeof(0)), void* storage) noexcept { return storage; }
    const char* GetName() override { return "Matcha Runtime"; }
    const char* GetVersion() override { return "0.4.0"; }
    void OnGameLaunch() override { matcha_game_ready(); }
    void OnD3DCreated(void*) override { matcha_render_ready(); }
};
#ifdef MATCHA_ABI_ONLY
// This isolated MS-ABI TU contains only the static interface singleton.
void operator delete(void*, decltype(sizeof(0))) noexcept {}
#endif
extern "C" IL4NPlugin* matcha_instance() {
    alignas(Bridge) static unsigned char storage[sizeof(Bridge)];
    return new (storage) Bridge;
}
