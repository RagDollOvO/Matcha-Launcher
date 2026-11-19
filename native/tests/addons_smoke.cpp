#define NOMINMAX
#include <windows.h>
#include "l4p_addons.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <vector>
#include <thread>
namespace fs=std::filesystem;using nlohmann::json;
extern "C" int __cdecl FixtureCatchNative(void(__cdecl*)(void*),void*);
void require(bool ok,const char* why){if(!ok)throw std::runtime_error(why);}
void L4P_CALL log(void*,uint32_t,const char*){}
template<class T>T symbol(HMODULE h,const char* name){auto fn=reinterpret_cast<T>(GetProcAddress(h,name));require(fn,name);return fn;}
int frames=0;void L4P_CALL frame(void*,const L4P_SourceFrameV1*){++frames;}
int wmain(int argc,wchar_t** argv){try{
    require(argc==5,"addons_smoke <dist plugins> <fixture directory> <fresh root> normal|unsupported");fs::path dist=fs::absolute(argv[1]),fake=fs::absolute(argv[2]),root=fs::absolute(argv[3]);require(!fs::exists(root),"fresh root");
    auto loadDll=[](const fs::path& path){auto m=LoadLibraryExW(path.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(m,"load DLL");return m;};
    auto engine=loadDll(fake/L"engine.dll"),client=loadDll(fake/L"client.dll");auto paint=symbol<void(__cdecl*)()>(engine,"FixturePaint");auto mode=symbol<void(__cdecl*)(int)>(engine,"FixtureMode");
    auto set=symbol<void(__cdecl*)(int,uint32_t,const int*,int)>(client,"FixtureAddonSet");auto update=symbol<void(__cdecl*)(void*)>(client,"FixtureAddonInvoke");auto seen=symbol<uint32_t(__cdecl*)()>(client,"FixtureAddonSeen");auto received=symbol<uint32_t(__cdecl*)()>(client,"FixtureAddonReceived");auto mutate=symbol<void(__cdecl*)(int,int)>(client,"FixtureAddonMutate");auto byte=symbol<int(__cdecl*)(int)>(client,"FixtureAddonByte");
    auto load=[&](const wchar_t* id){auto directory=root/L"bin/l4p/plugins"/id;fs::create_directories(directory);fs::copy_file(dist/id/L"plugin.dll",directory/L"plugin.dll");auto module=loadDll(directory/L"plugin.dll");L4P_PluginApiV1 api{1,sizeof(api)};require(symbol<L4P_GetPluginApiFn>(module,"L4P_GetPluginApi")(1,&api)==L4P_OK,"plugin API");return std::make_pair(module,api);};
    bool unsupported=!wcscmp(argv[4],L"unsupported");if(unsupported)mutate(0xfb,0x90);
    auto bridge=load(L"beacon.source");std::string directory=(root/L"bin/l4p/plugins/beacon.source").u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,directory.c_str(),"{}"};require(bridge.second.init(&host)==L4P_OK,"Source init");L4P_SourceApiV1 source{1,sizeof(source)};symbol<L4P_GetSourceApiFn>(bridge.first,"L4P_GetSourceApi")(1,&source);uint32_t token=0;source.subscribe("fixture.addons",0,"",nullptr,frame,nullptr,&token);
    mode(1);for(int i=0;i<100&&!frames;++i){Sleep(20);paint();}require(frames,"Source Paint connected");L4P_AddonApiV1 addons{1,sizeof(addons)};require(symbol<L4P_GetAddonApiFn>(bridge.first,"L4P_GetAddonApi")(1,&addons)==L4P_OK,"Addon API");auto status=[&](){L4P_AddonStatusV1 value{sizeof(value)};require(addons.status(&value)==L4P_OK,"status");return value;};
    auto plugin=load(L"skeeto.hide-back-items");directory=(root/L"bin/l4p/plugins/skeeto.hide-back-items").u8string();host.plugin_directory=directory.c_str();require(plugin.second.init(&host)==L4P_OK,"feature init");
    const int ids[]={15,12,13,1,23};set(2,255,ids,0);paint();update(nullptr);require(seen()==255&&received()==255&&!status().filters,"all defaults keep display");
    std::vector<char> output(65536);uint32_t size=0;auto configure=[&](const json& params){auto text=params.dump();return plugin.second.invoke("configure",text.c_str(),output.data(),output.size(),&size);};
    configure({{"medicine",true}});paint();
    if(unsupported){require(status().state==3,"internal mask opcode rejection");update(nullptr);require(seen()==255&&received()==255&&byte(0)==0x55,"unsupported untouched");plugin.second.shutdown();bridge.second.shutdown();std::cout<<"PASS: Addon unsupported layout preserved\n";return 0;}
    require(status().state==2&&status().matched_signatures==1,"native hook installed");update(nullptr);require(seen()==0xee&&received()==255,"medicine filter and restore");
    configure({{"medicine",false},{"medical",true}});paint();update(nullptr);require(seen()==0xbd&&received()==255,"medical and slot6");
    configure({{"medical",false},{"throwables",true}});paint();update(nullptr);require(seen()==0xfb,"throwable category");
    configure({{"throwables",false},{"tongue",true}});paint();update(nullptr);require(seen()==0xdf,"tongue slot");
    configure({{"medicine",true},{"medical",true},{"throwables",true}});paint();update(nullptr);require(seen()==0x88&&received()==255,"all categories unknown and diesel kept");
    const int alternate[]={23,24,14,25,123};set(2,255,alternate,0);update(nullptr);require(seen()==0x90&&received()==255,"remaining original weapon IDs");set(3,255,ids,0);update(nullptr);require(seen()==0xdf,"infected only tongue");set(1,255,ids,0);update(nullptr);require(seen()==255,"other teams preserved");
    set(2,255,ids,0);std::thread other([&](){update(nullptr);});other.join();require(seen()==255&&status().wrong_thread==1,"foreign thread bypass");
    for(int fault=1;fault<=2;++fault){set(2,255,ids,fault);require(FixtureCatchNative(update,nullptr)==1,"native fault reaches outer game handler");require(seen()==0x88&&received()==255,"SEH finally restores actual mask");}set(2,255,ids,0);update(nullptr);require(seen()==0x88&&received()==255,"service survives handled native fault");
    require(configure({{"medicine",5}})==L4P_BAD_ARGUMENT,"typed settings");char tiny='!';require(plugin.second.invoke("configure","{\"active\":false}",&tiny,1,&size)==L4P_BUFFER_TOO_SMALL,"capacity before write");paint();update(nullptr);require(seen()==0x88,"tiny output kept active");
    configure({{"active",false}});paint();require(status().state==0&&byte(0)==0x55,"off restores entry");update(nullptr);require(seen()==255,"off native recreation");
    configure({{"active",true}});mode(2);paint();update(nullptr);require(seen()==0x88,"cosmetic remote");mode(0);paint();update(nullptr);require(seen()==255&&byte(0)==0x55,"disconnect removes entry");mode(1);paint();update(nullptr);require(seen()==0x88,"reconnect reinstalls");
    mutate(5,0x90);paint();require(status().state==5,"foreign entry diagnostic");update(nullptr);require(seen()==255&&received()==255,"foreign entry pass-through");plugin.second.shutdown();paint();require(byte(5)==0x90&&!status().filters,"foreign byte retained on shutdown");source.unsubscribe(token);bridge.second.shutdown();paint();
    std::cout<<"PASS: native addon entry, four categories, original-mask restoration (normal + SEH unwind), scope/thread gates, ownership and settings\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
