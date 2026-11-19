#define NOMINMAX
#include <windows.h>
#include "l4p_input.h"
#include "l4p_weapon.h"
#include "owned_input.hpp"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <iostream>
#include <stdexcept>
using nlohmann::json;namespace fs=std::filesystem;
void require(bool ok,const char* why){if(!ok)throw std::runtime_error(why);}
template<class T>T sym(HMODULE h,const char* name){auto p=reinterpret_cast<T>(GetProcAddress(h,name));require(p,name);return p;}
void L4P_CALL log(void*,uint32_t,const char*){}
DWORD now=1000;DWORD WINAPI clockValue(){return now;}
int frames=0,probeCapacity=0,capacity=99;uint32_t probe=0,capacityCode=0;
L4P_EntityApiV1 entities{1,sizeof(entities)};L4P_WeaponApiV1 weapons{1,sizeof(weapons)};
void L4P_CALL frame(void*,const L4P_SourceFrameV1*){++frames;if(probeCapacity){L4P_EntityRefV1 ref{};entities.reference(65,&ref);capacityCode=weapons.clip_capacity(probe,&ref,&capacity);}}
int wmain(int argc,wchar_t** argv){try{
    require(argc==6,"reload_smoke <Source DLL> <feature DLL> <engine/weapon fixtures dir> <fresh root> <normal|unsupported|fault-memory>");
    bool unsupported=!wcscmp(argv[5],L"unsupported"),faultMemory=!wcscmp(argv[5],L"fault-memory");fs::path root=fs::absolute(argv[4]);require(!fs::exists(root),"fresh root");
    for(auto id:{L"beacon.source",L"skeeto.auto-reload"})fs::create_directories(root/id);fs::copy_file(argv[1],root/L"beacon.source/plugin.dll");fs::copy_file(argv[2],root/L"skeeto.auto-reload/plugin.dll");
    auto load=[](fs::path p){auto h=LoadLibraryExW(fs::absolute(p).c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(h,"DLL load");return h;};
    auto engine=load(fs::path(argv[3])/L"engine.dll"),client=load(fs::path(argv[3])/L"client.dll"),module=load(root/L"beacon.source/plugin.dll");owned_input::isolate(module);require(owned_input::replace(module,"GetTickCount",reinterpret_cast<void*>(&clockValue)),"isolated clock");
    auto paint=sym<void(__cdecl*)()>(engine,"FixturePaint");auto mode=sym<void(__cdecl*)(int)>(engine,"FixtureMode");auto view=sym<void(__cdecl*)(int,float,float,float)>(engine,"FixtureView");auto bind=sym<void(__cdecl*)(const char*,const char*)>(engine,"FixtureBinding");
    auto weapon=sym<void(__cdecl*)(const char*,int,int,unsigned)>(client,"FixtureWeapon");auto limits=sym<void(__cdecl*)(int,int)>(client,"FixtureCapacity");auto times=sym<void(__cdecl*)(float,float)>(client,"FixtureWeaponTimes");auto player=sym<void(__cdecl*)(int,int,int,unsigned)>(client,"FixturePlayer");auto calls=sym<int(__cdecl*)()>(client,"FixtureCapacityCalls");
    if(unsupported)sym<void(__cdecl*)()>(client,"FixtureCapacityVariant")();mode(1);weapon("CPumpShotgun",7,0,1);limits(8,faultMemory?2:0);
    L4P_PluginApiV1 service{1,sizeof(service)},feature{1,sizeof(feature)};sym<L4P_GetPluginApiFn>(module,"L4P_GetPluginApi")(1,&service);auto dir=(root/L"beacon.source").u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,dir.c_str(),"{}"};require(!service.init(&host),"Source init");
    L4P_SourceApiV1 source{1,sizeof(source)};sym<L4P_GetSourceApiFn>(module,"L4P_GetSourceApi")(1,&source);require(!sym<L4P_GetEntityApiFn>(module,"L4P_GetEntityApi")(1,&entities),"entity API");require(!sym<L4P_GetWeaponApiFn>(module,"L4P_GetWeaponApi")(1,&weapons),"weapon API");source.subscribe("fixture.reload",1,"",nullptr,frame,nullptr,&probe);
    for(int i=0;i<100&&!frames;++i){Sleep(20);paint();}require(frames,"Paint");probeCapacity=1;paint();probeCapacity=0;uint32_t status=0;weapons.status(&status);
    if(unsupported||faultMemory){require(capacityCode==L4P_ENTITY_MISSING&&capacity==99&&status==(unsupported?2u:3u),"unsupported/fault preserves output and state");auto before=calls();probeCapacity=1;paint();probeCapacity=0;require(calls()==before,"unsupported/fault stops native lookup");}
    else require(!capacityCode&&capacity==8&&status==1,"exact native lookup and script ABI");
    auto fmodule=load(root/L"skeeto.auto-reload/plugin.dll");sym<L4P_GetPluginApiFn>(fmodule,"L4P_GetPluginApi")(1,&feature);dir=(root/L"skeeto.auto-reload").u8string();host.plugin_directory=dir.c_str();require(!feature.init(&host),"feature init");paint();
    char output[8192]{};uint32_t size=0;auto invoke=[&](const char* action,const json& args=json::object()){auto text=args.dump();require(!feature.invoke(action,text.c_str(),output,sizeof(output),&size),action);return json::parse(output);};
    auto tick=[&](DWORD amount){now+=amount;paint();};auto configure=[&](json args){invoke("configure",args);paint();};auto stop=[&]{configure({{"active",false}});};auto start=[&](bool pump=true,bool automatic=true){configure({{"active",true},{"pump",pump},{"auto",automatic}});};
    using namespace owned_input;
    auto attempt=[&](bool expected){stop();size_t before=events.size();start();tick(200);require((events.size()==before+1)==expected,"reload eligibility");if(expected){require(!(events.back().type==INPUT_KEYBOARD&&(events.back().ki.dwFlags&KEYEVENTF_KEYUP)),"press before release");tick(24);require(events.size()==before+2,"24 ms release");}};
    require(events.empty(),"disabled categories silent");
    if(unsupported||faultMemory){attempt(true);weapon("CPumpShotgun",8,0,1);attempt(false);stop();feature.shutdown();source.unsubscribe(probe);service.shutdown();std::cout<<"PASS: "<<(unsupported?"unsupported signatures":"native PAGE_NOACCESS")<<" preserve vanilla reload fallback, output and disabled lookup\n";return 0;}
    start();tick(199);require(events.empty(),"initial wait");tick(1);require(events.size()==1,"initial edge");DWORD first=now;tick(23);require(events.size()==1,"held at 23 ms");tick(1);require(events.size()==2&&(events.back().ki.dwFlags&KEYEVENTF_KEYUP),"release at 24 ms");
    while(events.size()==2&&now-first<=301)tick(1);require(events.size()==3&&now-first>=200&&now-first<=300,"200-300 ms cadence");stop();size_t before=events.size();tick(600);require(events.size()==before,"closed quiet");
    for(auto name:{"CPumpShotgun","CShotgun_Chrome","CAutoShotgun","CShotgun_SPAS"}){weapon(name,3,0,1);attempt(true);}
    weapon("CRifle",3,0,1);attempt(false);weapon("CPumpShotgun",3,0,1);stop();before=events.size();start(false,true);tick(200);require(events.size()==before,"pump switch independent");weapon("CAutoShotgun",3,0,1);stop();before=events.size();start(true,false);tick(200);require(events.size()==before,"auto switch independent");
    weapon("CPumpShotgun",8,0,1);limits(12,0);attempt(true);weapon("CPumpShotgun",12,0,1);attempt(false);limits(0,0);weapon("CPumpShotgun",8,0,1);attempt(false);weapon("CPumpShotgun",7,0,1);attempt(true);limits(8,0);
    weapon("CPumpShotgun",3,1,1);attempt(false);weapon("CPumpShotgun",3,0,1);held[VK_LBUTTON]=true;attempt(false);held.clear();bind("+attack","f");held['F']=true;attempt(false);held.clear();bind("+attack","MOUSE1");held[VK_RBUTTON]=true;attempt(false);held.clear();
    times(21,0);attempt(false);times(19,21);attempt(false);times(19,40);attempt(true);times(19,0);
    weapon("CAutoShotgun",3,0,1);held[VK_LBUTTON]=held[VK_RBUTTON]=true;times(50,21);attempt(true);held.clear();times(0,0);
    weapon("CPumpShotgun",3,0,1);held['R']=true;attempt(false);held.clear();player(1,2,0,1);attempt(false);player(0,3,0,1);attempt(false);player(0,2,0,1);
    bind("+reload","MOUSE4");stop();before=events.size();start();tick(200);require(events.back().type==INPUT_MOUSE&&events.back().mi.mouseData==XBUTTON1,"current mouse binding");bind("+reload","r");tick(24);require(events.size()==before+2&&events.back().mi.dwFlags==MOUSEEVENTF_XUP,"release captured old binding");
    stop();start();tick(200);before=events.size();foreground=false;tick(1);require(events.size()==before+1&&(events.back().ki.dwFlags&KEYEVENTF_KEYUP),"focus loss while held");foreground=true;
    stop();start();tick(200);before=events.size();view(1,0,0,0);tick(1);require(events.size()==before+1,"menu releases");tick(500);require(events.size()==before+1,"menu silent");view(0,0,0,0);
    stop();start();tick(200);before=events.size();mode(2);tick(1);require(events.size()==before+1,"remote releases");tick(500);require(events.size()==before+1,"remote silent");mode(1);
    stop();start();tick(200);before=events.size();mode(3);tick(1);require(events.size()==before+1,"loading releases");mode(1);
    stop();rejected=1;start();before=events.size();tick(200);require(events.size()==before,"refused input");tick(499);require(events.size()==before,"500 ms failure backoff");tick(1);require(events.size()==before+1,"retry after backoff");tick(24);
    auto saved=invoke("status")["settings"];char tiny[1]{};require(feature.invoke("configure","{\"pump\":false}",tiny,1,&size)==L4P_BUFFER_TOO_SMALL&&invoke("status")["settings"]==saved,"capacity before setting changes");require(feature.invoke("configure","{\"pump\":1}",output,sizeof(output),&size)==L4P_BAD_ARGUMENT,"invalid boolean");
    stop();limits(8,1);capacity=99;probeCapacity=1;paint();probeCapacity=0;weapons.status(&status);require(capacityCode==L4P_ENTITY_MISSING&&capacity==99&&status==3,"native RaiseException contained");auto oldCalls=calls();attempt(true);require(calls()==oldCalls,"fallback after disabled native lookup");
    stop();start();tick(200);before=events.size();feature.shutdown();require(events.size()==before+1&&(events.back().ki.dwFlags&KEYEVENTF_KEYUP),"plugin shutdown immediately releases");tick(500);require(events.size()==before+1,"shutdown quiet");source.unsubscribe(probe);service.shutdown();
    std::cout<<"PASS: real auto-reload DLL, four weapons/two switches, native capacities/fallback, cadence, action gates, focus/UI/scope, settings and input cleanup; zero desktop input\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
