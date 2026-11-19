#define NOMINMAX
#include <windows.h>
#include "l4p_feedback.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
using nlohmann::json;namespace fs=std::filesystem;
void need(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
template<class T>T sym(HMODULE dll,const char* name){auto fn=reinterpret_cast<T>(GetProcAddress(dll,name));need(fn,name);return fn;}
void L4P_CALL log(void*,uint32_t,const char*){}
HMODULE load(const fs::path& path){auto dll=LoadLibraryExW(fs::absolute(path).c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);need(dll,"DLL load");return dll;}
L4P_PluginApiV1 plugin(const fs::path& dir,const char* config){auto dll=load(dir/L"plugin.dll");L4P_PluginApiV1 api{1,sizeof(api)};need(!sym<L4P_GetPluginApiFn>(dll,"L4P_GetPluginApi")(1,&api),"Plugin API");auto text=dir.u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,text.c_str(),config};need(!api.init(&host),"plugin init");return api;}
json invoke(L4P_PluginApiV1& api,const char* action,const char* args="{}"){char out[65536]{};uint32_t size=0;need(!api.invoke(action,args,out,sizeof(out),&size),action);return json::parse(out);}
int wmain(int argc,wchar_t** argv){try{
    need(argc==4,"feedback_smoke <dist plugins> <source fixtures> <fresh root>");auto root=fs::absolute(argv[3]);need(!fs::exists(root),"fresh root");auto packages=root/L"bin/l4p/plugins";fs::create_directories(packages);
    for(auto id:{L"beacon.source",L"skeeto.hit-feedback"})fs::copy(fs::path(argv[1])/id,packages/id,fs::copy_options::recursive);
    auto engine=load(fs::path(argv[2])/L"engine.dll"),client=load(fs::path(argv[2])/L"client.dll"),files=load(fs::path(argv[2])/L"filesystem_stdio.dll"),cvars=load(fs::path(argv[2])/L"vstdlib.dll");
    auto paint=sym<void(__cdecl*)()>(engine,"FixturePaint");auto mode=sym<void(__cdecl*)(int)>(engine,"FixtureMode");auto event=sym<void(__cdecl*)(const char*)>(engine,"FixtureEvent");auto number=sym<void(__cdecl*)(const char*,int)>(engine,"FixtureEventInt");
    auto last=sym<const char*(__cdecl*)()>(engine,"FixtureLastCommand");auto flags=sym<int(__cdecl*)(const char*)>(cvars,"FixtureFlags");sym<void(__cdecl*)(const char*,float,int)>(cvars,"FixtureSet")("r_screenoverlay",0,1<<14);
    auto add=sym<void(__cdecl*)(const char*,const void*,unsigned,int)>(files,"FixtureFsAdd");const char ci[]=R"({"id":"smoke","channel":"ci","kill":{"overlay":"fixture/kill"},"hit":{"overlay":"fixture/hit"}})";const char si[]=R"({"id":"smoke-si","channel":"si","hit":{"overlay":"fixture/si"}})";
    add("skeeto/skeeto_smoke.json",ci,sizeof(ci)-1,0);add("skeeto/skeeto_smoke-si.json",si,sizeof(si)-1,0);
    auto bridge=plugin(packages/L"beacon.source","{}");auto feature=plugin(packages/L"skeeto.hit-feedback",R"({"icon":true,"ci-style":"smoke","si-style":"smoke-si","si-visual":true,"hit-mode":1})");
    for(int i=0;i<80;++i){paint();if(invoke(feature,"styles")["sections"][0]["items"].size())break;Sleep(25);}
    need(invoke(feature,"styles")["sections"][0]["items"].size()==1,"style catalog through SDK");
    mode(1);sym<void(__cdecl*)(int,int,int,int,uint32_t,float)>(client,"FixtureInfected")(2,0,0,1,2,1000);paint();
    number("attacker",7);number("userid",8);event("infected_death");paint();need(!strcmp(last(),"r_screenoverlay \"fixture/kill\""),"CI kill overlay");need(!(flags("r_screenoverlay")&(1<<14)),"owned overlay flags");
    Sleep(260);paint();paint();paint();need(!strcmp(last(),"r_screenoverlay \"\""),"overlay clears");need(flags("r_screenoverlay")==1<<14,"overlay flags restored");
    Sleep(4000);paint();number("userid",7);event("bullet_impact");sym<void(__cdecl*)(int,int)>(client,"FixtureHealthDrop")(2,90);paint();need(!strcmp(last(),"r_screenoverlay \"fixture/si\""),"received HP hit attribution");
    invoke(feature,"configure",R"({"active":false})");paint();paint();paint();need(!sym<int(__cdecl*)()>(client,"FixtureHealthHooked")(),"independent health stop");
    json saved;std::ifstream(packages/L"skeeto.hit-feedback/config.json")>>saved;need(saved["active"]==false&&saved["ci-style"]=="smoke","configuration preserved");
    feature.shutdown();bridge.shutdown();paint();std::cout<<"PASS: catalog, actual feedback DLL, kill/HP-hit overlays, independent disable and saved settings\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
