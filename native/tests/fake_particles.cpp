// Small offline ABI fixture for the particle SDK's normal enable/use/disable path.
#define NOMINMAX
#include <windows.h>
#include <cstring>
namespace {int baseCalls=0,appendCalls=0,precacheCalls=0,dispatchCalls=0,errors=0;unsigned char manager[160]{};}
extern "C" {
void* FixtureParticleManager=manager;
void __cdecl FixtureParticleBase(void* list,const char*){if(list!=reinterpret_cast<void*>(0x1234))++errors;++baseCalls;}
int __cdecl FixtureParticleNoop(const void*){return 0;}
int __cdecl FixtureParticlePrecacheBody(const char* name){if(strcmp(name,"fixture_hit"))++errors;return ++precacheCalls;}
void __cdecl FixtureParticleParserBody(void* list,const char* path){if(list!=reinterpret_cast<void*>(0x1234)||strcmp(path,"particles/skeeto_fixture.txt"))++errors;++appendCalls;}
void __cdecl FixtureParticleDispatchBody(const char* name,float* origin,float* angles,int a,int b,int c){
    if(strcmp(name,"fixture_hit")||a!=2||b||c||origin[0]!=10||origin[1]!=20||origin[2]!=30||angles[0]||angles[1]!=270||angles[2])++errors;++dispatchCalls;
}
__attribute__((naked)) void FixtureParticleManifest(void*){__asm__ volatile(
 " .byte 0x55,0x8b,0xec,0x8b,0x45,0x08,0x68\n.long 0\n.byte 0x50\ncall _FixtureParticleBase\n.byte 0x83,0xc4,0x08,0x5d,0xc3\n");}
__attribute__((naked)) void FixtureParticleParser(){__asm__ volatile(
 "1: .byte 0x55,0x8b,0xec,0x83,0xec,0x14,0x6a,0x2c\ncall _FixtureParticleNoop\n.byte 0x83,0xc4,0x04,0x85,0xc0,0x74,0x14,0x8b,0x4d,0x0c,0x6a\n.fill 40-(.-1b),1,0x90\npushl 12(%ebp)\npushl 8(%ebp)\ncall _FixtureParticleParserBody\nleave\nret\n");}
__attribute__((naked)) void FixtureParticleDispatch(){__asm__ volatile(
 ".byte 0x55,0x8b,0xec,0x8b,0x45,0x08,0x50\ncall _FixtureParticleNoop\n.byte 0x8b,0x4d,0x1c,0x8b,0x55,0x18,0x51,0x8b,0x4d,0x14,0x52,0x8b,0x45,0x10\nmovl %ebp,%esp\npushl 28(%ebp)\npushl 24(%ebp)\npushl 20(%ebp)\npushl 16(%ebp)\npushl 12(%ebp)\npushl 8(%ebp)\ncall _FixtureParticleDispatchBody\nleave\nret\n");}
__attribute__((naked)) int FixtureParticlePrecache(){__asm__ volatile(
 "1: .byte 0x55,0x8b,0xec,0x8b,0x0d\n.long _FixtureParticleManager\n.byte 0x85,0xc9,0x75,0x07,0xb8\n.long 0\n.fill 20-(.-1b),1,0x90\npushl 8(%ebp)\ncall _FixtureParticlePrecacheBody\nleave\nret\n");}
__attribute__((naked)) int FixtureParticleFind(){__asm__ volatile(
 ".byte 0x55,0x8b,0xec,0x51,0x53,0x8b,0x5d,0x08,0x56,0x8b,0xb1,0x8c,0,0,0\nmovl $1,%eax\npopl %esi\npopl %ebx\nleave\nret $4\n");}
__attribute__((naked)) void FixtureParticleManagerPattern(){__asm__ volatile(
 ".byte 0x0c,0x8b,0x0d\n.long _FixtureParticleManager\n.byte 0x52,0x50,0xe8\n.long 0\nret\n");}
__declspec(dllexport) void __cdecl FixtureParticleBuild(){FixtureParticleManifest(reinterpret_cast<void*>(0x1234));}
__declspec(dllexport) int __cdecl FixtureParticleCount(int which){return which==0?baseCalls:which==1?appendCalls:which==2?precacheCalls:which==3?dispatchCalls:errors;}
}
