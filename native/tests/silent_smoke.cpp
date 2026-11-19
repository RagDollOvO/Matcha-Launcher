#define NOMINMAX
#include <windows.h>
#include "l4p_audio.h"
#include <filesystem>
#include <iostream>
#include <vector>
#include <stdexcept>
namespace fs=std::filesystem;
void require(bool value,const char* why){if(!value)throw std::runtime_error(why);}
void L4P_CALL log(void*,uint32_t,const char*){}
template<class T>T symbol(HMODULE m,const char* name){auto p=reinterpret_cast<T>(GetProcAddress(m,name));require(p,name);return p;}
struct Info {int calls,guid,index,channel,pitch,recipient;float volume,attenuation,origin[3];char sample[260];};
L4P_AudioApiV1 audio{1,sizeof(audio)};uint32_t own=0,otherCode=0;int otherGuid=-1;bool playOther=false;int callbacks=0;
void L4P_CALL frame(void*,const L4P_SourceFrameV1*){++callbacks;if(!playOther)return;playOther=false;L4P_AudioEmitV1 input{sizeof(input)};input.volume=.5f;input.pitch=90;input.sample="fixture/other.wav";otherCode=audio.emit(own,&input,&otherGuid);}
int wmain(int argc,wchar_t** argv){try{
    require(argc==4,"silent_smoke <dist plugins> <fake engine/client> <fresh root>");fs::path dist=fs::absolute(argv[1]),fake=fs::absolute(argv[2]),root=fs::absolute(argv[3]);require(!fs::exists(root),"fresh root");
    auto loadDll=[](const fs::path& p){auto m=LoadLibraryExW(p.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(m,"load DLL");return m;};
    auto engine=loadDll(fake/L"engine.dll"),client=loadDll(fake/L"client.dll");auto mode=symbol<void(__cdecl*)(int)>(engine,"FixtureMode");auto paint=symbol<void(__cdecl*)()>(engine,"FixturePaint");auto fire=symbol<void(__cdecl*)(const char*)>(engine,"FixtureEvent");auto infected=symbol<void(__cdecl*)(int,int,int,int,uint32_t,float)>(client,"FixtureInfected");auto player=symbol<void(__cdecl*)(int,int,int,uint32_t)>(client,"FixturePlayer");
    auto infoFn=symbol<void(__cdecl*)(void*)>(engine,"FixtureAudioInfo");auto active=symbol<int(__cdecl*)(int)>(engine,"FixtureAudioActive");auto invalid=symbol<int(__cdecl*)()>(engine,"FixtureAudioInvalid");auto foreign=symbol<void(__cdecl*)()>(engine,"FixtureAudioForeign");
    auto info=[&](){Info i{};infoFn(&i);return i;};auto step=[&](){Sleep(105);paint();};
    auto load=[&](const wchar_t* id){auto dir=root/L"bin/l4p/plugins"/id;fs::create_directories(dir);fs::copy_file(dist/id/L"plugin.dll",dir/L"plugin.dll");auto m=loadDll(dir/L"plugin.dll");L4P_PluginApiV1 api{1,sizeof(api)};require(symbol<L4P_GetPluginApiFn>(m,"L4P_GetPluginApi")(1,&api)==L4P_OK,"plugin API");return std::make_pair(m,api);};
    auto bridge=load(L"beacon.source");std::string base=(root/L"bin/l4p/plugins/beacon.source").u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,base.c_str(),"{}"};require(bridge.second.init(&host)==L4P_OK,"Source init");
    L4P_SourceApiV1 source{1,sizeof(source)};require(symbol<L4P_GetSourceApiFn>(bridge.first,"L4P_GetSourceApi")(1,&source)==L4P_OK,"Source API");require(symbol<L4P_GetAudioApiFn>(bridge.first,"L4P_GetAudioApi")(1,&audio)==L4P_OK,"Audio API");
    require(source.subscribe("fixture.other",0,"",nullptr,frame,nullptr,&own)==L4P_OK,"other subscriber");mode(1);for(int i=0;i<100&&!callbacks;++i){Sleep(20);paint();}require(callbacks,"Paint connect");require(audio.prepare(own,"fixture/other.wav")==L4P_BAD_ARGUMENT,"control thread audio");
    foreign();playOther=true;paint();require(otherCode==L4P_OK&&active(otherGuid),"owned playback");
    infected(1,0,0,1,2,200);auto silent=load(L"skeeto.silent-si-fix");base=(root/L"bin/l4p/plugins/skeeto.silent-si-fix").u8string();host.plugin_directory=base.c_str();require(silent.second.init(&host)==L4P_OK,"silent init");int baseline=info().calls;step();require(info().calls==baseline,"initial existing suppression");
    fire("player_spawn");step();auto i=info();require(i.calls==baseline+1&&strstr(i.sample,"smoker_alert")&&i.index==2&&i.pitch==100&&i.recipient==1&&i.volume==1&&i.attenuation==.8f&&i.origin[0]==210,"spawn recipient/spatial ABI");
    int prior=i.guid;step();require(info().calls==i.calls,"no repeated spawn or close sound");
    infected(2,0,0,2,3,500);step();i=info();require(strstr(i.sample,"female_boomer_alert")&&i.calls==baseline+2,"serial reuse/female model");
    infected(2,0,0,2,3,200);step();require(info().calls==baseline+3,"distance crossing");infected(2,0,0,2,3,500);step();infected(2,0,0,2,3,200);step();require(info().calls==baseline+3,"4 second cooldown");Sleep(4050);step();require(info().calls==baseline+4,"rearmed after cooldown");
    std::vector<char> output(65536);uint32_t size=0;auto configure=[&](const char* input){return silent.second.invoke("configure",input,output.data(),output.size(),&size);};
    require(configure("{\"source\":\"invalid\"}")==L4P_BAD_ARGUMENT,"source enum");char tiny='!';require(silent.second.invoke("configure","{\"active\":false}",&tiny,1,&size)==L4P_BUFFER_TOO_SMALL,"capacity before save");
    require(configure("{\"source\":\"music\",\"proximity\":false}")==L4P_OK,"music settings");step();Sleep(460);step();require(strstr(info().sample,"smokerbacteria"),"configuration check sound");infected(3,0,0,1,4,200);step();require(strstr(info().sample,"hunterbacteria"),"music spawn source");
    int count=info().calls;infected(4,0,1,1,5,200);step();require(info().calls==count,"ghost gate");infected(4,0,0,1,5,200);step();require(info().calls==count+1,"materialized spawn");
    count=info().calls;player(1,2,0,1);infected(5,0,0,1,6,200);step();require(info().calls==count,"dead local gate");player(0,2,0,1);step();require(info().calls==count+1,"alive resumes");
    int current=info().guid;mode(2);paint();require(!active(current)&&active(otherGuid)&&active(99999),"scope stops only restricted owner");count=info().calls;infected(6,0,0,1,7,200);fire("player_spawn");step();require(info().calls==count,"remote event/frame gate");
    mode(1);step();require(info().calls==count,"local reentry suppress existing");fire("player_spawn");step();current=info().guid;require(strstr(info().sample,"chargerbacteria"),"local spawn after reentry");
    require(configure("{\"active\":false}")==L4P_OK,"off");step();require(!active(current)&&active(otherGuid)&&active(99999),"off cleanup isolation");
    silent.second.shutdown();source.unsubscribe(own);paint();require(!active(otherGuid)&&active(99999),"unsubscribe GUID cleanup");require(invalid()==0,"MSVC recipient and full EmitSound arguments");bridge.second.shutdown();std::cout<<"PASS: Native local audio ownership and SilentSi spawn/proximity/source/lifecycle\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
