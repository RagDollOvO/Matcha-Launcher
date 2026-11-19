// Isolated offline fixture. Never shipped with the desktop or copied to a game.
#include <cstdint>
#include <cstring>
#include "../plugins/skeeto.career/catalog.hpp"
static int mode=0, releases=0, calls=0, unexpected=0;
extern "C" __declspec(dllexport) void __cdecl FixtureSetMode(int value) { mode=value; calls=0; unexpected=0; }
extern "C" __declspec(dllexport) int __cdecl FixtureCount(int kind) { return kind==0 ? calls : kind==1 ? releases : unexpected; }
extern "C" __declspec(dllexport) void* __cdecl SteamAPI_SteamUserStats_v012() { return mode==3 ? nullptr : &mode; }
extern "C" __declspec(dllexport) void __cdecl SteamAPI_ReleaseCurrentThreadMemory() { ++releases; }
extern "C" __declspec(dllexport) bool __cdecl SteamAPI_ISteamUserStats_GetStatInt32(void* iface,const char* key,int32_t* out) {
    if (iface!=&mode || !key || !out) return false;
    ++calls;
    int index=-1;
    for (int i=0;i<23;++i) if (!std::strcmp(key,career::general[i].key)) index=i;
    for (int i=0;i<37;++i) if (!std::strcmp(key,career::weapons[i].key)) index=23+i;
    if(index<0) { ++unexpected; return false; }
    if(mode==2) return false;
    if(mode==1 && index==5) return false;
    if(mode==1 && index==6) { *out=-1; return true; }
    if(mode==4) { *out=0; return true; }
    if(index==0) *out=7200;
    else if(index==1) *out=42000;
    else if(index==2) *out=200;
    else if(index==3) *out=150;
    else if(index==4) *out=0;
    else if(index==23 || index==24) *out=900;
    else *out=index*7;
    return true;
}
