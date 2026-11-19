// Owned native UpdateAddonModels-shaped fixture; never installed in the game.
#define NOMINMAX
#include <windows.h>
#include <cstdint>
#include <cstring>
void* FixtureAddonEntity(int,uint32_t,const int*);
extern "C" {
void* FixtureAddonGlobals=nullptr;
void __cdecl FixtureAddonBody(void*);
__attribute__((naked)) void __thiscall FixtureAddonRaw(void*){__asm__ volatile(
    "1: pushl %ebp\n.byte 0x8b,0xec\nsubl $0x10,%esp\npushl %ebx\npushl %esi\npushl %edi\n.byte 0x8b,0xf9\nmovl _FixtureAddonGlobals,%ecx\nmovl (%ecx),%eax\nmovl 0x68(%eax),%edx\n"
    "pushl %edi\ncall _FixtureAddonBody\naddl $4,%esp\npopl %edi\npopl %esi\npopl %ebx\nleave\nret\n"
    ".space 0xfb-(.-1b),0x90\n.byte 0x8b,0x97,0x80,0x18,0,0\n.space 0x180-(.-1b),0x90\n.byte 0x8b,0x94,0x8f,0x84,0x18,0,0\n");}
}
namespace {void* object=nullptr;void* table[27]{};struct Obj{void** vt;}globals{table};uint32_t seen=0,calls=0;int raiseMode=0;}
extern "C" {
void __cdecl FixtureAddonBody(void* self){++calls;memcpy(&seen,static_cast<char*>(self)+0x1880,4);if(raiseMode==1)RaiseException(0xe0424242,0,0,nullptr);if(raiseMode==2){auto p=static_cast<volatile int*>(VirtualAlloc(nullptr,4096,MEM_RESERVE|MEM_COMMIT,PAGE_NOACCESS));*p=1;}}
__declspec(dllexport) void __cdecl FixtureAddonSet(int team,uint32_t bits,const int* ids,int mode){FixtureAddonGlobals=&globals;object=FixtureAddonEntity(team,bits,ids);raiseMode=mode;}
__declspec(dllexport) void __cdecl FixtureAddonInvoke(void*){FixtureAddonRaw(object);}
__declspec(dllexport) uint32_t __cdecl FixtureAddonSeen(){return seen;}
__declspec(dllexport) uint32_t __cdecl FixtureAddonReceived(){uint32_t value=0;memcpy(&value,static_cast<char*>(object)+0x1880,4);return value;}
__declspec(dllexport) uint32_t __cdecl FixtureAddonCalls(){return calls;}
__declspec(dllexport) void __cdecl FixtureAddonMutate(int offset,int value){DWORD old=0;auto target=reinterpret_cast<unsigned char*>(&FixtureAddonRaw);VirtualProtect(target+offset,1,PAGE_EXECUTE_READWRITE,&old);target[offset]=uint8_t(value);DWORD ignored=0;VirtualProtect(target+offset,1,old,&ignored);FlushInstructionCache(GetCurrentProcess(),target+offset,1);}
__declspec(dllexport) int __cdecl FixtureAddonByte(int offset){return reinterpret_cast<unsigned char*>(&FixtureAddonRaw)[offset];}
}
