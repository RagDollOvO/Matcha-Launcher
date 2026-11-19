#define NOMINMAX
#include <windows.h>
#include "l4p_source.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <vector>
#include <stdexcept>
using nlohmann::json;namespace fs=std::filesystem;
static void require(bool value,const char* why){if(!value)throw std::runtime_error(why);}
static void L4P_CALL log(void*,uint32_t,const char*){}
static int allEvents=0,localEvents=0,frames=0;
static void L4P_CALL frame(void*,const L4P_SourceFrameV1* f){require(f->game_thread==GetCurrentThreadId(),"frame thread");++frames;}
static void L4P_CALL event(void* p,const L4P_SourceFrameV1*,const char*,void*){++*static_cast<int*>(p);}
int wmain(int argc,wchar_t** argv){try{
    require(argc==5,"source_smoke <bridge> <cfg plugin> <fake engine> <new fixture game>");
    fs::path root=fs::absolute(argv[4]);require(!fs::exists(root),"fresh fixture required");
    auto plugins=root/L"bin/l4p/plugins";auto a=plugins/L"beacon.source";auto b=plugins/L"skeeto.config-override";
    fs::create_directories(a);fs::create_directories(b);fs::create_directories(root/L"left4dead2/cfg");
    fs::copy_file(argv[1],a/L"plugin.dll");fs::copy_file(argv[2],b/L"plugin.dll");std::ofstream(root/L"left4dead2/cfg/autoexec.cfg")<<"echo fixture\n";
    auto engine=LoadLibraryExW(fs::absolute(argv[3]).c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(engine,"fake engine");
    auto paint=reinterpret_cast<void(__cdecl*)()>(GetProcAddress(engine,"FixturePaint"));auto mode=reinterpret_cast<void(__cdecl*)(int)>(GetProcAddress(engine,"FixtureMode"));auto fire=reinterpret_cast<void(__cdecl*)(const char*)>(GetProcAddress(engine,"FixtureEvent"));auto count=reinterpret_cast<int(__cdecl*)()>(GetProcAddress(engine,"FixtureCommands"));auto last=reinterpret_cast<const char*(__cdecl*)()>(GetProcAddress(engine,"FixtureLastCommand"));require(paint&&mode&&fire&&count&&last,"fixture exports");
    auto load=[&](const fs::path& dir){auto module=LoadLibraryExW((dir/L"plugin.dll").c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(module,"load plugin");L4P_PluginApiV1 api{1,sizeof(api)};auto get=reinterpret_cast<L4P_GetPluginApiFn>(GetProcAddress(module,"L4P_GetPluginApi"));require(get&&get(1,&api)==L4P_OK,"API");return std::make_pair(module,api);};
    auto bridge=load(a);std::string adir=a.u8string(),bdir=b.u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,adir.c_str(),"{}"};require(bridge.second.init(&host)==L4P_OK,"bridge init");
    L4P_SourceApiV1 sdk{1,sizeof(sdk)};auto get=reinterpret_cast<L4P_GetSourceApiFn>(GetProcAddress(bridge.first,"L4P_GetSourceApi"));require(get&&get(1,&sdk)==L4P_OK,"source API");
    uint32_t any=0,local=0;require(sdk.subscribe("test.any",0,"player_hurt",&allEvents,frame,event,&any)==L4P_OK,"subscribe any");require(sdk.subscribe("test.local",1,"player_hurt",&localEvents,nullptr,event,&local)==L4P_OK,"subscribe local");
    for(int i=0;i<100&&frames==0;++i){Sleep(20);paint();}require(frames>0,"Paint hook did not connect");
    mode(1);paint();fire("player_hurt");require(allEvents==1&&localEvents==1,"local event dispatch");
    mode(2);fire("player_hurt");require(allEvents==2&&localEvents==1,"remote transition gate");
    require(sdk.exec_cfg("autoexec.cfg")==L4P_BAD_ARGUMENT,"control thread command accepted");
    require(sdk.unsubscribe(any)==L4P_OK,"unsubscribe");fire("player_hurt");require(allEvents==2,"event after unsubscribe");
    auto cfg=load(b);host.plugin_directory=bdir.c_str();host.config_json="{\"file\":\"autoexec.cfg\",\"automatic\":true}";require(cfg.second.init(&host)==L4P_OK,"cfg init");
    mode(3);paint();require(count()==0,"exec during loading");mode(1);paint();require(count()==1&&!strcmp(last(),"exec autoexec.cfg"),"chapter exec");paint();require(count()==1,"repeated frame exec");
    std::vector<char> output(256*1024);uint32_t size=0;char tiny='!';require(cfg.second.invoke("apply","{}",&tiny,1,&size)==L4P_BUFFER_TOO_SMALL,"tiny buffer");paint();require(count()==1,"tiny buffer side effect");
    require(cfg.second.invoke("configure","{\"file\":\"../bad.cfg\",\"automatic\":true}",output.data(),output.size(),&size)==L4P_BAD_ARGUMENT,"traversal accepted");
    require(cfg.second.invoke("configure","{\"file\":\"autoexec.cfg\",\"automatic\":false}",output.data(),output.size(),&size)==L4P_OK,"save config");require(fs::exists(b/L"config.json"),"config persistence");
    mode(0);paint();mode(1);paint();require(count()==1,"automatic off");require(cfg.second.invoke("apply","{}",output.data(),output.size(),&size)==L4P_OK,"manual queue");paint();require(count()==2,"manual game-thread execution");
    cfg.second.shutdown();paint();require(count()==2,"callback after cfg shutdown");sdk.unsubscribe(local);bridge.second.shutdown();int oldFrames=frames;paint();fire("player_hurt");require(frames==oldFrames,"callback after bridge shutdown");
    std::cout<<"PASS: Source game-thread bridge, native event ABI, scope transition, unsubscribe, CFG queue/persistence/lifecycle\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
