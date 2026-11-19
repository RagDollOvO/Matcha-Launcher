#define NOMINMAX
#include <windows.h>
#include "l4p_dissolve.h"
#include "l4p_resource.h"
#include "owned_input.hpp"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <cmath>
using nlohmann::json;namespace fs=std::filesystem;
void require(bool value,const char* text){if(!value)throw std::runtime_error(text);}
template<class T>T sym(HMODULE m,const char* name){auto p=reinterpret_cast<T>(GetProcAddress(m,name));require(p,name);return p;}
void L4P_CALL log(void*,uint32_t,const char*){}
DWORD now=1000;DWORD WINAPI clockValue(){return now;}
L4P_EntityApiV1 entity{1,sizeof(entity)};L4P_DissolveApiV1 dissolve{1,sizeof(dissolve)};L4P_ResourceApiV1 resource{1,sizeof(resource)};
uint32_t token=0,other=0,op=0,result=0;int frames=0,index=100;L4P_DissolveRequestV1 request{sizeof(request),{},0,2,550,0,0};
void L4P_CALL onFrame(void*,const L4P_SourceFrameV1*){++frames;
    if(op==1){result=entity.reference(index,&request.target);request.player_user=0;request.player_life=0;
        if(!result&&index<=64){L4P_EntityInfoV1 info{sizeof(info)};result=entity.describe(&request.target,&info);request.player_user=info.user_id;if(!result)result=dissolve.player_life(info.user_id,&request.player_life);}
        if(!result)result=dissolve.start(token,&request);}
    if(op==2)result=dissolve.release(token,L4P_DISSOLVE_ALL);
    if(op==3)result=dissolve.start(token,&request);
    if(op==4)result=resource.claim(other,"skeeto.corpse.common");
}
void L4P_CALL noop(void*,const L4P_SourceFrameV1*){}
int wmain(int argc,wchar_t** argv){try{
    require(argc==4||argc==5,"dissolve_smoke <dist plugins> <fixtures> <fresh root> [fault number / unsupported]");
    auto dist=fs::absolute(argv[1]),fixtures=fs::absolute(argv[2]),root=fs::absolute(argv[3]);require(!fs::exists(root),"fresh root");auto packs=root/L"bin/l4p/plugins";
    auto load=[](fs::path p){auto h=LoadLibraryExW(fs::absolute(p).c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(h,"load DLL");return h;};
    auto engine=load(fixtures/L"source/engine.dll"),vars=load(fixtures/L"source/vstdlib.dll"),client=load(fixtures/L"dissolve/client.dll");
    auto put=sym<void(__cdecl*)(int,const char*,uint32_t,float)>(client,"FixtureDissPut");auto value=sym<uint32_t(__cdecl*)(int,int)>(client,"FixtureDissValue");auto edit=sym<void(__cdecl*)(int,int,uint32_t)>(client,"FixtureDissEdit");auto stats=sym<int(__cdecl*)(int)>(client,"FixtureDissStats");
    auto fxFloat=sym<float(__cdecl*)(int)>(client,"FixtureDissFxFloat");auto fxInt=sym<uint32_t(__cdecl*)(int)>(client,"FixtureDissFxInt");auto access=sym<void(__cdecl*)(int,uint32_t)>(client,"FixtureDissAccess");auto fault=sym<void(__cdecl*)(int)>(client,"FixtureDissFault");
    auto object=sym<void*(__cdecl*)(int)>(client,"FixtureDissEntity");auto remove=sym<void(__cdecl*)(int)>(client,"FixtureDissRemove");
    auto paint=sym<void(__cdecl*)()>(engine,"FixturePaint");auto mode=sym<void(__cdecl*)(int)>(engine,"FixtureMode");auto event=sym<void(__cdecl*)(const char*)>(engine,"FixtureEvent");auto eventInt=sym<void(__cdecl*)(const char*,int)>(engine,"FixtureEventInt");auto eventFloat=sym<void(__cdecl*)(const char*,float)>(engine,"FixtureEventFloat");auto commands=sym<int(__cdecl*)()>(engine,"FixtureCommands");
    sym<void(__cdecl*)(void*)>(engine,"FixtureModelInfo")(sym<void*(__cdecl*)()>(client,"FixtureDissModelInfo")());
    auto init=[&](const wchar_t* id,const char* config){auto dir=packs/id;fs::create_directories(dir);fs::copy_file(dist/id/L"plugin.dll",dir/L"plugin.dll");auto module=load(dir/L"plugin.dll");L4P_PluginApiV1 api{1,sizeof(api)};
        require(!sym<L4P_GetPluginApiFn>(module,"L4P_GetPluginApi")(1,&api),"plugin ABI");if(!wcscmp(id,L"beacon.source"))require(owned_input::replace(module,"GetTickCount",reinterpret_cast<void*>(&clockValue)),"private clock");
        auto path=dir.u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,path.c_str(),config};require(!api.init(&host),"init");return std::make_pair(module,api);};
    mode(2);put(1,"CTerrorPlayer",1,0);put(100,"Infected",1,100);auto provider=init(L"beacon.source","{}");L4P_SourceApiV1 source{1,sizeof(source)};
    require(!sym<L4P_GetSourceApiFn>(provider.first,"L4P_GetSourceApi")(1,&source)&&!sym<L4P_GetEntityApiFn>(provider.first,"L4P_GetEntityApi")(1,&entity)&&!sym<L4P_GetDissolveApiFn>(provider.first,"L4P_GetDissolveApi")(1,&dissolve)&&!sym<L4P_GetResourceApiFn>(provider.first,"L4P_GetResourceApi")(1,&resource),"SDK ABI");
    source.subscribe("fixture.dissolve",0,"",nullptr,onFrame,nullptr,&token);source.subscribe("fixture.other",0,"",nullptr,noop,nullptr,&other);
    for(int i=0;i<100&&!frames;++i){Sleep(20);paint();}require(frames,"Paint attached");
    auto tick=[&](uint32_t ms=1){now+=ms;paint();};auto run=[&](uint32_t action){op=action;tick();op=0;return result;};auto state=[&](){L4P_DissolveStatusV1 s{sizeof(s)};require(!dissolve.status(0,&s),"status");return s;};
    if(argc==5){if(!wcscmp(argv[4],L"unsupported")){sym<void(__cdecl*)()>(client,"FixtureDissUnsupported")();require(run(1)==7&&state().backend==2&&stats(0)==0,"unsupported body leaves entities intact");}
        else {int f=_wtoi(argv[4]);if(f==5){require(!run(1),"delete failure setup");fault(f);run(2);require(state().retained==1,"failed native deletion stays queued");}
            else {fault(f);auto r=run(1);require(r!=0,"native failure reported");}
            if(f!=7&&f!=8)require(state().backend==3,"SEH disables backend");require(state().failures==1,"one failed native operation counted once");fault(0);tick();
            require(value(100,0x34)==2&&value(100,0x38)==0xaabbccdd&&value(100,0xf0)==8,"failed create restores target");
            if(f==1)require(state().orphans==1,"constructor failure counted once");else require(stats(0)==stats(1),"completed constructions reclaimed");}
        std::cout<<"PASS Dissolve native failure path\n";return 0;}
    require(dissolve.start(token,&request)==L4P_BAD_ARGUMENT,"Paint gate");require(!run(1),"ANY native create");
    require(state().backend==1&&state().active==1&&state().common_active==1&&stats(2)==0,"native ABI validated");
    require(fxInt(0x658)==2&&std::abs(fxFloat(0x640))<.0001f&&std::abs(fxFloat(0x644)-.45f)<.0001f&&std::abs(fxFloat(0x650)-.02f)<.0001f&&std::abs(fxFloat(0x654)-.35f)<.0001f,"type and complete fade timing");
    require(fxFloat(0x30)==110&&stats(4)==1&&stats(5)==1&&stats(6)==1,"absolute origin, onData and parent called once");
    require(value(100,0x30)==4&&value(100,0x34)==1&&value(100,0xf0)==0x10000008,"common gets native fade and flag, stays visible");
    edit(100,0x30,68);edit(100,0xf0,0x10000018);require(!run(2)&&value(100,0x30)==68&&value(100,0x34)==2&&value(100,0x38)==0xaabbccdd&&value(100,0xf0)==24&&value(100,0x5f8)==0xffffffff,"release restores owned fields and preserves unrelated bits");
    require(run(1)==5,"recent dedup");tick(2101);index=101;put(index,"Witch",1,500);request.type=3;request.duration_ms=1100;require(!run(1)&&value(index,0x30)==36&&value(index,0x34)==10&&std::abs(fxFloat(0x644)-.9f)<.0001f,"Witch hide and duration scaling");
    tick(1100);require(state().active==0&&state().retained==1&&value(index,0x34)==10,"completed corpse retains restoration");
    access(index,PAGE_READONLY);dissolve.release(token,2);tick();require(state().retained==1,"readonly restore retained");access(index,PAGE_READWRITE);tick();require(state().retained==0&&value(index,0x34)==2,"readonly restore retry");
    index=103;put(index,"Witch",1,700);require(!run(1),"FX temporary guard setup");auto fxAccess=sym<void(__cdecl*)(uint32_t)>(client,"FixtureDissFxAccess");
    fxAccess(PAGE_READWRITE|PAGE_GUARD);dissolve.release(token,2);tick();require(state().retained==1&&value(index,0x34)==10,"unreadable effect retains cleanup ownership");fxAccess(PAGE_READWRITE);tick();require(state().retained==0&&value(index,0x34)==2,"effect accessibility recovery finishes restore");
    index=2;put(index,"Tank",1,20);request.category=1;request.type=0;request.duration_ms=200;require(!run(1)&&value(index,0x30)==4&&value(index,0xf0)==8,"player pawn never gets hide or dissolving flag");tick(200);require(state().retained==0&&value(index,0x34)==2,"player expires and restores");
    tick(2101);require(!run(1),"player second life effect");eventInt("userid",8);edit(index,0x34,7);edit(index,0x38,0x87654321);event("player_spawn");require(state().retained==0&&value(index,0x34)==7&&value(index,0x38)==0x87654321,"spawn retires old effect without old-life restoration");require(run(3)==8,"captured old-life request rejected");
    index=102;put(index,"Witch",1,600);request.category=0;require(!run(1),"owned native effect");edit(index,0x5f8,0x12345);edit(index,0x34,6);edit(index,0x38,0x12345678);run(2);require(value(index,0x34)==6&&value(index,0x38)==0x12345678&&value(index,0x5f8)==0x12345,"foreign native effect preserved");tick(2101);require(run(1)==5,"existing effect retains priority");
    put(index,"Witch",2,600);require(!run(1),"new serial starts");put(index,"Witch",3,600);edit(index,0x34,9);run(2);require(value(index,0x34)==9,"recycled entity keeps replacement fields");
    request.duration_ms=2000;for(int i=130;i<137;++i){index=i;put(i,"Witch",1,float(i));require(run(1)==(i==136?9u:0u),"six active effect cap");}run(2);
    for(int i=140;i<144;++i){index=i;put(i,"Infected",1,float(i));require(run(1)==(i==143?9u:0u),"three active common cap");}run(2);
    // The actual consumer drives event delays, separate switches and independent cleanup.
    auto feature=init(L"skeeto.corpse-dissolve","{}");char out[16384];uint32_t bytes=0;
    auto invoke=[&](const char* action,json args=json::object()){auto input=args.dump();auto c=feature.second.invoke(action,input.c_str(),out,sizeof(out),&bytes);if(c)throw std::runtime_error(std::string(action)+" code="+std::to_string(c));return json::parse(out);};
    auto configure=[&](json args){invoke("configure",args);tick();};auto death=[&](int target,int attacker=1){eventInt("victim",target);eventInt("attacker",attacker);event("zombie_death");};
    tick();int before=stats(0);put(110,"Infected",1,1000);death(110);tick(20);require(stats(0)==before,"category defaults off");
    configure({{"common",true}});death(110,2);tick(20);require(stats(0)==before,"CI requires local kill");death(110);tick(15);require(stats(0)==before,"CI deferred 16 ms");tick();require(stats(0)==before+1&&invoke("status")["created"]==1,"CI event creates real native object");
    put(111,"Infected",1,1300);death(111);tick(16);require(stats(0)==before+1,"CI 175 ms throttle");tick(159);require(stats(0)==before+2,"CI throttle resumes without lost event");
    put(112,"Witch",1,1700);death(112,2);tick(50);tick(51);require(stats(0)==before+3,"Witch accepts other killer and window throttle");
    configure({{"common",false}});require(value(110,0x34)==2&&value(112,0x34)==2&&state().retained==0,"category disable restores all retained targets");
    int beforeCommands=commands();configure({{"ragdoll-cleanup",true}});require(commands()==beforeCommands+1,"cleanup runs with both categories off");tick(199);require(commands()==beforeCommands+1,"cleanup waits full interval");tick();require(commands()==beforeCommands+2,"cleanup every 200 ms");configure({{"ragdoll-cleanup",false}});
    require(!run(4),"other category claim");configure({{"common",true}});put(113,"Infected",1,2000);death(113);tick(200);require(invoke("status")["code"]==5&&value(113,0x34)==2,"category conflict pauses consumer");resource.release(other,nullptr);tick();death(113);tick(16);require(value(113,0x34)==1,"category release resumes consumer");
    access(113,PAGE_READONLY);configure({{"common",false}});char owner[65]{};resource.owner("skeeto.corpse.common",owner);require(!strcmp(owner,"skeeto.corpse-dissolve"),"failed restoration retains category ownership");access(113,PAGE_READWRITE);tick();resource.owner("skeeto.corpse.common",owner);require(!owner[0]&&value(113,0x34)==2,"category released after restoration completes");
    configure({{"common",true}});tick(200);put(200,"Infected",1,4000);put(201,"Infected",1,4020);
    sym<void(__cdecl*)(void*)>(engine,"FixtureTraceEntity")(object(201));eventInt("userid",7);eventFloat("x",4000);eventFloat("y",0);eventFloat("z",0);event("bullet_impact");eventFloat("x",9000);event("bullet_impact");tick();
    float segment[6]{};require(sym<int(__cdecl*)(float*)>(engine,"FixtureTraceSegment")(segment)&&segment[3]>4001&&segment[3]<4003&&invoke("status")["traces"]==1,"first pellet retained, local shot trace extended by two units");
    death(200);remove(200);tick(16);require(value(201,0x34)==1,"traced identity glued to death anchor is consumed");
    tick(200);put(202,"Infected",1,5000);put(203,"Infected",1,5020);death(202);remove(202);before=stats(0);for(int i=0;i<6;++i)tick(40);require(stats(0)==before&&value(203,0x34)==2,"untraced living neighbor stays untouched");
    put(204,"Infected",1,6000);put(205,"CCSRagdoll",1,6020);death(204);remove(204);tick(16);require(value(205,0x34)==10,"bounded typed ragdoll backup at anchor");
    for(int i=300;i<317;++i){put(i,"Infected",1,float(i*100));death(i);}require(invoke("status")["pending"]==16,"pending queue bounded to sixteen");event("round_start");tick();require(invoke("status")["pending"]==0&&state().retained==0,"round clears pending and native leases");
    configure({{"common",false},{"special",true}});
    put(2,"Tank",4,20);death(2);before=stats(0);tick(31);require(stats(0)==before,"SI 32 ms defer");tick(100);require(stats(0)==before+1&&value(2,0xf0)==8,"SI uses captured life and no flag");
    configure({{"active",false}});require(value(2,0x34)==2&&state().retained==0,"master off restores native state");
    // Disjoint categories retain their own limits while global cleanup yields.
    mode(1);auto setVar=sym<void(__cdecl*)(const char*,float,int)>(vars,"FixtureSet");auto varValue=sym<float(__cdecl*)(const char*)>(vars,"FixtureValue");
    for(auto name:{"cl_ragdoll_maxcount","cl_ragdoll_maxcount_generic","cl_ragdoll_maxcount_special","cl_ragdoll_maxcount_boss","r_drawtracers_firstperson"})setVar(name,8,0);
    auto declutter=init(L"skeeto.combat-declutter","{\"special\":true}");tick();require(varValue("cl_ragdoll_maxcount")==0,"legacy suppression alone");
    configure({{"active",true},{"common",true},{"special",false}});tick();require(varValue("cl_ragdoll_maxcount")==8&&varValue("cl_ragdoll_maxcount_special")==0,"disjoint dissolve pauses global limit, preserves special category limit");
    int commandCount=commands();put(3,"Hunter",1,50);death(3);for(int i=0;i<6;++i)tick(50);require(commands()==commandCount,"cross-category global destroy pulses yield");
    configure({{"active",false}});tick();require(varValue("cl_ragdoll_maxcount")==0,"global limit resumes after dissolve closes");declutter.second.shutdown();tick();
    char tiny[1];require(feature.second.invoke("configure","{\"active\":true}",tiny,1,&bytes)==L4P_BUFFER_TOO_SMALL&&invoke("status")["settings"]["active"]==false,"short buffer leaves settings intact");
    configure({{"active",true},{"common",true},{"special",false}});put(120,"Infected",1,3000);death(120);tick(16);feature.second.shutdown();tick();require(value(120,0x34)==2&&state().retained==0,"unsubscribe restores feature-owned native state");
    index=121;put(index,"Witch",1,3200);request.duration_ms=550;require(!run(1),"provider shutdown live effect");provider.second.shutdown();paint();require(value(index,0x34)==2&&state().retained==0,"provider shutdown restoration");
    require(stats(2)==0,"all native ABI arguments matched");std::cout<<"PASS Dissolve: native creation/timing/parent/origin, life/identity/ownership/restore, consumer death delays/throttle/category/cleanup/config/shutdown\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
