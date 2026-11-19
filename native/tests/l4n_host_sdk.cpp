// Offline L4N SDK consumer, built with the host's Microsoft x86 C++ ABI.
#include "l4n_plugin.h"
extern "C" int verify_sdk(GetL4NPluginInstanceFunc get) {
    auto* p=get();
    if(!p || p->GetInterfaceVersion()!=2 || p->GetName()[0]!='M' || p->GetVersion()[0]!='0') return 2;
    p->OnGameLaunch(); p->OnD3DCreated(nullptr);
    return p->RequestHudMenu(true)==nullptr?0:3;
}
