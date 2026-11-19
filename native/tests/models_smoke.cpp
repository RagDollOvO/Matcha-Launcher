#define NOMINMAX
#include <windows.h>
#include "l4p_model.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <vector>
#include <thread>
#include <cmath>
using nlohmann::json;namespace fs=std::filesystem;
void require(bool b,const char* why){if(!b)throw std::runtime_error(why);}
bool approx(float a,float b){return std::abs(a-b)<.0001f;}
void L4P_CALL log(void*,uint32_t,const char*){}
template<class T>T symbol(HMODULE m,const char* name){auto fn=reinterpret_cast<T>(GetProcAddress(m,name));require(fn,name);return fn;}
L4P_ModelApiV1 models{1,sizeof(models)};L4P_EntityApiV1 entities{1,sizeof(entities)};L4P_EntityRefV1 ref{};uint32_t token=0,anyToken=0,result=0,anyResult=0;int frames=0,op=0;
void L4P_CALL onFrame(void*,const L4P_SourceFrameV1*){++frames;entities.reference(2,&ref);if(op){result=models.scale(token,&ref,3,L4P_MODEL_FIELD);anyResult=models.scale(anyToken,&ref,3,L4P_MODEL_FIELD);}}
void L4P_CALL empty(void*,const L4P_SourceFrameV1*){}
int wmain(int argc,wchar_t** argv){try{
    require(argc==5,"models_smoke <dist plugins> <source fixture dir> <model fixture dir> <fresh output>");fs::path dist=fs::absolute(argv[1]),fake=fs::absolute(argv[2]),clientDir=fs::absolute(argv[3]),root=fs::absolute(argv[4]);require(!fs::exists(root),"fresh output");
    auto loadDll=[](const fs::path& p){auto m=LoadLibraryExW(p.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(m,"load DLL");return m;};
    auto engine=loadDll(fake/L"engine.dll"),client=loadDll(clientDir/L"client.dll");loadDll(fake/L"vstdlib.dll");
    auto paint=symbol<void(__cdecl*)()>(engine,"FixturePaint");auto mode=symbol<void(__cdecl*)(int)>(engine,"FixtureMode");auto event=symbol<void(__cdecl*)(const char*)>(engine,"FixtureEvent");
    auto set=symbol<void(__cdecl*)(int,const char*,int,int,float)>(client,"FixtureModelSet");auto value=symbol<float(__cdecl*)(int)>(client,"FixtureModelValue");auto field=symbol<void(__cdecl*)(int,float)>(client,"FixtureModelField");auto receive=symbol<void(__cdecl*)(int,float,int)>(client,"FixtureModelReceive");
    auto build=symbol<void(__cdecl*)(int,int,int)>(client,"FixtureModelBuild");auto bone=symbol<float(__cdecl*)(int,int,int,int)>(client,"FixtureModelBone");auto errors=symbol<int(__cdecl*)()>(client,"FixtureModelErrors");auto foreign=symbol<int(__cdecl*)()>(client,"FixtureModelForeign");auto mutate=symbol<void(__cdecl*)(int,int)>(client,"FixtureModelMutate");
    set(1,"CTerrorPlayer",2,1,1);set(2,"C_TerrorPlayer",3,1,.8f);set(65,"Infected",3,1,1);set(66,"C_Witch",3,1,1);set(67,"CCharger",3,1,1);set(68,"CBaseViewModel",3,1,1);set(700,"Boomer",3,1,1);
    auto load=[&](const wchar_t* id){auto dir=root/L"bin/l4p/plugins"/id;fs::create_directories(dir);fs::copy_file(dist/id/L"plugin.dll",dir/L"plugin.dll");auto module=loadDll(dir/L"plugin.dll");L4P_PluginApiV1 api{1,sizeof(api)};require(symbol<L4P_GetPluginApiFn>(module,"L4P_GetPluginApi")(1,&api)==L4P_OK,"plugin API");return std::make_pair(module,api);};
    auto bridge=load(L"beacon.source");std::string directory=(root/L"bin/l4p/plugins/beacon.source").u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,directory.c_str(),"{}"};require(bridge.second.init(&host)==L4P_OK,"Source init");
    L4P_SourceApiV1 source{1,sizeof(source)};require(symbol<L4P_GetSourceApiFn>(bridge.first,"L4P_GetSourceApi")(1,&source)==L4P_OK,"Source API");require(symbol<L4P_GetModelApiFn>(bridge.first,"L4P_GetModelApi")(1,&models)==L4P_OK,"Model API");require(symbol<L4P_GetEntityApiFn>(bridge.first,"L4P_GetEntityApi")(1,&entities)==L4P_OK,"Entity API");
    source.subscribe("fixture.models",L4P_SOURCE_LOCAL,"",nullptr,onFrame,nullptr,&token);source.subscribe("fixture.any",L4P_SOURCE_ANY,"",nullptr,empty,nullptr,&anyToken);mode(1);for(int i=0;i<100&&!frames;++i){Sleep(20);paint();}require(frames,"Paint connected");
    auto state=[&](){L4P_ModelStatusV1 s{sizeof(s)};require(models.status(&s)==L4P_OK,"Model status");return s;};auto feature=load(L"skeeto.model-scale");directory=(root/L"bin/l4p/plugins/skeeto.model-scale").u8string();host.plugin_directory=directory.c_str();require(feature.second.init(&host)==L4P_OK,"feature init");
    paint();require(!state().leases&&approx(value(2),.8f),"default off");std::vector<char> output(65536);uint32_t size=0;auto configure=[&](const json& p){auto s=p.dump();return feature.second.invoke("configure",s.c_str(),output.data(),output.size(),&size);};
    require(configure({{"active",true},{"special",2},{"common",.5}})==L4P_OK,"configure");paint();require(state().leases==4&&approx(value(2),2)&&approx(value(1),1)&&approx(value(68),1),"player field and exclusions");paint();paint();require(state().leases==5,"bounded high entity scan");
    build(65,3,0);require(approx(bone(65,0,0,0),.5f)&&approx(bone(65,0,0,3),10.5f)&&approx(bone(65,1,0,0),1)&&approx(bone(65,1,0,3),12),"common origin pivot and native bone mask");
    for(int i:{66,67,700}){build(i,3,0);require(approx(bone(i,0,0,0),2)&&approx(bone(i,2,2,3),36)&&approx(value(i),1),"AI SI Witch bones without field stack");}
    receive(2,.7f,2);require(approx(value(2),2),"RecvProxy overrides owned entity");receive(1,.9f,1);require(approx(value(1),.9f),"RecvProxy ignores unowned survivor");
    op=1;paint();op=0;require(result==5&&anyResult==6,"exclusive owner and LOCAL subscription");require(models.scale(token,&ref,2,0)==L4P_BAD_ARGUMENT,"control thread write gate");
    std::thread worker([&](){build(65,3,0);receive(2,.6f,2);});worker.join();require(approx(bone(65,0,0,0),1)&&approx(value(2),.6f),"native foreign-thread forwarding");paint();require(approx(value(2),2),"next Paint reapplies field");
    build(65,129,0);require(approx(bone(65,0,0,0),1)&&state().read_failures,"invalid studio count kept native");
    configure({{"active",false}});paint();require(!state().leases&&!state().build_hooks&&!state().proxy_hooks&&approx(value(2),.6f),"off restores latest native baseline and slots");
    configure({{"active",true}});paint();receive(2,.65f,2);mode(2);paint();require(approx(value(2),.65f)&&!state().leases&&!state().proxy_hooks,"remote scope exit recovery");mode(1);paint();require(approx(value(2),2),"local reentry");
    set(2,"CTerrorPlayer",2,2,.9f);paint();require(approx(value(2),.9f),"serial-reused survivor kept native");set(2,"CTerrorPlayer",3,3,.8f);paint();require(approx(value(2),2),"new infected serial rebound");
    configure({{"active",false}});field(2,.77f);paint();require(approx(value(2),.77f),"off preserves external field change");
    configure({{"active",true},{"special",1},{"common",.5}});paint();require(approx(value(2),.77f),"one releases category");configure({{"special",2}});paint();field(2,.85f);event("game_newmap");paint();configure({{"active",false}});paint();require(approx(value(2),.85f),"map epoch abandons old lease and captures new baseline");
    require(configure({{"common",.09}})==L4P_BAD_ARGUMENT&&configure({{"special",5.1}})==L4P_BAD_ARGUMENT,"original range");char tiny='!';require(feature.second.invoke("configure","{\"active\":true}",&tiny,1,&size)==L4P_BUFFER_TOO_SMALL,"capacity before save");paint();require(!state().leases,"small output no side effect");
    configure({{"active",true}});paint();mutate(65,0);paint();require(state().conflicts&&state().leases>0,"foreign hook detected");build(65,3,1);require(approx(bone(65,0,0,0),1),"retained thunk forwards its own original after conflict");build(65,3,0);require(foreign()==1,"foreign Build preserved");mutate(2,1);paint();require(!state().leases,"foreign proxy releases affected leases");receive(2,.95f,2);require(approx(value(2),.95f)&&foreign()==2,"foreign RecvProxy preserved");
    feature.second.shutdown();paint();require(!state().leases&&!state().build_hooks&&!state().proxy_hooks&&!errors(),"shutdown and native ABI");source.unsubscribe(token);source.unsubscribe(anyToken);bridge.second.shutdown();paint();
    std::cout<<"PASS: model fields/proxies/bones, classification, serial/map identity, original-value restoration, local/thread gates, conflicts and settings; "<<root.u8string()<<'\n';return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
