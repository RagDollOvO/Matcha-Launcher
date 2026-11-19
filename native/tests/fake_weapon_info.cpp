// Owned executable signatures for the native weapon metadata lookup.
#define NOMINMAX
#include <windows.h>
#include <cstdint>
#include <cstring>
extern "C" {
extern const char FixtureClipSizeKey[]="clip_size",FixtureClipSecondKey[]="clip2_size";
void* __cdecl FixtureWeaponInfoBody(unsigned);
void __cdecl FixtureWeaponDummy(){}
__attribute__((naked)) void* __cdecl FixtureFileWeaponInfo(unsigned short){__asm__ volatile(
 "pushl %ebp\n.byte 0x8b,0xec\nmovw 8(%ebp),%ax\nmovzwl %ax,%eax\npushl %eax\ncall _FixtureWeaponInfoBody\naddl $4,%esp\nleave\nret\n");}
__attribute__((naked)) void __cdecl FixtureWeaponGetter(){__asm__ volatile(
 "movzwl 0x9da(%ecx),%eax\npushl %eax\ncall _FixtureFileWeaponInfo\naddl $4,%esp\naddl $0xa6,%eax\nret $4\n");}
__attribute__((naked)) void __cdecl FixtureWeaponParser(){__asm__ volatile(
 "pushl $_FixtureClipSizeKey\n.byte 0x8b,0xcf\ncall _FixtureWeaponDummy\npushl $-1\npushl $_FixtureClipSecondKey\n.byte 0x8b,0xcf\nmovl %eax,0x160(%esi)\ncall _FixtureWeaponDummy\nmovl %eax,0x164(%esi)\nret\n");}
}
namespace {alignas(4) unsigned char info[0x168]{};int mode=0,calls=0;void* inaccessible=nullptr;}
extern "C" {
void* __cdecl FixtureWeaponInfoBody(unsigned handle){++calls;if(handle!=7)return nullptr;if(mode==1)RaiseException(0xe0421212,0,0,nullptr);
    if(mode==2){if(!inaccessible)inaccessible=VirtualAlloc(nullptr,4096,MEM_COMMIT|MEM_RESERVE,PAGE_NOACCESS);*static_cast<volatile int*>(inaccessible)=3;}return mode==3?nullptr:info;}
__declspec(dllexport) void __cdecl FixtureCapacity(int capacity,int fault){memcpy(info+0x160,&capacity,4);mode=fault;}
__declspec(dllexport) int __cdecl FixtureCapacityCalls(){return calls;}
__declspec(dllexport) void __cdecl FixtureCapacityVariant(){auto p=reinterpret_cast<unsigned char*>(&FixtureWeaponGetter);DWORD old=0;VirtualProtect(p,16,PAGE_EXECUTE_READWRITE,&old);p[3]=0xdb;DWORD ignored=0;VirtualProtect(p,16,old,&ignored);FlushInstructionCache(GetCurrentProcess(),p,16);}
}
