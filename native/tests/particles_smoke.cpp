#define NOMINMAX
#include <windows.h>
#include "l4p_particle.h"
#include <filesystem>
#include <iostream>
#include <stdexcept>
namespace fs=std::filesystem;
void need(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
template<class T>T sym(HMODULE m,const char* name){auto p=reinterpret_cast<T>(GetProcAddress(m,name));need(p,name);return p;}
void L4P_CALL log(void*,uint32_t,const char*){}
L4P_ParticleApiV1 api{1,sizeof(api)};uint32_t token=0,code=0,present=0;int frames=0,operation=0;
void L4P_CALL frame(void*,const L4P_SourceFrameV1*){++frames;float xyz[]={10,20,30};if(operation==1)code=api.precache(token,"fixture_hit");if(operation==2)code=api.dispatch(token,"fixture_hit",xyz,1);if(operation==3)code=api.exists(token,"fixture_hit",&present);}
int wmain(int argc,wchar_t** argv){try{
    need(argc==5,"particles_smoke <Source DLL> <source fixtures> <particle fixture> <fresh root>");auto root=fs::absolute(argv[4]);need(!fs::exists(root),"fresh root");fs::create_directories(root);
    auto load=[](const fs::path& path){auto m=LoadLibraryExW(fs::absolute(path).c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);need(m,"DLL load");return m;};
    auto engine=load(fs::path(argv[2])/L"engine.dll"),files=load(fs::path(argv[2])/L"filesystem_stdio.dll"),client=load(argv[3]);
    auto paint=sym<void(__cdecl*)()>(engine,"FixturePaint");sym<void(__cdecl*)(int)>(engine,"FixtureMode")(1);
    sym<void(__cdecl*)(const char*,const void*,unsigned,int)>(files,"FixtureFsAdd")("particles/skeeto_fixture.txt","manifest",8,0);
    auto build=sym<void(__cdecl*)()>(client,"FixtureParticleBuild");auto count=sym<int(__cdecl*)(int)>(client,"FixtureParticleCount");
    fs::copy_file(argv[1],root/L"plugin.dll");auto dll=load(root/L"plugin.dll");L4P_PluginApiV1 plugin{1,sizeof(plugin)};sym<L4P_GetPluginApiFn>(dll,"L4P_GetPluginApi")(1,&plugin);
    auto dir=root.u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,dir.c_str(),"{}"};need(!plugin.init(&host),"Source init");
    L4P_SourceApiV1 source{1,sizeof(source)};sym<L4P_GetSourceApiFn>(dll,"L4P_GetSourceApi")(1,&source);need(!sym<L4P_GetParticleApiFn>(dll,"L4P_GetParticleApi")(1,&api),"Particle API");
    need(!source.subscribe("fixture.particles",0,"",nullptr,frame,nullptr,&token),"subscribe");need(!api.boot_manifests(token,"skeeto_",32),"enable manifests");
    L4P_ParticleStatusV1 state{sizeof(state)};for(int i=0;i<100;++i){Sleep(20);paint();api.status(token,&state);if(frames&&state.manifest==2)break;}
    need(frames&&state.manifest==2,"manifest hook ready");build();need(count(0)==1&&count(1)==1,"base then own manifest");
    operation=1;paint();need(!code&&count(2)==1,"native precache");operation=3;paint();need(!code&&present,"native lookup");
    operation=2;paint();need(!code&&count(3)==1&&!count(4),"native dispatch ABI");operation=0;
    need(!api.release_manifests(token),"disable manifests");build();need(count(0)==2&&count(1)==1,"disabled transparent original");source.unsubscribe(token);plugin.shutdown();
    std::cout<<"PASS: particle SDK load, startup manifest append, precache/lookup/dispatch and independent release\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
