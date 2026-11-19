// Owned IEngineSoundClient003 ABI fixture and model names. Never packaged.
#define NOMINMAX
#include <windows.h>
#include <set>
#include <map>
#include <string>
#include <cstring>
#include <vector>
namespace {
void* soundTable[17]{};void* modelTable[4]{};struct Obj{void** vt;}sound{soundTable},models{modelTable};
struct Info {int calls,guid,index,channel,pitch,recipient;float volume,attenuation,origin[3];char sample[260];};Info info{};
int next=100,last=-1,invalid=0;bool available=true;std::set<int> playing;std::map<std::pair<int,int>,int> channels;
bool requireMount=false;std::vector<Info> history;
bool sample_ready(const char* sample){if(!available)return false;if(!requireMount||!strncmp(sample,"player/footsteps/",17)||!strncmp(sample,"weapons/rifle/gunfire/",21))return true;
    auto dll=GetModuleHandleW(L"filesystem_stdio.dll");using Fn=int(__cdecl*)(const char*);auto mounted=dll?reinterpret_cast<Fn>(GetProcAddress(dll,"FixtureFsMounted")):nullptr;return mounted&&mounted((std::string("sound/")+sample).c_str());}
bool __fastcall prepare(void*,void*,const char* sample,bool,bool){return sample_ready(sample);}
bool __fastcall cached(void*,void*,const char* sample){return sample_ready(sample);}
void __fastcall emit(void*,void*,void* filter,int entity,int channel,const char* sample,float volume,float attenuation,int flags,int pitch,const float* origin,const float* direction,void* origins,bool update,float time,int speaker){
    auto vt=*static_cast<void***>(filter);using Bool=bool(__thiscall*)(void*);using Int=int(__thiscall*)(void*);using Index=int(__thiscall*)(void*,int);
    int recipient=reinterpret_cast<Index>(vt[4])(filter,0);
    if(reinterpret_cast<Bool>(vt[1])(filter)||reinterpret_cast<Bool>(vt[2])(filter)||reinterpret_cast<Int>(vt[3])(filter)!=1||recipient!=1||flags||direction||origins||!update||time||speaker!=-1)++invalid;
    if(!available)return;auto key=std::make_pair(entity,channel);if(channels.count(key))playing.erase(channels[key]);
    last=++next;playing.insert(last);channels[key]=last;++info.calls;info.guid=last;info.index=entity;info.channel=channel;info.pitch=pitch;info.recipient=recipient;info.volume=volume;info.attenuation=attenuation;
    if(origin)memcpy(info.origin,origin,12);else memset(info.origin,0,12);strncpy(info.sample,sample,259);history.push_back(info);
}
int __fastcall guid(void*,void*){return last;}
bool __fastcall active(void*,void*,int id){return playing.count(id)!=0;}
void __fastcall stop(void*,void*,int id){playing.erase(id);}
const char* male="models/infected/boomer.mdl";const char* female="models/infected/boomette.mdl";
std::map<int,std::string> modelNames;
void* __fastcall model(void*,void*,int index){auto i=modelNames.find(index);if(i!=modelNames.end())return const_cast<char*>(i->second.c_str());return index==1?const_cast<char*>(male):index==2?const_cast<char*>(female):nullptr;}
const char* __fastcall modelName(void*,void*,void* object){return static_cast<const char*>(object);}
}
void* FixtureAudioInterface(const char* name){soundTable[0]=reinterpret_cast<void*>(&prepare);soundTable[1]=reinterpret_cast<void*>(&cached);soundTable[6]=reinterpret_cast<void*>(&emit);soundTable[14]=reinterpret_cast<void*>(&guid);soundTable[15]=reinterpret_cast<void*>(&active);soundTable[16]=reinterpret_cast<void*>(&stop);modelTable[1]=reinterpret_cast<void*>(&model);modelTable[3]=reinterpret_cast<void*>(&modelName);
    if(!strcmp(name,"IEngineSoundClient003"))return &sound;if(!strcmp(name,"VModelInfoClient004"))return &models;return nullptr;}
extern "C" __declspec(dllexport) void __cdecl FixtureAudioInfo(void* out){memcpy(out,&info,sizeof(info));}
extern "C" __declspec(dllexport) int __cdecl FixtureAudioInvalid(){return invalid;}
extern "C" __declspec(dllexport) void __cdecl FixtureAudioAvailable(int value){available=value!=0;}
extern "C" __declspec(dllexport) int __cdecl FixtureAudioActive(int id){return playing.count(id)!=0;}
extern "C" __declspec(dllexport) void __cdecl FixtureAudioForeign(){playing.insert(99999);}
extern "C" __declspec(dllexport) void __cdecl FixtureModelName(int index,const char* name){modelNames[index]=name;}
extern "C" __declspec(dllexport) void __cdecl FixtureAudioMounts(int value){requireMount=value!=0;}
extern "C" __declspec(dllexport) int __cdecl FixtureAudioHistory(int index,void* out){if(index<0||size_t(index)>=history.size())return 0;memcpy(out,&history[index],sizeof(Info));return 1;}
