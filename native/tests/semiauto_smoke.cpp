#define NOMINMAX
#include <windows.h>
#include "l4p_input.h"
#include "owned_mouse.hpp"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <iostream>
#include <stdexcept>
using nlohmann::json;namespace fs=std::filesystem;
void require(bool ok,const char* why){if(!ok)throw std::runtime_error(why);}
template<class T>T sym(HMODULE h,const char* name){auto p=reinterpret_cast<T>(GetProcAddress(h,name));require(p,name);return p;}
void L4P_CALL log(void*,uint32_t,const char*){}
DWORD now=1000;DWORD WINAPI clockValue(){return now;}
L4P_InputApiV2 input{{2,sizeof(input)}};L4P_MouseStateV1 mouse{sizeof(mouse)};
uint32_t owner=0,probe=0,other=0,any=0,result=0;int frames=0,op=0;
void L4P_CALL frame(void*,const L4P_SourceFrameV1*){++frames;
    if(op==1)result=input.watch_mouse(owner,1);if(op==2)result=input.mouse_edge(owner,0);if(op==3)result=input.mouse_edge(owner,1);if(op==4)result=input.base.press(owner,"+reload");
    input.mouse_state(probe,&mouse);
}
void L4P_CALL noop(void*,const L4P_SourceFrameV1*){}
int wmain(int argc,wchar_t** argv){try{
    require(argc==5,"semiauto_smoke <Source DLL> <feature DLL> <engine fixtures dir> <fresh root>");fs::path root=fs::absolute(argv[4]);require(!fs::exists(root),"fresh root");
    for(auto id:{L"beacon.source",L"skeeto.auto-semiauto"})fs::create_directories(root/id);fs::copy_file(argv[1],root/L"beacon.source/plugin.dll");fs::copy_file(argv[2],root/L"skeeto.auto-semiauto/plugin.dll");
    auto load=[](fs::path p){auto h=LoadLibraryExW(fs::absolute(p).c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(h,"DLL load");return h;};
    auto engine=load(fs::path(argv[3])/L"engine.dll"),client=load(fs::path(argv[3])/L"client.dll"),module=load(root/L"beacon.source/plugin.dll");owned_mouse::isolate(module);require(owned_input::replace(module,"GetTickCount",reinterpret_cast<void*>(&clockValue)),"clock isolation");
    auto paint=sym<void(__cdecl*)()>(engine,"FixturePaint");auto mode=sym<void(__cdecl*)(int)>(engine,"FixtureMode");auto view=sym<void(__cdecl*)(int,float,float,float)>(engine,"FixtureView");auto bind=sym<void(__cdecl*)(const char*,const char*)>(engine,"FixtureBinding");
    auto model=sym<void(__cdecl*)(int,const char*)>(engine,"FixtureModelName");auto event=sym<void(__cdecl*)(const char*)>(engine,"FixtureEvent");
    auto weapon=sym<void(__cdecl*)(const char*,int,int,unsigned)>(client,"FixtureWeapon");auto player=sym<void(__cdecl*)(int,int,int,unsigned)>(client,"FixturePlayer");mode(1);weapon("CPistol",10,0,1);
    L4P_PluginApiV1 service{1,sizeof(service)},feature{1,sizeof(feature)};sym<L4P_GetPluginApiFn>(module,"L4P_GetPluginApi")(1,&service);auto dir=(root/L"beacon.source").u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,dir.c_str(),"{}"};require(!service.init(&host),"Source init");
    L4P_SourceApiV1 source{1,sizeof(source)};sym<L4P_GetSourceApiFn>(module,"L4P_GetSourceApi")(1,&source);
    auto get=sym<L4P_GetInputApiFn>(module,"L4P_GetInputApi");require(!get(2,&input.base),"Input API 2");L4P_InputApiV1 v1{1,sizeof(v1)};require(!get(1,&v1)&&v1.struct_size==sizeof(v1),"Input API 1 preserved");require(get(2,&v1)==L4P_BAD_ARGUMENT&&get(3,&v1)==L4P_UNSUPPORTED_VERSION,"API size and version");
    source.subscribe("fixture.semiprobe",1,"",nullptr,frame,nullptr,&probe);source.subscribe("fixture.other",1,"",nullptr,noop,nullptr,&other);source.subscribe("fixture.any",0,"",nullptr,noop,nullptr,&any);owner=probe;
    for(int i=0;i<100&&!frames;++i){Sleep(20);paint();}require(frames,"Paint ready");
    auto tick=[&](DWORD value){now+=value;paint();};auto run=[&](int action){op=action;paint();op=0;return result;};
    auto waitReady=[&]{for(int i=0;i<100;++i){Sleep(5);paint();if(owned_mouse::callback&&mouse.hook_state==2)return;}require(false,"mouse worker ready");};
    auto waitStopped=[&]{for(int i=0;i<100&&owned_mouse::callback;++i)Sleep(5);paint();require(!owned_mouse::callback&&!owned_mouse::thread,"mouse hook uninstalled");};
    using owned_input::events;using owned_mouse::deliver;
    require(input.watch_mouse(probe,1)==L4P_BAD_ARGUMENT,"watch enable callback-only");owner=any;require(run(1)==L4P_INPUT_SCOPE,"ANY cannot watch");owner=probe;
    owned_mouse::rejected=1;require(run(1)==0,"watch registers");for(int i=0;i<100&&mouse.hook_state!=3;++i){Sleep(5);paint();}require(mouse.hook_state==3&&mouse.last_error==ERROR_ACCESS_DENIED,"install failure surfaced");
    auto attempts=owned_mouse::installed.load();tick(999);require(owned_mouse::installed==attempts,"install failure backoff");tick(1);waitReady();
    owner=other;require(run(1)==0,"second watcher");owner=probe;attempts=owned_mouse::installed;require(!input.watch_mouse(other,0)&&owned_mouse::callback&&owned_mouse::installed==attempts,"one watcher stopping preserves shared hook");
    require(run(3)==L4P_INPUT_NOT_HELD&&events.empty(),"no physical hold no synthesized down");deliver(WM_LBUTTONDOWN,LLMHF_INJECTED);paint();require(!mouse.physical_down&&!mouse.physical_events,"injected input ignored");deliver(WM_LBUTTONDOWN,0,-1);paint();require(!mouse.physical_down,"negative hook code chained");
    deliver(WM_LBUTTONDOWN);paint();require(mouse.physical_down&&mouse.physical_events==1,"actual worker physical tracking");require(run(3)==L4P_BAD_ARGUMENT&&events.empty(),"down requires own up window");
    require(run(2)==0&&events.size()==1&&events.back().mi.dwFlags==MOUSEEVENTF_LEFTUP&&mouse.phase==1,"owned release window");require(mouse.physical_down&&mouse.physical_events==1,"synthetic release preserves physical hold");run(2);require(events.size()==1,"idempotent up");
    bind("+reload","MOUSE1");owner=other;require(run(4)==L4P_INPUT_CONFLICT,"reload collision during up window");owner=probe;require(run(4)==L4P_INPUT_CONFLICT,"same owner cannot mix pulse and bound press");
    deliver(WM_LBUTTONUP);paint();require(!mouse.phase&&!mouse.physical_down,"physical up clears release window");auto before=events.size();require(run(3)==L4P_INPUT_NOT_HELD&&events.size()==before,"physical release inside up window cannot re-press");
    deliver(WM_LBUTTONDOWN);run(2);run(3);require(mouse.phase==2,"synthetic down phase");before=events.size();input.base.release(probe);paint();require(events.size()==before&&!mouse.phase&&mouse.physical_down,"hand back manual hold without release");
    run(2);run(3);deliver(WM_LBUTTONUP);owned_input::rejected=1;paint();require(mouse.phase==2,"failed owned up retained");paint();require(!mouse.phase&&events.back().mi.dwFlags==MOUSEEVENTF_LEFTUP,"failed owned up retried");
    deliver(WM_LBUTTONDOWN);run(2);before=events.size();owned_input::foreground=false;require(run(3)==L4P_INPUT_SCOPE&&events.size()==before&&!mouse.phase,"focus loss in up window no down");owned_input::foreground=true;
    run(2);before=events.size();view(1,0,0,0);require(run(3)==L4P_INPUT_SCOPE&&events.size()==before,"menu up-window gate");view(0,0,0,0);
    run(2);mode(2);before=events.size();require(run(3)==L4P_INPUT_SCOPE&&events.size()==before,"remote up-window gate");waitStopped();mode(1);run(1);waitReady();require(!mouse.physical_down,"new watcher requires new physical event");
    deliver(WM_LBUTTONDOWN);owned_input::rejected=1;before=events.size();require(run(2)==L4P_ERROR&&events.size()==before&&!mouse.phase,"failed initial UP leaves no ownership");run(2);owned_input::rejected=1;require(run(3)==L4P_ERROR&&mouse.phase==1,"failed DOWN keeps release phase");input.watch_mouse(probe,0);waitStopped();
    auto fmodule=load(root/L"skeeto.auto-semiauto/plugin.dll");sym<L4P_GetPluginApiFn>(fmodule,"L4P_GetPluginApi")(1,&feature);dir=(root/L"skeeto.auto-semiauto").u8string();host.plugin_directory=dir.c_str();require(!feature.init(&host),"feature init");paint();
    char output[8192]{};uint32_t size=0;auto invoke=[&](const char* action,const json& args=json::object()){auto text=args.dump();require(!feature.invoke(action,text.c_str(),output,sizeof(output),&size),action);return json::parse(output);};
    auto configure=[&](json args){invoke("configure",args);paint();};auto stop=[&]{configure({{"active",false}});waitStopped();};auto start=[&](int rate=2){configure({{"active",true},{"rate",rate}});waitReady();};
    before=events.size();tick(1000);require(events.size()==before&&!owned_mouse::callback,"default closed silent");bind("+reload","r");
    const unsigned bases[]={50,90,130,160,200,250},spans[]={10,20,40,40,60,50};
    for(int rate=0;rate<6;++rate){start(rate);tick(1000);deliver(WM_LBUTTONDOWN);before=events.size();paint();require(events.size()==before+1&&events.back().mi.dwFlags==MOUSEEVENTF_LEFTUP,"first physical hold release");tick(15);require(events.size()==before+1,"16ms minimum up");tick(1);require(events.size()==before+2&&events.back().mi.dwFlags==MOUSEEVENTF_LEFTDOWN,"cycle ends down");DWORD pressed=now;
        while(events.size()==before+2&&now-pressed<=bases[rate]+spans[rate]+1)tick(1);require(events.size()==before+3&&now-pressed>=bases[rate]&&now-pressed<=bases[rate]+spans[rate],"six jitter ranges");tick(16);require(events.size()==before+4,"next cycle down");
        // Abort/re-arm within the same physical hold must retain the hard floor.
        pressed=now;view(1,0,0,0);tick(1);view(0,0,0,0);before=events.size();tick(bases[rate]-2);require(events.size()==before,"press floor survives abort/rearm");stop();}
    auto allowed=[&](const char* name,bool expected){weapon(name,10,0,1);start();tick(1000);deliver(WM_LBUTTONDOWN);before=events.size();paint();require((events.size()==before+1)==expected,name);stop();};
    for(auto name:{"CPistol","CPistol_Magnum","CPumpShotgun","CShotgun_Chrome","CAutoShotgun","CShotgun_SPAS","CHuntingRifle","CSniper_Military","CSniper_Scout","CSniper_AWP","CGrenadeLauncher"})allowed(name,true);
    for(auto name:{"CRifle","CSubMachineGun","CChainsaw","CMeleeWeapon","CMolotov","CFirstAidKit","CDefibrillator","CGasCan","CPainPills"})allowed(name,false);
    model(1,"models/weapons/w_sniper_mini.mdl");allowed("CRifle",true);allowed("CFirstAidKit",false);model(1,"models/weapons/w_pistol.mdl");allowed("CUnclassified",true);model(1,"models/infected/boomer.mdl");allowed("CUnclassified",false);
    weapon("CPistol",10,0,1);start();tick(1000);deliver(WM_LBUTTONDOWN);paint();before=events.size();deliver(WM_LBUTTONUP);tick(16);require(events.size()==before,"consumer physical release in up window");
    deliver(WM_LBUTTONDOWN);paint();before=events.size();owned_input::foreground=false;tick(16);require(events.size()==before,"consumer AltTab in up window");owned_input::foreground=true;
    tick(1000);before=events.size();weapon("CFirstAidKit",10,0,2);tick(1);require(events.size()==before,"new handle immediately rejects hold-action item");weapon("CPistol",10,0,3);player(1,2,0,1);tick(1000);require(events.size()==before,"dead player silent");player(0,3,0,1);tick(1000);require(events.size()==before,"infected player silent");player(0,2,0,1);
    paint();before=events.size();mode(3);tick(16);require(events.size()==before,"loading up-window no press");waitStopped();mode(1);paint();waitReady();tick(1000);before=events.size();paint();require(events.size()==before,"loading restarts with unknown physical hold");
    deliver(WM_LBUTTONDOWN);owned_input::rejected=1;paint();before=events.size();tick(199);require(events.size()==before,"consumer failure backoff");tick(1);require(events.size()==before+1,"consumer failure retry");deliver(WM_LBUTTONUP);paint();
    auto saved=invoke("status")["settings"];char tiny[1]{};require(feature.invoke("configure","{\"active\":false}",tiny,1,&size)==L4P_BUFFER_TOO_SMALL&&invoke("status")["settings"]==saved,"capacity before settings write");require(feature.invoke("configure","{\"rate\":6}",output,sizeof(output),&size)==L4P_BAD_ARGUMENT,"rate bounds");require(feature.invoke("configure","{\"active\":1}",output,sizeof(output),&size)==L4P_BAD_ARGUMENT,"boolean validation");
    tick(1000);deliver(WM_LBUTTONDOWN);paint();tick(16);before=events.size();feature.shutdown();waitStopped();require(events.size()==before,"feature shutdown preserves real hold and unhooks");tick(1000);require(events.size()==before,"shutdown silent");
    // Service shutdown also tears down a remaining independent watcher.
    owner=probe;run(1);waitReady();deliver(WM_LBUTTONDOWN);run(2);run(3);deliver(WM_LBUTTONUP);before=events.size();service.shutdown();waitStopped();require(events.size()==before+1&&events.back().mi.dwFlags==MOUSEEVENTF_LEFTUP,"Source shutdown releases own down without another feature frame");
    require(owned_mouse::installed==owned_mouse::removed+1,"all successful hooks removed; one deliberately failed install");
    std::cout<<"PASS: real Input 1/2 and semiauto DLL, isolated mouse worker/physical events, ownership, six cadences, weapon families, scope/UI/focus, settings, failures and cleanup; zero desktop input/hooks\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
