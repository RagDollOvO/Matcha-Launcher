#define NOMINMAX
#include <windows.h>
#include <cstring>
namespace {
wchar_t stock[]=L"游戏 / Mod 名称",other[]=L"普通文字";
void* table[3]{};struct Obj{void** table;}object{table};void* predecessor=nullptr;
wchar_t* __fastcall find(void*,void*,const char* key){return key&&strstr(key,"L4D360UI_")?stock:other;}
wchar_t* __fastcall chain(void* self,void*,const char* key){using Fn=wchar_t*(__thiscall*)(void*,const char*);return reinterpret_cast<Fn>(predecessor)(self,key);}
}
extern "C" __declspec(dllexport) void* __cdecl CreateInterface(const char* name,int*){if(!table[2])table[2]=reinterpret_cast<void*>(&find);return !strcmp(name,"VGUI_Localize005")?&object:nullptr;}
extern "C" __declspec(dllexport) const wchar_t* __cdecl FixtureLocalize(const char* key){CreateInterface("VGUI_Localize005",nullptr);using Fn=wchar_t*(__thiscall*)(void*,const char*);return reinterpret_cast<Fn>(table[2])(&object,key);}
extern "C" __declspec(dllexport) void __cdecl FixtureLocalizeChain(int on){if(on){predecessor=table[2];table[2]=reinterpret_cast<void*>(&chain);}else table[2]=predecessor;}
extern "C" __declspec(dllexport) int __cdecl FixtureLocalizeOwned(){return table[2]!=reinterpret_cast<void*>(&find);}
