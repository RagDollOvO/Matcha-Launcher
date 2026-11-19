#define NOMINMAX
#include <windows.h>
#include "l4p_effects.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <iostream>
#include <vector>
#include <stdexcept>
#include <cmath>
namespace fs=std::filesystem;using nlohmann::json;
void require(bool value,const char* why){if(!value)throw std::runtime_error(why);}
void L4P_CALL log(void*,uint32_t,const char*){}
template<class T>T symbol(HMODULE m,const char* name){auto p=reinterpret_cast<T>(GetProcAddress(m,name));require(p,name);return p;}
L4P_EntityApiV1 entity{1,sizeof(entity)};L4P_EffectsApiV1 effects{1,sizeof(effects)};L4P_EntityRefV1 oldRef{};
uint32_t token=0,oldResult=0,eventResult=0;int probeCalls=0;std::string probeError;
void L4P_CALL probe(void*,const L4P_SourceFrameV1* frame){if(!frame->in_game)return;try{
    ++probeCalls;L4P_EntityRefV1 ref{};require(entity.reference(1,&ref)==L4P_OK,"entity reference");
    L4P_EntityInfoV1 info{sizeof(info)};require(entity.describe(&ref,&info)==L4P_OK&&!strcmp(info.class_name,"CTerrorPlayer"),"entity description");
    int highest=-1;require(entity.highest(&highest)==L4P_OK&&highest==3,"highest");
    L4P_EntityRefV1 guarded{};require(entity.reference(3,&guarded)==L4P_OK,"guarded fixture reference");float protectedOutput=123;
    require(entity.read(&guarded,"m_guard",L4P_FIELD_FLOAT,&protectedOutput)==L4P_ENTITY_MISSING&&protectedOutput==123,"inaccessible field copy");
    int team=-1;require(entity.read(&ref,"baseclass.m_iTeamNum",L4P_FIELD_INT,&team)==L4P_OK&&team==2,"nested RecvTable");
    uint8_t life=99;require(entity.read(&ref,"m_lifeState",L4P_FIELD_BYTE,&life)==L4P_OK&&life==0,"byte lifeState");
    int keep=123;require(entity.read(&ref,"missing",L4P_FIELD_INT,&keep)==L4P_ENTITY_MISSING&&keep==123,"missing field output");
    require(entity.read(&ref,"m_iTeamNum",L4P_FIELD_FLOAT,&keep)==L4P_BAD_ARGUMENT&&keep==123,"field type");
    float eye[3];require(entity.eye(&ref,eye)==L4P_OK&&eye[0]==10&&eye[2]==92,"eye position");
    if(oldRef.index)oldResult=entity.read(&oldRef,"m_iTeamNum",L4P_FIELD_INT,&keep);else oldRef=ref;
    auto stale=ref;stale.handle+=0x1000;L4P_EntityRefV1 output{};require(entity.from_handle(stale.handle,&output)==L4P_ENTITY_STALE,"handle serial");
    L4P_LightV1 light{sizeof(light)};light.ttl=2;light.radius=350;require(effects.light(token,15,&light)==L4P_BAD_ARGUMENT,"light ttl bound");
}catch(const std::exception& e){probeError=e.what();}}
void L4P_CALL event(void*,const L4P_SourceFrameV1*,const char*,void*){float from[3]{},to[3]{1,2,3};L4P_TraceV1 out{sizeof(out)};eventResult=effects.trace(token,from,to,L4P_TRACE_SHOT,1,nullptr,&out);}
struct Light {int flags;float origin[3],radius;uint8_t red,green,blue;int8_t exponent;float die,decay,minLight;int key,style;float direction[3],inner,outer;};
int wmain(int argc,wchar_t** argv){try{
    require(argc==4,"effects_smoke <dist plugins> <fake engine/client directory> <fresh root>");fs::path dist=fs::absolute(argv[1]),fake=fs::absolute(argv[2]),root=fs::absolute(argv[3]);require(!fs::exists(root),"fresh fixture root required");
    auto loadDll=[](const fs::path& path){auto m=LoadLibraryExW(path.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(m,"load fixture/plugin DLL");return m;};
    auto engine=loadDll(fake/L"engine.dll"),client=loadDll(fake/L"client.dll");auto mode=symbol<void(__cdecl*)(int)>(engine,"FixtureMode");auto paint=symbol<void(__cdecl*)()>(engine,"FixturePaint");auto fire=symbol<void(__cdecl*)(const char*)>(engine,"FixtureEvent");
    auto player=symbol<void(__cdecl*)(int,int,int,uint32_t)>(client,"FixturePlayer");auto ceiling=symbol<void(__cdecl*)(float)>(engine,"FixtureCeiling");auto light=symbol<int(__cdecl*)(void*)>(engine,"FixtureLight");auto reset=symbol<void(__cdecl*)()>(engine,"FixtureEffectsReset");auto traceWorld=symbol<int(__cdecl*)()>(engine,"FixtureTraceWorld");
    auto load=[&](const wchar_t* id){auto dir=root/L"bin/l4p/plugins"/id;fs::create_directories(dir);fs::copy_file(dist/id/L"plugin.dll",dir/L"plugin.dll");auto m=loadDll(dir/L"plugin.dll");L4P_PluginApiV1 api{1,sizeof(api)};require(symbol<L4P_GetPluginApiFn>(m,"L4P_GetPluginApi")(1,&api)==L4P_OK,"plugin API");return std::make_pair(m,api);};
    auto bridge=load(L"beacon.source");auto base=(root/L"bin/l4p/plugins/beacon.source").u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,base.c_str(),"{}"};require(bridge.second.init(&host)==L4P_OK,"source init");
    L4P_SourceApiV1 source{1,sizeof(source)};require(symbol<L4P_GetSourceApiFn>(bridge.first,"L4P_GetSourceApi")(1,&source)==L4P_OK,"Source API");require(symbol<L4P_GetEntityApiFn>(bridge.first,"L4P_GetEntityApi")(1,&entity)==L4P_OK,"Entity API");require(symbol<L4P_GetEffectsApiFn>(bridge.first,"L4P_GetEffectsApi")(1,&effects)==L4P_OK,"Effects API");
    require(source.subscribe("fixture.entities",L4P_SOURCE_LOCAL,"player_hurt",nullptr,probe,event,&token)==L4P_OK,"probe subscription");mode(1);for(int i=0;i<100&&!probeCalls;++i){Sleep(20);paint();}require(probeCalls&&!probeError.size(),probeError.empty()?"hook connection":probeError.c_str());
    symbol<void(__cdecl*)()>(client,"FixtureGuardEnable")();paint();require(probeError.empty(),probeError.c_str());require(symbol<int(__cdecl*)()>(client,"FixtureGuardPresent")(),"guard page ownership");
    player(0,2,0,2);paint();require(oldResult==L4P_ENTITY_STALE,"recycled index");oldRef={};paint();fire("game_newmap");paint();require(oldResult==L4P_ENTITY_STALE,"map epoch");fire("player_hurt");require(eventResult==L4P_BAD_ARGUMENT,"trace outside Paint");source.unsubscribe(token);
    L4P_EntityRefV1 ref{};require(entity.reference(1,&ref)==L4P_BAD_ARGUMENT,"entity outside callback");
    auto night=load(L"skeeto.night-vision");base=(root/L"bin/l4p/plugins/skeeto.night-vision").u8string();host.plugin_directory=base.c_str();require(night.second.init(&host)==L4P_OK,"night init");
    auto step=[&](){Sleep(36);paint();};step();Light value{};require(light(&value)&&value.radius==350&&value.origin[2]==188&&value.red==135&&value.green==138&&value.blue==132&&value.exponent==1,"night defaults/color/origin");require(traceWorld(),"world-only ceiling mask");
    std::vector<char> output(65536);uint32_t size=0;auto configure=[&](const char* settings){return night.second.invoke("configure",settings,output.data(),output.size(),&size);};
    require(configure("{\"preset\":\"custom\",\"brightness\":100,\"red\":10,\"green\":20,\"blue\":30,\"radius\":600}")==L4P_OK,"night configure");ceiling(120);step();require(light(&value)&&value.origin[2]==110&&value.red==10&&value.green==20&&value.blue==30&&value.radius==600,"ceiling clamp and custom color");
    char tiny='!';require(night.second.invoke("configure","{\"active\":false}",&tiny,1,&size)==L4P_BUFFER_TOO_SMALL,"configuration capacity");step();require(light(nullptr),"tiny buffer side effect");
    require(configure("{\"brightness\":201}")==L4P_BAD_ARGUMENT,"brightness bounds");require(configure("{\"active\":false}")==L4P_OK,"off");step();require(!light(nullptr),"off cleanup");require(configure("{\"active\":true}")==L4P_OK,"on");step();require(light(nullptr),"on resume");
    mode(2);paint();require(!light(nullptr),"remote scope immediate cleanup");mode(1);step();require(light(nullptr),"local resume");player(1,2,0,2);step();require(!light(nullptr),"death cleanup");player(0,2,1,2);step();require(!light(nullptr),"observer gate");player(0,3,0,2);step();require(!light(nullptr),"infected gate");player(0,2,0,2);step();require(light(nullptr),"survivor resume");
    reset();fire("game_newmap");step();require(light(nullptr),"map recreate");night.second.shutdown();paint();require(!light(nullptr),"unsubscribe cleanup");bridge.second.shutdown();
    require(fs::exists(fs::u8path(base)/L"config.json"),"independent configuration saved");std::cout<<"PASS: Entity serial/epoch, RecvTable types, Paint-only trace, scoped light lifecycle and night-vision settings\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
