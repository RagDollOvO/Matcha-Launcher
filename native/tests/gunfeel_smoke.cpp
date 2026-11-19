#define NOMINMAX
#include <windows.h>
#include "l4p_resource.h"
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
struct Info {int calls,guid,index,channel,pitch,recipient;float volume,attenuation,origin[3];char sample[260];};
int callbacks=0;void L4P_CALL frame(void*,const L4P_SourceFrameV1*){++callbacks;}
int wmain(int argc,wchar_t** argv){try{
    require(argc==4,"gunfeel_smoke <dist plugins> <fake DLL directory> <fresh root>");fs::path dist=fs::absolute(argv[1]),fake=fs::absolute(argv[2]),root=fs::absolute(argv[3]);require(!fs::exists(root),"fresh root");
    auto loadDll=[](const fs::path& p){auto m=LoadLibraryExW(p.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(m,"load DLL");return m;};
    auto engine=loadDll(fake/L"engine.dll"),client=loadDll(fake/L"client.dll"),vars=loadDll(fake/L"vstdlib.dll");
    auto paint=symbol<void(__cdecl*)()>(engine,"FixturePaint");auto mode=symbol<void(__cdecl*)(int)>(engine,"FixtureMode");auto weapon=symbol<void(__cdecl*)(const char*,int,int,uint32_t)>(client,"FixtureWeapon");
    auto raw=symbol<float(__cdecl*)(const char*,float)>(engine,"FixtureEmit");auto infoFn=symbol<void(__cdecl*)(void*)>(engine,"FixtureAudioInfo");auto active=symbol<int(__cdecl*)(int)>(engine,"FixtureAudioActive");
    auto set=symbol<void(__cdecl*)(const char*,float,int)>(vars,"FixtureSet");auto value=symbol<float(__cdecl*)(const char*)>(vars,"FixtureValue");auto step=[&](int ms=12){Sleep(ms);paint();};auto info=[&](){Info i{};infoFn(&i);return i;};
    auto load=[&](const wchar_t* id){auto dir=root/L"bin/l4p/plugins"/id;fs::create_directories(dir);fs::copy_file(dist/id/L"plugin.dll",dir/L"plugin.dll");auto m=loadDll(dir/L"plugin.dll");L4P_PluginApiV1 api{1,sizeof(api)};require(symbol<L4P_GetPluginApiFn>(m,"L4P_GetPluginApi")(1,&api)==L4P_OK,"plugin API");return std::make_pair(m,api);};
    auto bridge=load(L"beacon.source");auto base=(root/L"bin/l4p/plugins/beacon.source").u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,base.c_str(),"{}"};require(bridge.second.init(&host)==L4P_OK,"Source init");
    L4P_SourceApiV1 source{1,sizeof(source)};L4P_ResourceApiV1 resource{1,sizeof(resource)};require(symbol<L4P_GetSourceApiFn>(bridge.first,"L4P_GetSourceApi")(1,&source)==L4P_OK,"Source API");require(symbol<L4P_GetResourceApiFn>(bridge.first,"L4P_GetResourceApi")(1,&resource)==L4P_OK,"Resource API");uint32_t token=0;source.subscribe("fixture.observe",0,"",nullptr,frame,nullptr,&token);mode(1);for(int i=0;i<100&&!callbacks;++i)step(20);require(callbacks,"Paint hook");
    require(resource.claim(token,"test.resource")==L4P_BAD_ARGUMENT,"control claim refused");set("dsp_volume",1,0);set("dsp_off",0,0);
    auto dsp=load(L"skeeto.audio-positional");base=(root/L"bin/l4p/plugins/skeeto.audio-positional").u8string();host.plugin_directory=base.c_str();require(dsp.second.init(&host)==L4P_OK,"DSP init");step();require(value("dsp_volume")==0,"DSP initial lock");
    auto gun=load(L"skeeto.gunshot-feel");base=(root/L"bin/l4p/plugins/skeeto.gunshot-feel").u8string();host.plugin_directory=base.c_str();require(gun.second.init(&host)==L4P_OK,"GunFeel init");weapon("CRifle",30,0,1);step();char owner[65]{};resource.owner("skeeto.audio-processing",owner);require(!strcmp(owner,"skeeto.audio-positional.local"),"existing DSP owner retained");
    std::vector<char> output(65536);uint32_t size=0;auto configure=[&](L4P_PluginApiV1& api,const char* config){return api.invoke("configure",config,output.data(),output.size(),&size);};
    require(gun.second.invoke("status","{}",output.data(),output.size(),&size)==L4P_OK&&json::parse(output.data())["sections"][0]["items"][0]["code"]==5,"conflict visible");
    require(configure(dsp.second,"{\"active\":false}")==L4P_OK,"release DSP config");step();require(value("dsp_volume")==1,"DSP restored before handoff");resource.owner("skeeto.audio-processing",owner);require(!strcmp(owner,"skeeto.gunshot-feel"),"GunFeel acquires after restore");
    require(raw(")weapons\\ak47\\gunfire\\ak47_fire_1.wav",.8f)==.8f,"original volume preserved");weapon("CRifle",29,0,1);step();auto i=info();require(i.calls==1&&i.pitch==168&&std::abs(i.volume-.55f)<.001f&&!strcmp(i.sample,"weapons/ak47/gunfire/ak47_fire_1.wav"),"original path/normalized/punch layer");
    step();require(info().calls==1,"same clip");weapon("CRifle",25,0,1);step();require(info().calls==1,"multi-shot accumulated drop");weapon("CRifle",30,0,1);step();weapon("CRifle",0,1,1);step();require(info().calls==1,"magazine reload zero");weapon("CRifle",30,0,1);step();
    require(configure(dsp.second,"{\"active\":true}")==L4P_OK,"DSP requested while GunFeel owns");step();require(value("dsp_volume")==1,"blocked DSP preserves baseline");
    require(configure(gun.second,"{\"preset\":4}")==L4P_BAD_ARGUMENT,"preset bounds");char tiny='!';require(gun.second.invoke("configure","{\"active\":false}",&tiny,1,&size)==L4P_BUFFER_TOO_SMALL,"capacity before side effect");
    int count=info().calls;const int pitches[]={168,45,78,210};int clip=30;
    for(int preset=0;preset<4;++preset){auto config=json{{"preset",preset},{"gain",60}}.dump();require(configure(gun.second,config.c_str())==L4P_OK,"configure preset");step();raw("weapons/rifle/gunfire/rifle_fire_1.wav",1);weapon("CRifle",--clip,0,1);step();i=info();require(i.calls==++count&&i.pitch==pitches[preset]&&std::abs(i.volume-.6f)<.001f,"all four presets");if(preset==2){step(100);i=info();require(i.calls==++count&&i.pitch==58&&std::abs(i.volume-.33f)<.001f,"short tail delay and gain");}}
    configure(gun.second,"{\"preset\":0}");step();weapon("CRifle",--clip,0,1);step();require(info().calls==count,"waiting for matching sound");step(130);require(info().calls==++count&&!strcmp(info().sample,"weapons/rifle/gunfire/rifle_fire_1.wav"),"120ms fallback");
    weapon("CPumpShotgun",8,0,2);step();raw("weapons/shotgun/gunfire/shotgun_fire.wav",1);weapon("CPumpShotgun",7,1,2);step();require(info().calls==++count,"shotgun reload interruption");
    weapon("CRifle",30,0,3);step(270);raw("weapons/rifle/gunfire/rifle_fire_1.wav",1);weapon("CRifle",29,0,3);step(270);require(info().calls==count,"long gap rebaseline");
    int ownVoice=info().guid;require(configure(gun.second,"{\"active\":false}")==L4P_OK,"off");step();require(!active(ownVoice),"off voice stop");step(260);require(value("dsp_volume")==0,"waiting DSP resumes after release");
    mode(2);step();require(value("dsp_volume")==1,"local DSP scope restore");require(configure(gun.second,"{\"active\":true}")==L4P_OK,"on remote");step();resource.owner("skeeto.audio-processing",owner);require(!strcmp(owner,"skeeto.gunshot-feel"),"cosmetic scope on remote");
    mode(0);step();resource.owner("skeeto.audio-processing",owner);require(!*owner,"disconnect releases resource");gun.second.shutdown();dsp.second.shutdown();source.unsubscribe(token);bridge.second.shutdown();paint();std::cout<<"PASS: GunFeel source layers, clip/reload timing, settings, audio cleanup and DSP exclusion\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
