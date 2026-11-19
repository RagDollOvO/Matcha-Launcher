#define NOMINMAX
#include <windows.h>
#include "l4p_corpse.h"
#include "l4p_resource.h"
#include "owned_input.hpp"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
using nlohmann::json;namespace fs=std::filesystem;
void require(bool v,const char* why){if(!v)throw std::runtime_error(why);}
template<class T>T sym(HMODULE h,const char* name){auto p=reinterpret_cast<T>(GetProcAddress(h,name));require(p,name);return p;}
void L4P_CALL log(void*,uint32_t,const char*){}
DWORD now=1000;DWORD WINAPI clockValue(){return now;}
L4P_CorpseApiV1 corpse{1,sizeof(corpse)};L4P_EntityApiV1 entity{1,sizeof(entity)};L4P_ResourceApiV1 resource{1,sizeof(resource)};
uint32_t local=0,other=0,any=0,op=0,result=0;int index=100,frames=0;L4P_EntityRefV1 held{};
void L4P_CALL frame(void*,const L4P_SourceFrameV1*){++frames;
    if(op==1||op==2||op==3){L4P_EntityRefV1 ref{};result=entity.reference(index,&ref);if(!result){held=ref;result=corpse.hide(op==1?local:op==2?other:any,&ref);}}
    if(op==4)result=corpse.release(local,nullptr);if(op==5)result=corpse.destroy_ragdolls(local);if(op==6)result=corpse.destroy_ragdolls(any);
    if(op==7)result=resource.claim(other,"skeeto.corpse.common");
}
void L4P_CALL noop(void*,const L4P_SourceFrameV1*){}
int wmain(int argc,wchar_t** argv){try{
    require(argc==4,"corpses_smoke <dist plugins> <fixtures> <fresh root>");auto dist=fs::absolute(argv[1]),fixture=fs::absolute(argv[2]),root=fs::absolute(argv[3]);require(!fs::exists(root),"fresh root");auto packs=root/L"bin/l4p/plugins";
    auto load=[](fs::path p){auto h=LoadLibraryExW(fs::absolute(p).c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(h,"DLL load");return h;};
    auto engine=load(fixture/L"source/engine.dll"),vars=load(fixture/L"source/vstdlib.dll"),client=load(fixture/L"corpses/client.dll");
    auto put=sym<void(__cdecl*)(int,const char*,int,int,uint32_t,uint32_t)>(client,"FixturePut");auto value=sym<uint32_t(__cdecl*)(int,int)>(client,"FixtureValue");auto edit=sym<void(__cdecl*)(int,int,int,uint32_t)>(client,"FixtureEdit");auto access=sym<void(__cdecl*)(int,uint32_t)>(client,"FixtureAccess");auto guard=sym<int(__cdecl*)(int)>(client,"FixtureGuard");auto remove=sym<void(__cdecl*)(int)>(client,"FixtureRemove");auto highCalls=sym<int(__cdecl*)()>(client,"FixtureHighestCalls");
    auto paint=sym<void(__cdecl*)()>(engine,"FixturePaint");auto mode=sym<void(__cdecl*)(int)>(engine,"FixtureMode");auto event=sym<void(__cdecl*)(const char*)>(engine,"FixtureEvent");auto eventInt=sym<void(__cdecl*)(const char*,int)>(engine,"FixtureEventInt");auto commands=sym<int(__cdecl*)()>(engine,"FixtureCommands");auto last=sym<const char*(__cdecl*)()>(engine,"FixtureLastCommand");auto setVar=sym<void(__cdecl*)(const char*,float,int)>(vars,"FixtureSet");auto cvalue=sym<float(__cdecl*)(const char*)>(vars,"FixtureValue");
    auto init=[&](const wchar_t* id,const char* config){auto path=packs/id;fs::create_directories(path);fs::copy_file(dist/id/L"plugin.dll",path/L"plugin.dll");auto module=load(path/L"plugin.dll");L4P_PluginApiV1 p{1,sizeof(p)};require(!sym<L4P_GetPluginApiFn>(module,"L4P_GetPluginApi")(1,&p),"plugin ABI");
        if(!wcscmp(id,L"beacon.source"))require(owned_input::replace(module,"GetTickCount",reinterpret_cast<void*>(&clockValue)),"isolated clock");auto dir=path.u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,dir.c_str(),config};require(!p.init(&host),"init");return std::make_pair(module,p);};
    mode(1);auto source=init(L"beacon.source","{}");L4P_SourceApiV1 sdk{1,sizeof(sdk)};sym<L4P_GetSourceApiFn>(source.first,"L4P_GetSourceApi")(1,&sdk);
    require(!sym<L4P_GetCorpseApiFn>(source.first,"L4P_GetCorpseApi")(1,&corpse)&&!sym<L4P_GetEntityApiFn>(source.first,"L4P_GetEntityApi")(1,&entity)&&!sym<L4P_GetResourceApiFn>(source.first,"L4P_GetResourceApi")(1,&resource),"SDK negotiation");
    sdk.subscribe("fixture.corpse",1,"",nullptr,frame,nullptr,&local);sdk.subscribe("fixture.other",1,"",nullptr,noop,nullptr,&other);sdk.subscribe("fixture.any",0,"",nullptr,noop,nullptr,&any);
    for(int i=0;i<100&&!frames;++i){Sleep(20);paint();}require(frames,"Paint ready");auto tick=[&](uint32_t step=1){now+=step;paint();};auto run=[&](uint32_t code){op=code;tick();op=0;return result;};
    put(100,"Infected",4,2,0xaabbccdd,1);require(corpse.hide(local,&held)==L4P_BAD_ARGUMENT&&run(3)==6,"Paint and LOCAL gates");require(!run(1)&&value(100,0)==36&&value(100,1)==10&&value(100,2)==0&&value(100,3)==1,"three fields hidden with origin unchanged");require(run(2)==5,"independent owner conflict");
    edit(100,36|64,10,0);require(!run(4)&&value(100,0)==68&&value(100,1)==2&&value(100,2)==0xaabbccdd,"restore original values, preserve unrelated effect bits");
    run(1);edit(100,4,3,0x11223344);run(1);run(4);require(value(100,0)==4&&value(100,1)==3&&value(100,2)==0x11223344,"refresh native changes while held");
    run(1);edit(100,36,4,0x55667788);corpse.release(local,nullptr);tick();require(value(100,1)==4&&value(100,2)==0x55667788,"external changes before release preserved");
    put(1,"C_ClientRagdoll",4,2,0xff,1);index=1;require(run(1)==L4P_BAD_ARGUMENT,"player slot excluded");put(101,"CTerrorPlayer",4,2,0xff,1);index=101;require(run(1)==7&&value(101,1)==2,"pawn class outside player slots excluded");
    index=100;run(1);put(100,"Infected",8,6,0x1234,2);run(4);require(value(100,0)==8&&value(100,1)==6,"serial reuse preserves replacement");run(1);put(100,"CPhysicsProp",16,7,0x5678,2);run(4);require(value(100,1)==7,"class reuse preserves replacement");
    put(100,"Witch",4,2,0x1234,3);run(1);access(100,PAGE_READONLY);run(4);require(value(100,1)==10,"failed restore stays queued");access(100,PAGE_READWRITE);tick();require(value(100,1)==2&&value(100,2)==0x1234,"restoration retry completes");
    run(1);access(100,PAGE_READWRITE|PAGE_GUARD);corpse.release(local,nullptr);tick();require(guard(100),"identity probe preserves guard page");access(100,PAGE_READWRITE);tick();require(value(100,1)==2,"temporary inaccessible identity retains restoration");
    run(1);mode(2);tick();require(value(100,1)==2&&run(1)==6&&run(6)==6,"remote scope restores and refuses writes");mode(1);auto before=commands();require(!run(5)&&commands()==before+1&&!strcmp(last(),"cl_destroy_ragdolls"),"typed native command");
    run(1);put(100,"Witch",8,6,0x3456,3);event("game_newmap");run(4);require(value(100,0)==8&&value(100,1)==6&&value(100,2)==0x3456,"new map with same pointer and serial abandons old fields");put(100,"Witch",4,2,0x1234,3);
    for(auto name:{"cl_ragdoll_maxcount","cl_ragdoll_maxcount_generic","cl_ragdoll_maxcount_special","cl_ragdoll_maxcount_boss","r_drawtracers_firstperson"})setVar(name,8,0);
    auto feature=init(L"skeeto.combat-declutter","{}");char output[16384]{};uint32_t size=0;
    auto invoke=[&](const char* action,json args=json::object()){auto text=args.dump();auto code=feature.second.invoke(action,text.c_str(),output,sizeof(output),&size);if(code)throw std::runtime_error(std::string(action)+" "+text+" code="+std::to_string(code)+" win32="+std::to_string(GetLastError()));return json::parse(output);};
    auto configure=[&](json settings){invoke("configure",settings);tick();};auto death=[&](int victim){eventInt("victim",victim);event("zombie_death");tick();};
    tick();require(cvalue("cl_ragdoll_maxcount")==8,"old default config");configure({{"common",true},{"tracers",true}});require(cvalue("cl_ragdoll_maxcount")==0&&cvalue("cl_ragdoll_maxcount_generic")==0&&cvalue("cl_ragdoll_maxcount_special")==8&&cvalue("r_drawtracers_firstperson")==0,"old category and tracer contract");
    int scans=highCalls();for(int i=0;i<5;++i)tick(300);require(highCalls()==scans,"idle does not scan entity list");put(100,"Infected",4,2,0x1234,4);before=commands();death(100);require(value(100,1)==10&&commands()==before,"death event exact target and delayed destruction");
    tick(49);require(commands()==before,"first pulse waits 50 ms");for(int i=0;i<4;++i)tick(i?50:1);require(commands()==before+4,"four finite destroy pulses");for(int i=0;i<6;++i)tick(100);scans=highCalls();tick(300);require(highCalls()==scans&&commands()==before+4,"event work becomes idle");tick(2500);require(value(100,1)==2&&invoke("status")["tracked"]==0,"2.5 second restoration");
    put(2,"Tank",4,2,0xabcd,1);put(250,"C_ClientRagdoll",4,2,0xabcd,1);put(251,"C_InfectedRagdoll",4,2,0xabcd,1);put(180,"C_ClientRagdoll",4,2,0xabcd,1);configure({{"special",true},{"common",false}});death(2);require(value(2,1)==2&&value(250,1)==10&&value(251,1)==2&&value(180,1)==2,"SI pawn preserved, tail budget and infected-ragdoll category");configure({{"special",false},{"common",true}});require(value(250,1)==10,"generic tracked ragdoll transfers to remaining category");configure({{"common",false}});require(value(250,1)==2,"last corpse option restores tracking");
    require(!run(7),"dissolve category reservation");configure({{"common",true}});put(100,"Infected",4,2,0x1234,5);death(100);require(value(100,1)==2&&invoke("status")["code"]==5&&cvalue("cl_ragdoll_maxcount_generic")==8,"other category owner prevents suppression");resource.release(other,nullptr);tick();death(100);require(value(100,1)==10,"release hands category back");
    char tiny[1]{};require(feature.second.invoke("configure","{\"active\":false}",tiny,1,&size)==L4P_BUFFER_TOO_SMALL&&invoke("status")["settings"]["active"]==true,"small buffer leaves settings intact");configure({{"active",false}});before=commands();tick(500);require(value(100,1)==2&&commands()==before&&cvalue("r_drawtracers_firstperson")==8,"disable restores and cancels queues");
    configure({{"active",true}});death(100);mode(3);tick();require(value(100,1)==2&&cvalue("cl_ragdoll_maxcount")==8,"loading restores owned fields and Cvars");mode(1);tick();before=commands();tick(500);require(commands()==before,"loading discarded death pulses");
    death(100);event("round_start");tick();require(value(100,1)==2&&invoke("status")["tracked"]==0,"round boundary releases tracks");
    // 65 distinct confirmed deaths exercise the original bounded FIFO.
    configure({{"special",false}});for(int i=300;i<365;++i){put(i,"Infected",4,2,0x1234,1);death(i);}require(invoke("status")["tracked"]==64&&value(300,1)==2&&value(364,1)==10,"64 entry FIFO restores evicted corpse");
    feature.second.shutdown();tick();require(value(364,1)==2&&cvalue("cl_ragdoll_maxcount")==8,"feature shutdown restores live fields and parameters");
    index=100;run(1);sdk.unsubscribe(local);tick();require(value(100,1)==2,"subscription cleanup");
    // Keep a different live owner through provider shutdown.
    sdk.unsubscribe(any);sdk.unsubscribe(other);sdk.subscribe("fixture.shutdown",1,"",nullptr,frame,nullptr,&local);run(1);require(value(100,1)==10,"provider shutdown starts with held fields");source.second.shutdown();paint();require(value(100,1)==2,"provider shutdown restores on next Paint");
    std::cout<<"PASS Corpses: owned fields/identity/guard/retry/scope, event targeting, finite pulses/tail scan, category coordination, old settings, limits and shutdown\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
