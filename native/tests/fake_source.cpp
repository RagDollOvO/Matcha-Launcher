// Owned offline Source ABI fixture. Never copied to dist or a real game.
#define NOMINMAX
#include <windows.h>
#include <string>
#include <map>
#include <set>
#include <cstring>
#include <vector>
void* FixtureEffectsInterface(const char*);
void* FixtureAudioInterface(const char*);
float FixtureEffectsTime();
namespace {
int mode=0,commands=0,playerLimit=64;std::string lastCommand,mapName="c1m1_hotel";
void(__cdecl* commandSink)(const char*)=nullptr;
struct PlayerData{std::string name;int user,bot;};std::map<int,PlayerData> playerOverrides;
std::map<std::string,std::string> bindings{{"+reload","r"},{"+attack","MOUSE1"},{"+attack2","MOUSE2"}};
std::map<std::string,int> eventValues;
bool gameUi=false;float viewAngles[3]{};int viewWrites=0;void* modelInfo=nullptr;
std::map<std::string,float> eventFloats;
float matrix[16]={1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1};
void* engineTable[108]{};void* paintTable[15]{};void* managerTable[6]{};
struct Object{void** table;}engine{engineTable},vgui{paintTable},manager{managerTable};
std::map<void*,std::set<std::string>> listeners;
int __fastcall noop(void*,void*){return 0;}
bool __fastcall connected(void*,void*){return mode!=0;}
bool __fastcall inGame(void*,void*){return mode!=0;}
bool __fastcall loading(void*,void*){return mode==3;}
int __fastcall local(void*,void*){return 1;}
float __fastcall timestamp(void*,void*){return FixtureEffectsTime();}
const float* __fastcall worldMatrix(void*,void*){return matrix;}
bool __fastcall uiVisible(void*,void*){return gameUi;}
void __fastcall angles(void*,void*,float* out){memcpy(out,viewAngles,sizeof(viewAngles));}
void __fastcall setAngles(void*,void*,const float* in){memcpy(viewAngles,in,sizeof(viewAngles));++viewWrites;}
bool __fastcall player(void*,void*,int index,void* info){if(index<1||index>playerLimit)return false;std::memset(info,0,380);auto i=playerOverrides.find(index);
    strncpy(static_cast<char*>(info)+8,i==playerOverrides.end()?(index==1?"Fixture player":"Fixture infected"):i->second.name.c_str(),31);
    *reinterpret_cast<int*>(static_cast<char*>(info)+40)=i==playerOverrides.end()?index+6:i->second.user;static_cast<char*>(info)[116]=i==playerOverrides.end()?0:i->second.bot;return true;}
int __fastcall playerForUser(void*,void*,int id){return id>=7&&id<=8?id-6:0;}
bool __fastcall loopback(void*,void*){return mode==1||mode==3;}
void* channelTable[7]{};Object channel{channelTable};
void* __fastcall net(void*,void*){return &channel;}
void __fastcall cmd(void*,void*,const char* text){++commands;lastCommand=text;if(commandSink)commandSink(text);}
const char* __fastcall binding(void*,void*,const char* command){auto i=bindings.find(command);return i==bindings.end()?nullptr:i->second.c_str();}
void __fastcall originalPaint(void*,void*,int){}
bool __fastcall add(void*,void*,void* listener,const char* name,bool){listeners[listener].insert(name);return true;}
void __fastcall remove(void*,void*,void* listener){listeners.erase(listener);}
void init(){static bool initialized=false;if(initialized)return;initialized=true;
    for(auto& f:engineTable)f=reinterpret_cast<void*>(&noop);for(auto& f:paintTable)f=reinterpret_cast<void*>(&noop);for(auto& f:managerTable)f=reinterpret_cast<void*>(&noop);
    engineTable[7]=engineTable[107]=reinterpret_cast<void*>(&cmd);engineTable[8]=reinterpret_cast<void*>(&player);engineTable[9]=reinterpret_cast<void*>(&playerForUser);engineTable[12]=reinterpret_cast<void*>(&local);engineTable[15]=reinterpret_cast<void*>(&timestamp);engineTable[26]=reinterpret_cast<void*>(&inGame);engineTable[27]=reinterpret_cast<void*>(&connected);engineTable[28]=reinterpret_cast<void*>(&loading);engineTable[74]=reinterpret_cast<void*>(&net);
    paintTable[14]=reinterpret_cast<void*>(&originalPaint);managerTable[3]=reinterpret_cast<void*>(&add);managerTable[5]=reinterpret_cast<void*>(&remove);channelTable[6]=reinterpret_cast<void*>(&loopback);
    engineTable[37]=reinterpret_cast<void*>(&worldMatrix);
    engineTable[19]=reinterpret_cast<void*>(&angles);engineTable[20]=reinterpret_cast<void*>(&setAngles);paintTable[2]=reinterpret_cast<void*>(&uiVisible);
    engineTable[22]=reinterpret_cast<void*>(&binding);
}
struct Event{void** table;const char* name;};
const char* __fastcall name(void* e,void*){return static_cast<Event*>(e)->name;}
int __fastcall integer(void*,void*,const char* key,int fallback){auto i=eventValues.find(key);if(i!=eventValues.end())return i->second;return !strcmp(key,"attacker")?7:!strcmp(key,"userid")?8:fallback;}
float __fastcall number(void*,void*,const char* key,float fallback){auto i=eventFloats.find(key);return i==eventFloats.end()?fallback:i->second;}
std::map<std::string,std::string> eventTexts;
const char* __fastcall text(void*,void*,const char* key,const char* fallback){auto i=eventTexts.find(key);return i!=eventTexts.end()?i->second.c_str():!strcmp(key,"mapname")?mapName.c_str():fallback;}
}
extern "C" __declspec(dllexport) void* __cdecl CreateInterface(const char* name,int*){init();if(!strcmp(name,"VEngineClient013"))return &engine;if(!strcmp(name,"VEngineVGui001"))return &vgui;if(!strcmp(name,"GAMEEVENTSMANAGER002"))return &manager;if(!strcmp(name,"VModelInfoClient004"))return modelInfo;if(auto found=FixtureEffectsInterface(name))return found;return FixtureAudioInterface(name);}
extern "C" __declspec(dllexport) void __cdecl FixtureModelInfo(void* object){modelInfo=object;}
extern "C" __declspec(dllexport) void __cdecl FixtureEventFloat(const char* key,float value){eventFloats[key]=value;}
extern "C" __declspec(dllexport) void __cdecl FixtureEventText(const char* key,const char* value){eventTexts[key]=value;}
extern "C" __declspec(dllexport) void __cdecl FixtureMode(int value){mode=value;}
extern "C" __declspec(dllexport) void __cdecl FixturePlayerLimit(int value){playerLimit=value;}
extern "C" __declspec(dllexport) void __cdecl FixturePlayer(int index,const char* name,int user,int bot){playerOverrides[index]={name,user,bot};}
extern "C" __declspec(dllexport) void __cdecl FixtureMap(const char* name){mapName=name;}
extern "C" __declspec(dllexport) void __cdecl FixtureBinding(const char* command,const char* key){bindings[command]=key;}
extern "C" __declspec(dllexport) void __cdecl FixtureEventInt(const char* key,int value){eventValues[key]=value;}
extern "C" __declspec(dllexport) void __cdecl FixtureView(int ui,float pitch,float yaw,float roll){gameUi=ui!=0;viewAngles[0]=pitch;viewAngles[1]=yaw;viewAngles[2]=roll;}
extern "C" __declspec(dllexport) int __cdecl FixtureViewWrites(float* out){memcpy(out,viewAngles,sizeof(viewAngles));return viewWrites;}
extern "C" __declspec(dllexport) int __cdecl FixtureCommands(){return commands;}
extern "C" __declspec(dllexport) const char* __cdecl FixtureLastCommand(){return lastCommand.c_str();}
extern "C" __declspec(dllexport) void __cdecl FixtureCommandSink(void(__cdecl* sink)(const char*)){commandSink=sink;}
extern "C" __declspec(dllexport) void __cdecl FixturePaint(){init();using Fn=void(__thiscall*)(void*,int);reinterpret_cast<Fn>(paintTable[14])(&vgui,2);}
extern "C" __declspec(dllexport) void __cdecl FixturePaintMode(int mode){init();using Fn=void(__thiscall*)(void*,int);reinterpret_cast<Fn>(paintTable[14])(&vgui,mode);}
extern "C" __declspec(dllexport) void __cdecl FixtureEvent(const char* eventName){void* table[10]{};table[1]=reinterpret_cast<void*>(&name);table[6]=reinterpret_cast<void*>(&integer);table[8]=reinterpret_cast<void*>(&number);table[9]=reinterpret_cast<void*>(&text);Event event{table,eventName};
    auto copy=listeners;for(auto& p:copy)if(p.second.count(eventName)){using Fn=void(__thiscall*)(void*,void*);reinterpret_cast<Fn>((*static_cast<void***>(p.first))[1])(p.first,&event);}}
