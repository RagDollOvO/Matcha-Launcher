#define NOMINMAX
#include <windows.h>
#include "l4p_sound.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <vector>
#include <cmath>
#include <atomic>
#include <thread>
using nlohmann::json;namespace fs=std::filesystem;
void require(bool value,const char* why){if(!value)throw std::runtime_error(why);}
void L4P_CALL log(void*,uint32_t,const char*){}
int wmain(int argc,wchar_t** argv){try{
    require(argc==5,"sound_smoke <dist plugins> <fixture dir> <fresh root> <normal|missing|duplicate>");
    auto dist=fs::absolute(argv[1]),fixture=fs::absolute(argv[2]),root=fs::absolute(argv[3]);std::wstring variant=argv[4];require(!fs::exists(root),"fresh root");auto plugins=root/L"bin/l4p/plugins";fs::create_directories(plugins);
    auto loadlib=[](const fs::path& p){auto h=LoadLibraryExW(p.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(h,"load library");return h;};
    auto engine=loadlib(fixture/L"engine.dll");
    auto paint=reinterpret_cast<void(__cdecl*)()>(GetProcAddress(engine,"FixturePaint"));auto emit=reinterpret_cast<float(__cdecl*)(const char*,float)>(GetProcAddress(engine,"FixtureEmit"));auto alter=reinterpret_cast<void(__cdecl*)(int)>(GetProcAddress(engine,"FixtureSoundVariant"));require(paint&&emit&&alter,"exports");
    if(variant==L"missing")alter(1);else if(variant==L"duplicate")alter(2);
    auto load=[&](const char* id){auto dir=plugins/fs::u8path(id);fs::create_directories(dir);fs::copy_file(dist/fs::u8path(id)/L"plugin.dll",dir/L"plugin.dll");auto h=loadlib(dir/L"plugin.dll");L4P_PluginApiV1 api{1,sizeof(api)};auto get=reinterpret_cast<L4P_GetPluginApiFn>(GetProcAddress(h,"L4P_GetPluginApi"));require(get&&get(1,&api)==0,"plugin ABI");return std::make_pair(h,api);};
    auto bridge=load("beacon.source");auto dir=(plugins/L"beacon.source").u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,dir.c_str(),"{}"};require(bridge.second.init(&host)==0,"source init");
    L4P_SoundApiV1 sound{1,sizeof(sound)};auto get=reinterpret_cast<L4P_GetSoundApiFn>(GetProcAddress(bridge.first,"L4P_GetSoundApi"));require(get&&get(1,&sound)==0,"sound ABI");
    L4P_SoundStatusV1 state{sizeof(state)};std::vector<char> out(65536);uint32_t size=0;
    auto mixer=load("skeeto.volume-mixer");dir=(plugins/L"skeeto.volume-mixer").u8string();host.plugin_directory=dir.c_str();host.config_json="{}";require(mixer.second.init(&host)==0,"mixer init");
    for(int i=0;i<20;++i){Sleep(20);paint();}sound.status(&state);require(state.state==0&&state.sounds==0,"100% has no hook");
    require(mixer.second.invoke("configure","{\"gunfire\":101}",out.data(),out.size(),&size)==L4P_BAD_ARGUMENT,"range");
    char tiny='!';require(mixer.second.invoke("configure","{\"gunfire\":50}",&tiny,1,&size)==L4P_BUFFER_TOO_SMALL,"small buffer");require(!fs::exists(plugins/L"skeeto.volume-mixer/config.json"),"small buffer no write");
    auto configure=[&](const json& values){auto text=values.dump();require(mixer.second.invoke("configure",text.c_str(),out.data(),out.size(),&size)==0,"configure");paint();};
    configure({{"gunfire",50}});sound.status(&state);
    if(variant!=L"normal"){require(state.state==3,"signature refusal");require(state.matched_signatures==(variant==L"duplicate"?2:0),"signature count");require(emit("weapons/rifle/gunfire/x.wav",.8f)==.8f,"unsupported passthrough");mixer.second.shutdown();bridge.second.shutdown();paint();std::wcout<<L"PASS sound "<<variant<<L"\n";return 0;}
    if(state.state!=2)std::cerr<<"sound state="<<state.state<<" matches="<<state.matched_signatures<<" filters="<<state.filters<<'\n';
    require(state.state==2,"sound hook installed");require(std::abs(emit("weapons/rifle/gunfire/x.wav",.8f)-.4f)<.0001,"scale once / original ABI preserved");
    std::ifstream file(dist/L"skeeto.volume-mixer/manifest.json");json manifest;file>>manifest;json all=json::object();for(auto& field:manifest["config"])if(field["id"]!="active")all[field["id"].get<std::string>()]=25;
    configure(all);
    const char* samples[]={"*#sound/WEAPONS\\rifle\\gunfire\\x.wav","weapons/smg/gunother/clipout.wav","player/survivor/hit/x.wav","weapons/chainsaw/loop.wav","player/footsteps/x.wav","player/survivor/voice/x.wav","player/hunter/voice/x.wav","npc/infected/x.wav","player/tank/voice/x.wav","npc/witch/x.wav","ambient/explosions/x.wav","weapons/molotov/fire_loop.wav","ambient/wind.wav","ui/click.wav","ambient/machines/c130_propeller.wav","player/items/x.wav","emsc/dryfire.mp3"};
    for(auto sample:samples)require(std::abs(emit(sample,.8f)-.2f)<.0001,"17 category routing");
    require(emit("custom/server/alert.wav",.8f)==.8f,"unknown unchanged");
    configure({{"gunfire",0}});require(emit(samples[0],.8f)==0,"mute");
    configure({{"active",false}});sound.status(&state);require(state.state==0&&state.filters==0,"off unpatch");require(emit(samples[0],.8f)==.8f,"off passthrough");
    configure({{"active",true}});require(emit(samples[0],.8f)==0,"re-enable");
    // Sound worker races repeated entry enable/restore: MinHook handles the IPs.
    std::atomic<bool> stop{false},bad{false};std::thread worker([&]{while(!stop){float v=emit("weapons/rifle/gunfire/x.wav",.8f);if(v!=0&&v!=.8f)bad=true;}});
    for(int i=0;i<8;++i)configure({{"active",bool(i&1)}});stop=true;worker.join();require(!bad,"worker passthrough / zero gain");
    require(mixer.second.invoke("status","{}",out.data(),out.size(),&size)==0,"status");auto report=json::parse(out.data());require(report["sections"][1]["items"].size()==17,"17 report rows");
    mixer.second.shutdown();paint();require(emit(samples[0],.8f)==.8f,"unsubscribe restores entry");
    host.config_json="{\"gunfire\":50}";require(mixer.second.init(&host)==0,"reinit");paint();require(emit(samples[0],.8f)==.4f,"reinit scale");
    // Preserve a later owner's edit rather than clobber it during restoration.
    alter(3);paint();sound.status(&state);require(state.state==5,"active foreign entry detected");require(emit(samples[0],.8f)==.8f,"foreign entry pass-through");
    configure({{"active",false}});sound.status(&state);require(state.state==5,"foreign entry preserved on disable");
    mixer.second.shutdown();bridge.second.shutdown();paint();std::cout<<"PASS sound: real x86 hook, 17 categories, 0/100%, unknowns, ABI, toggles, worker, teardown, config, foreign ownership\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
