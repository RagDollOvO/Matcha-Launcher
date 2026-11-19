#pragma once
#include "sdk.h"
namespace controls {
inline bool EqualBytes(const unsigned char* p,const unsigned char* expected,unsigned size){
    if(!Readable(p,size))return false;
    for(unsigned i=0;i<size;++i)if(p[i]!=expected[i])return false;
    return true;
}
inline bool EngineProfile(unsigned char* base){
    if(!Readable(base,0x1000)||*(unsigned short*)base!=0x5a4d)return false;
    unsigned nt=*(unsigned*)(base+0x3c);
    return nt<=0xe00&&*(unsigned*)(base+nt)==0x4550&&*(unsigned short*)(base+nt+4)==0x14c&&
        *(unsigned*)(base+nt+8)==0x6a440ed6&&*(unsigned*)(base+nt+0x50)==0x73f000;
}
inline void* FindVar(void* cvars,const char* name){return MethodOK(cvars,12)?VCall<void*(__thiscall*)(void*,const char*)>(cvars,12)(cvars,name):nullptr;}
// Only called after the caller validates the pinned engine image and its
// VEngineCvar007 instance. This lookup is read-only.
inline const char* ReadString(void* var){
    auto p=static_cast<const unsigned char*>(var);
    if(!Readable(p,40))return nullptr;
    p=*(const unsigned char* const*)(p+0x1c);
    return Readable(p,40)?*(const char* const*)(p+0x24):nullptr;
}
}
