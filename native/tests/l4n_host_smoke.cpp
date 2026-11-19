#include "common.hpp"
#include <iostream>
extern "C" int verify_sdk(void*);
int wmain(int argc, wchar_t** argv) {
    if(argc!=2) return 1;
    auto dll=l4p::load(argv[1]); if(!dll) return 10;
    auto get=GetProcAddress(dll,"GetL4NPluginInstance"); if(!get) return 11;
    int v=verify_sdk(reinterpret_cast<void*>(get)); if(v) return v;
    auto rt=GetModuleHandleW(L"l4p_runtime.dll"); if(!rt) return 12;
    auto pipe=L"\\\\.\\pipe\\l4p."+std::to_wstring(GetCurrentProcessId());
    if(!WaitNamedPipeW(pipe.c_str(),2500)) return 13;
    auto shut=reinterpret_cast<void(__cdecl*)()>(GetProcAddress(rt,"L4P_RuntimeShutdown"));
    if(shut) shut();
    std::cout<<"L4N SDK callbacks: Matcha Runtime connected; no game or renderer loaded.\n";
}
