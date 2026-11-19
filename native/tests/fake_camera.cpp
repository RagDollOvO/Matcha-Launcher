// Owned mapped-image fixture for the upstream exact CInput adapter. This file
// is only linked into fixtures/idle/client.dll, never the regular client fixture.
#define NOMINMAX
#include <windows.h>
#include <cstdint>
#include <cstring>
__attribute__((section(".camfix"))) unsigned char fixtureCameraReserve[0x964000]={1};
namespace {
int object=0,third=0,fault=0,reads=0,writes=0,errors=0;
void check(void* self,int slot){if(self!=&object||slot!=-1)++errors;if(fault==1)RaiseException(0xe0421213,0,0,nullptr);if(fault==2){auto p=VirtualAlloc(nullptr,4096,MEM_COMMIT|MEM_RESERVE,PAGE_NOACCESS);*static_cast<volatile int*>(p)=1;}}
bool __fastcall getter(void* self,void*,int slot){check(self,slot);++reads;return third!=0;}
void __fastcall first(void* self,void*,int slot){check(self,slot);third=0;++writes;}
void __fastcall thirdPerson(void* self,void*,int slot){check(self,slot);third=1;++writes;}
void relative(unsigned char* at,unsigned char opcode,void* target){at[0]=opcode;int32_t delta=int32_t(uintptr_t(target)-uintptr_t(at+5));memcpy(at+1,&delta,4);}
}
extern "C" __declspec(dllexport) int __cdecl FixtureCameraSetup(int variant){HMODULE module=nullptr;GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,reinterpret_cast<LPCWSTR>(&FixtureCameraSetup),&module);
    auto base=reinterpret_cast<unsigned char*>(module);if(base+0x12ddc0<fixtureCameraReserve||base+0x6e2f08>fixtureCameraReserve+sizeof(fixtureCameraReserve))return 0;
    DWORD old=0;VirtualProtect(fixtureCameraReserve,sizeof(fixtureCameraReserve),PAGE_EXECUTE_READWRITE,&old);
    const unsigned char get[]={0x55,0x8b,0xec,0x56,0x8b,0xf1,0xe8,0xe5,0xe5,0x14,0,0x5e,0xc9,0xc2,4,0};memcpy(base+0x12e050,get,sizeof(get));
    auto gt=base+0x27c640;gt[0]=0xff;gt[1]=0x75;gt[2]=8;relative(gt+3,0xe8,reinterpret_cast<void*>(&getter));gt[8]=0xc3;
    const unsigned char f[]={0x6a,0xff,0xe8,0x39,0x36,0,0,0x33,0xc9,0xc3};memcpy(base+0x12de30,f,sizeof(f));relative(base+0x131470,0xe9,reinterpret_cast<void*>(&first));
    const unsigned char t[]={0x55,0x8b,0xec,0x83,0xec,0x0c,0x56,0x6a,0xff};memcpy(base+0x12ddc0,t,sizeof(t));relative(base+0x12ddc9,0xe8,reinterpret_cast<void*>(&thirdPerson));base[0x12ddce]=0x5e;base[0x12ddcf]=0xc9;base[0x12ddd0]=0xc3;
    void* ptr=&object;memcpy(base+0x6e2f04,&ptr,4);auto dos=reinterpret_cast<IMAGE_DOS_HEADER*>(base);auto nt=reinterpret_cast<IMAGE_NT_HEADERS32*>(base+dos->e_lfanew);
    VirtualProtect(nt,sizeof(*nt),PAGE_READWRITE,&old);nt->FileHeader.TimeDateStamp=variant==2?0:0x6a440ecf;nt->OptionalHeader.SizeOfImage=0x963000;DWORD ignored=0;VirtualProtect(nt,sizeof(*nt),old,&ignored);
    if(variant==1)base[0x12ddc0]=0x90;FlushInstructionCache(GetCurrentProcess(),fixtureCameraReserve,sizeof(fixtureCameraReserve));return 1;
}
extern "C" __declspec(dllexport) void __cdecl FixtureCamera(int value,int failure){third=value;fault=failure;}
extern "C" __declspec(dllexport) void __cdecl FixtureCameraStats(int* out){out[0]=third;out[1]=reads;out[2]=writes;out[3]=errors;}
