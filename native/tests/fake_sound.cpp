// Owned engine fixture: executable upstream-shaped entry + callee-pop name ABI.
// Never packaged. Used to exercise the real MinHook and assembly bridge offline.
#define NOMINMAX
#include <windows.h>
#include <cstring>
#include <cstdint>
extern "C" {
int FixtureCookie=123;
void* FixtureGate=nullptr;
void __cdecl FixtureCopyName(const char* text,char* out,int capacity){if(capacity>0){strncpy(out,text,capacity-1);out[capacity-1]=0;}}
__declspec(dllexport) __attribute__((naked)) void __cdecl FixtureSoundName(){
    __asm__ volatile("pushl %ebp\n.byte 0x8b,0xec\ncmpl $65535,4(%ecx)\npushl 12(%ebp)\npushl 8(%ebp)\npushl 8(%ecx)\ncall _FixtureCopyName\naddl $12,%esp\nleave\nret $8\n");
}
bool __fastcall FixtureGateReady(void*,void*){return true;}
// Long JEs and the 9-byte prologue match the exact S_StartSound signature.
#define SOUND_BODY "pushl %ebp\n.byte 0x8b,0xec\nsubl $0x310,%esp\nmovl _FixtureCookie,%eax\n.byte 0x33,0xc5\nmovl %eax,-4(%ebp)\nmovl _FixtureGate,%ecx\ntestl %ecx,%ecx\n.byte 0x0f,0x84\n.long 1f-.-4\nmovl (%ecx),%eax\nmovl 4(%eax),%edx\ncall *%edx\ntestb %al,%al\n.byte 0x0f,0x84\n.long 1f-.-4\nmovl 0x44(%edi),%ecx\n1: leave\nret\n"
__declspec(dllexport) __attribute__((naked)) void __cdecl FixtureSoundStart(){__asm__ volatile(SOUND_BODY);}
// Duplicate signature remains disabled (INT3 first byte) unless a test requests it.
__attribute__((naked)) void __cdecl FixtureSoundDuplicate(){__asm__ volatile("int3\n.byte 0x8b,0xec\nsubl $0x310,%esp\nmovl _FixtureCookie,%eax\n.byte 0x33,0xc5\nmovl %eax,-4(%ebp)\nmovl _FixtureGate,%ecx\ntestl %ecx,%ecx\n.byte 0x0f,0x84\n.long 1f-.-4\nmovl (%ecx),%eax\nmovl 4(%eax),%edx\ncall *%edx\ntestb %al,%al\n.byte 0x0f,0x84\n.long 1f-.-4\nmovl 0x44(%edi),%ecx\n1: leave\nret\n");}
__attribute__((naked)) int __cdecl FixtureCallSound(void* params){
    __asm__ volatile("pushl %ebp\n.byte 0x8b,0xec\npushl %edi\npushl %esi\npushl %ebx\nmovl 8(%ebp),%edi\nmovl $0x12345678,%esi\nmovl $0x23456789,%ebx\ncall _FixtureSoundStart\nxorl %eax,%eax\ncmpl $0x12345678,%esi\njne 1f\ncmpl $0x23456789,%ebx\njne 1f\ncmpl 8(%ebp),%edi\njne 1f\nmovl $1,%eax\n1: popl %ebx\npopl %esi\npopl %edi\nleave\nret\n");
}
__declspec(dllexport) float __cdecl FixtureEmit(const char* name,float volume){
    static void* table[]={nullptr,reinterpret_cast<void*>(&FixtureGateReady)};static void** gate=table;FixtureGate=&gate;
    void* names[]={reinterpret_cast<void*>(&FixtureSoundName)};struct Sfx{void** table;int id;const char* name;}sfx{names,0,name};
    alignas(16) unsigned char params[0x48]{};*reinterpret_cast<void**>(params+0x0c)=&sfx;*reinterpret_cast<float*>(params+0x28)=volume;
    if(!FixtureCallSound(params))return -999;return *reinterpret_cast<float*>(params+0x28);
}
__declspec(dllexport) void __cdecl FixtureSoundVariant(int mode){
    unsigned char* target=reinterpret_cast<unsigned char*>(mode==2?&FixtureSoundDuplicate:&FixtureSoundStart);DWORD old=0,ignored=0;
    VirtualProtect(target,16,PAGE_EXECUTE_READWRITE,&old);
    if(mode==1)target[5]=0x11; // Valid prologue, incompatible signature.
    if(mode==2)target[0]=0x55; // A second match must refuse installation.
    if(mode==3)target[8]=0x90; // Foreign edit outside MinHook's jump; do not restore it.
    VirtualProtect(target,16,old,&ignored);FlushInstructionCache(GetCurrentProcess(),target,16);
}
}
