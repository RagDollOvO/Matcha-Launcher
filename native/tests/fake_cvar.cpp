// Owned offline MSVC-layout ConVar fixture; never distributed with the game.
#define NOMINMAX
#include <windows.h>
#include <map>
#include <string>
#include <memory>
#include <cstring>
#include <vector>
#include <set>
namespace {
struct Var {unsigned char bytes[0x34]{};std::string text;};
std::map<std::string,std::unique_ptr<Var>> vars;void* setters[4]{};void* table[13]{};struct Object{void** vtable;}object{table};
std::vector<std::unique_ptr<Var>> retired;
std::set<std::string> rejected;
std::string key(const char* text){std::string s=text;for(auto& c:s)if(c>='A'&&c<='Z')c+=32;return s;}
void __fastcall set(void* self,void*,float value){auto p=static_cast<unsigned char*>(self)-0x18;for(const auto& name:rejected){auto i=vars.find(name);if(i!=vars.end()&&i->second->bytes==p)return;}int flags=*reinterpret_cast<int*>(p+0x14);if(flags&((1<<1)|(1<<4)|(1<<14)))return;*reinterpret_cast<float*>(p+0x2c)=value;*reinterpret_cast<int*>(p+0x30)=int(value);}
void* __fastcall find(void*,void*,const char* name){auto it=vars.find(key(name));return it==vars.end()?nullptr:it->second->bytes;}
}
extern "C" __declspec(dllexport) void* __cdecl CreateInterface(const char* name,int*){if(strcmp(name,"VEngineCvar007"))return nullptr;if(!setters[2])setters[2]=reinterpret_cast<void*>(&set);table[10]=table[12]=reinterpret_cast<void*>(&find);return &object;}
extern "C" __declspec(dllexport) void __cdecl FixtureSet(const char* name,float value,int flags){auto& v=vars[key(name)];if(!v)v=std::make_unique<Var>();auto p=v->bytes;*reinterpret_cast<void***>(p+0x18)=setters;*reinterpret_cast<void**>(p+0x1c)=p;*reinterpret_cast<int*>(p+0x14)=flags;*reinterpret_cast<float*>(p+0x2c)=value;*reinterpret_cast<int*>(p+0x30)=int(value);}
extern "C" __declspec(dllexport) float __cdecl FixtureValue(const char* name){auto it=vars.find(key(name));return it==vars.end()?-999.f:*reinterpret_cast<float*>(it->second->bytes+0x2c);}
extern "C" __declspec(dllexport) int __cdecl FixtureFlags(const char* name){auto it=vars.find(key(name));return it==vars.end()?-999:*reinterpret_cast<int*>(it->second->bytes+0x14);}
extern "C" __declspec(dllexport) void __cdecl FixtureNativeSet(const char* name,float value){auto it=vars.find(key(name));if(it==vars.end())return;auto p=it->second->bytes+0x18;using Set=void(__thiscall*)(void*,float);reinterpret_cast<Set>((*reinterpret_cast<void***>(p))[2])(p,value);}
extern "C" __declspec(dllexport) void __cdecl FixtureRetarget(const char* name,float value,int flags){retired.push_back(std::move(vars[key(name)]));FixtureSet(name,value,flags);}
extern "C" __declspec(dllexport) void __cdecl FixtureReject(const char* name,int refuse){if(refuse)rejected.insert(key(name));else rejected.erase(key(name));}
extern "C" __declspec(dllexport) void __cdecl FixtureString(const char* name,const char* text){FixtureSet(name,0,0);auto& v=vars[key(name)];v->text=text;*reinterpret_cast<const char**>(v->bytes+0x24)=v->text.c_str();}
