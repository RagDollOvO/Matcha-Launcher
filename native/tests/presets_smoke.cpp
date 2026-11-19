#define NOMINMAX
#include <windows.h>
#include "l4p_cvar.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <vector>
#include <stdexcept>
using nlohmann::json;namespace fs=std::filesystem;
void require(bool value,const std::string& why){if(!value)throw std::runtime_error(why);}
void L4P_CALL log(void*,uint32_t,const char*){}
json read(const fs::path& p){std::ifstream f(p);json result;f>>result;return result;}
L4P_SourceApiV1 sdk{1,sizeof(sdk)};L4P_CvarApiV1 cvar{1,sizeof(cvar)};uint32_t owner=0,other=0;uint32_t ownCode=99,otherCode=99;
void L4P_CALL callback(void*,const L4P_SourceFrameV1*){ownCode=cvar.pin(owner,"lease_test",7);otherCode=cvar.pin(other,"lease_test",9);}
void L4P_CALL noop(void*,const L4P_SourceFrameV1*){}
int wmain(int argc,wchar_t** argv){try{
    require(argc==5,"presets_smoke <dist plugins> <fixture dll dir> <fresh game root> <report.json>");
    auto dist=fs::absolute(argv[1]),fixtures=fs::absolute(argv[2]),root=fs::absolute(argv[3]);require(!fs::exists(root),"fresh fixture required");
    auto plugins=root/L"bin/l4p/plugins";fs::create_directories(plugins);
    auto loadlib=[](const fs::path& p){auto h=LoadLibraryExW(p.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(h,"load DLL "+p.u8string());return h;};
    auto engine=loadlib(fixtures/L"engine.dll"),variables=loadlib(fixtures/L"vstdlib.dll");
    auto paint=reinterpret_cast<void(__cdecl*)()>(GetProcAddress(engine,"FixturePaint"));auto mode=reinterpret_cast<void(__cdecl*)(int)>(GetProcAddress(engine,"FixtureMode"));auto fire=reinterpret_cast<void(__cdecl*)(const char*)>(GetProcAddress(engine,"FixtureEvent"));
    auto set=reinterpret_cast<void(__cdecl*)(const char*,float,int)>(GetProcAddress(variables,"FixtureSet"));auto value=reinterpret_cast<float(__cdecl*)(const char*)>(GetProcAddress(variables,"FixtureValue"));auto flags=reinterpret_cast<int(__cdecl*)(const char*)>(GetProcAddress(variables,"FixtureFlags"));
    require(paint&&mode&&fire&&set&&value&&flags,"fixture exports");
    auto nativeSet=reinterpret_cast<void(__cdecl*)(const char*,float)>(GetProcAddress(variables,"FixtureNativeSet"));
    auto retarget=reinterpret_cast<void(__cdecl*)(const char*,float,int)>(GetProcAddress(variables,"FixtureRetarget"));require(nativeSet&&retarget,"setter fixture exports");
    auto load=[&](const std::string& id){auto dir=plugins/fs::u8path(id);fs::create_directories(dir);fs::copy_file(dist/fs::u8path(id)/L"plugin.dll",dir/L"plugin.dll");auto h=loadlib(dir/L"plugin.dll");L4P_PluginApiV1 a{1,sizeof(a)};auto get=reinterpret_cast<L4P_GetPluginApiFn>(GetProcAddress(h,"L4P_GetPluginApi"));require(get&&get(1,&a)==L4P_OK,"plugin ABI");return std::make_pair(h,a);};
    auto bridge=load("beacon.source");auto dir=(plugins/L"beacon.source").u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,dir.c_str(),"{}"};require(bridge.second.init(&host)==L4P_OK,"bridge init");
    auto get=reinterpret_cast<L4P_GetSourceApiFn>(GetProcAddress(bridge.first,"L4P_GetSourceApi"));auto getCvar=reinterpret_cast<L4P_GetCvarApiFn>(GetProcAddress(bridge.first,"L4P_GetCvarApi"));require(get&&get(1,&sdk)==L4P_OK&&getCvar&&getCvar(1,&cvar)==L4P_OK,"SDK negotiation");
    require(cvar.pin(1,"lease_test",3)==L4P_BAD_ARGUMENT,"control thread write refused");
    set("lease_test",2,1<<14);mode(1);
    require(sdk.subscribe("test.owner",1,"",nullptr,callback,nullptr,&owner)==L4P_OK,"owner subscribe");require(sdk.subscribe("test.other",1,"",nullptr,noop,nullptr,&other)==L4P_OK,"other subscribe");
    for(int i=0;i<100&&ownCode==99;++i){Sleep(20);paint();}
    require(ownCode==L4P_OK&&value("lease_test")==7,"lease setter");require(flags("lease_test")==1<<14,"flags restored");require(otherCode==L4P_CVAR_CONFLICT,"owner conflict");
    mode(2);fire("server_spawn");require(value("lease_test")==2,"scope restoration before native event");
    mode(1);paint();require(value("lease_test")==7,"local reentry");sdk.unsubscribe(owner);sdk.unsubscribe(other);paint();require(value("lease_test")==2,"unsubscribe restoration");
    std::vector<char> output(256*1024);uint32_t size=0;
    for(const auto* id:{"skeeto.view-tilt","skeeto.client-perf","skeeto.combat-declutter","skeeto.audio-positional","skeeto.forced-cvars","skeeto.local-debug"}){
        auto definition=read(dist/fs::u8path(id)/L"source/preset.json");json config=json::object();
        for(auto& p:definition["fields"].items())config[p.key()]=p.value()["type"]=="boolean"?json(true):p.value()["default"].get<int>()==0?json(1):p.value()["default"];
        for(auto& e:definition["entries"]){std::string name=e["name"];set(name.c_str(),0.125f,name=="sv_rollangle"||name=="sv_rollspeed"?1<<13:0);}
        auto plugin=load(id);std::string pluginDir=(plugins/fs::u8path(id)).u8string(),input=config.dump();host.plugin_directory=pluginDir.c_str();host.config_json=input.c_str();require(plugin.second.init(&host)==L4P_OK,std::string(id)+" init");paint();
        require(plugin.second.invoke("status","{}",output.data(),output.size(),&size)==L4P_OK,"status");auto report=json::parse(output.data());require(report["sections"][0]["items"].size()==definition["entries"].size(),"complete table");
        for(auto& row:report["sections"][0]["items"])require(row["code"]==L4P_OK,std::string(id)+" apply "+row["label"].get<std::string>());
        if(!strcmp(id,"skeeto.client-perf")){std::ofstream f(fs::path(argv[4]),std::ios::binary);f<<report.dump(2);}
        if(!strcmp(id,"skeeto.audio-positional")){
            nativeSet("dsp_volume",.8f);require(value("dsp_volume")==0,"immediate native clamp before Paint");
            set("other_dsp",.125f,0);nativeSet("other_dsp",.8f);require(value("other_dsp")==.8f,"same vtable unrelated variable passthrough");
            mode(2);nativeSet("dsp_volume",.75f);require(value("dsp_volume")==.75f,"remote native write refreshes scope before Paint");
            mode(1);Sleep(260);paint();nativeSet("dsp_volume",.9f);require(value("dsp_volume")==0,"reentry clamp");
            retarget("dsp_volume",.125f,0);Sleep(260);paint();nativeSet("dsp_volume",.9f);require(value("dsp_volume")==0,"new variable identity clamp");
        }
        char tiny='!';require(plugin.second.invoke("configure","{\"active\":false}",&tiny,1,&size)==L4P_BUFFER_TOO_SMALL,"tiny capacity");require(!fs::exists(plugins/fs::u8path(id)/L"config.json"),"tiny no persistence");
        require(plugin.second.invoke("configure","{\"active\":false}",output.data(),output.size(),&size)==L4P_OK,"disable");paint();
        for(auto& e:definition["entries"])require(value(e["name"].get<std::string>().c_str())==0.125f,std::string(id)+" restore "+e["name"].get<std::string>());
        require(read(plugins/fs::u8path(id)/L"config.json")["active"]==false,"config saved");plugin.second.shutdown();paint();std::cout<<"PASS "<<id<<"\n";
        if(!strcmp(id,"skeeto.audio-positional")){nativeSet("dsp_volume",.6f);require(value("dsp_volume")==.6f,"disabled setter restored");}
    }
    bridge.second.shutdown();paint();std::cout<<"PASS: leases, conflict, local/remote gate, flags, all preset rows, independent off, config and small-buffer behavior\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
