#pragma once
#include "sdk.h"

// Model lookup hooks have their own profile; they must not depend on the
// legacy private-menu profile after switching to L4N's public menu API.
namespace l4n_model {
struct Profile {unsigned timestamp,imageSize,lookup,original,manager,customLookup;};
static const Profile profiles[]={
    {0x6ab76b51u,0x1de000u,0xa8460u,0x1b4028u,0x1b7724u,0xc9aa0u}, // 2.49.1
    {0x6ac0ba1eu,0x22f000u,0xaeaf0u,0x2002e0u,0x203a24u,0xd0340u}  // 2.50.3
};
inline bool Verify(unsigned char* base,const Profile& p){
    // Check the complete dispatch stub, including both relocated pointers
    // and the relative jump. Negative custom indices go to L4N; normal
    // brush indices tail-call the original engine method with ECX intact.
    static const unsigned char code[]={0x8b,0x54,0x24,0x04,0x83,0xfa,0xff,0x7d,0x0e,0x89,0x54,0x24,0x04,0xb9,0,0,0,0,0xe9,0,0,0,0,0xa1,0,0,0,0,0x89,0x54,0x24,0x04,0xff,0xe0};
    auto stub=base+p.lookup;
    if(!Readable(stub,sizeof code)||!Executable(stub)||!Executable(base+p.customLookup)||!Readable(base+p.original,4)||!Readable(base+p.manager,4))return false;
    for(unsigned i=0;i<sizeof code;++i){if((i>=14&&i<18)||(i>=19&&i<23)||(i>=24&&i<28))continue;if(stub[i]!=code[i])return false;}
    return *(unsigned*)(stub+14)==unsigned(base+p.manager)&&*(int*)(stub+19)==int(p.customLookup-p.lookup-23)&&*(unsigned*)(stub+24)==unsigned(base+p.original);
}
inline const Profile* Resolve(unsigned char* base){
    if(!Readable(base,4096)||*(unsigned short*)base!=0x5a4d)return nullptr;
    unsigned nt=*(unsigned*)(base+60);
    if(nt>0xe00||*(unsigned*)(base+nt)!=0x4550||*(unsigned short*)(base+nt+4)!=0x14c||*(unsigned short*)(base+nt+24)!=0x10b)return nullptr;
    for(const auto& p:profiles)if(*(unsigned*)(base+nt+8)==p.timestamp&&*(unsigned*)(base+nt+80)==p.imageSize)return Verify(base,p)?&p:nullptr;
    return nullptr;
}
inline bool Accept(unsigned char* base,void* lookup,void* engineOriginal){
    auto p=Resolve(base);
    return p&&lookup==base+p->lookup&&*(void**)(base+p->original)==engineOriginal;
}
inline bool PositiveDispatch(unsigned char* base,void* lookup,void* engineOriginal){
    // Unknown build, known complete dispatch structure. Only its nonnegative
    // index branch is accepted: it preserves ECX/stack and tail-calls the
    // verified original. Never call an unknown custom negative-index target.
    if(!Readable(base,4096)||*(unsigned short*)base!=0x5a4d)return false;unsigned nt=*(unsigned*)(base+60);
    if(nt>0xe00||*(unsigned*)(base+nt)!=0x4550||*(unsigned short*)(base+nt+4)!=0x14c||*(unsigned short*)(base+nt+24)!=0x10b)return false;
    unsigned size=*(unsigned*)(base+nt+80);if(size<4096||size>64*1024*1024)return false;
    unsigned begin=unsigned(base),end=begin+size,at=unsigned(lookup);if(end<begin||at<begin||at>end-34||!Executable(lookup))return false;
    static const unsigned char code[]={0x8b,0x54,0x24,0x04,0x83,0xfa,0xff,0x7d,0x0e,0x89,0x54,0x24,0x04,0xb9,0,0,0,0,0xe9,0,0,0,0,0xa1,0,0,0,0,0x89,0x54,0x24,0x04,0xff,0xe0};
    auto stub=(unsigned char*)lookup;if(!Readable(stub,sizeof code))return false;
    for(unsigned i=0;i<sizeof code;++i)if(!((i>=14&&i<18)||(i>=19&&i<23)||(i>=24&&i<28))&&stub[i]!=code[i])return false;
    unsigned manager=*(unsigned*)(stub+14),original=*(unsigned*)(stub+24);long long target=static_cast<long long>(at)+23+*(int*)(stub+19);
    if(manager<begin||manager>end-4||original<begin||original>end-4||target<begin||target>=end||!Readable((void*)manager,4)||!Readable((void*)original,4))return false;
    return Executable((void*)unsigned(target))&&*(void**)original==engineOriginal&&Executable(engineOriginal);
}
}
