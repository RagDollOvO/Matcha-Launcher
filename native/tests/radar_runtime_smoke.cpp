#define NOMINMAX
#include <windows.h>
#include "l4p_runtime.h"
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>

namespace fs=std::filesystem;
void require(bool ok,const char* why){if(!ok)throw std::runtime_error(why);}
template<class T> T api(HMODULE dll,const char* name){
    auto f=reinterpret_cast<T>(GetProcAddress(dll,name));require(f,name);return f;
}
int wmain(int argc,wchar_t** argv){try{
    require(argc==4,"radar_runtime_smoke <platform-root> <empty|enabled|settings> <preview-path>");
    fs::path root=fs::canonical(argv[1]);
    std::wstring mode=argv[2];
    auto runtime=LoadLibraryExW((root/L"l4p_runtime.dll").c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);
    require(runtime,"offline runtime fixture missing");
    auto init=api<L4P_RuntimeInitializeFn>(runtime,"L4P_RuntimeInitialize");
    auto stop=api<L4P_RuntimeShutdownFn>(runtime,"L4P_RuntimeShutdown");
    require(init(root.c_str())==0,"runtime init failed");
    auto service=GetModuleHandleW((root/L"plugins/flare.game-ui/plugin.dll").c_str());
    auto radar=GetModuleHandleW((root/L"plugins/ragdoll.supply-radar/plugin.dll").c_str());
    if(mode==L"empty")require(!service&&!radar,"a disabled module was mapped");
    else {
        require(service&&radar,"selected module or dependency missing");
        std::ifstream recorded(root/L"logs"/(L"runtime-"+std::to_wstring(GetCurrentProcessId())+L".jsonl"));
        std::string line;bool initialized=false;
        while(std::getline(recorded,line))if(line.find("ragdoll.supply-radar")!=std::string::npos&&
            line.find("Plugin initialized")!=std::string::npos)initialized=true;
        require(initialized,"real radar did not register through the SDK");
        if(mode==L"settings"){
            auto result=api<unsigned(__cdecl*)(const wchar_t*)>(service,"FixtureRadarSettings")(argv[3]);
            if(result)std::cerr<<"Settings step "<<result<<" failed\n";
            require(!result,"settings interaction/preview");
            auto ini=root/L"data/ragdoll.supply-radar/settings.ini";
            require(GetPrivateProfileIntW(L"SupplyRadar",L"IconOpacity",0,ini.c_str())==50,"game setting did not persist");
            require(GetPrivateProfileIntW(L"Item33",L"Y",0,ini.c_str())==3100,"existing layout changed");
        }
    }
    stop();
    std::wcout<<L"Radar offline "<<mode<<L": OK\n";
    return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
