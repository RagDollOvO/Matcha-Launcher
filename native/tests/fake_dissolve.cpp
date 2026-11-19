// Owned native ABI fixture. Its client.dll lives only in a fresh offline host.
#define NOMINMAX
#include <windows.h>
#include <cstdint>
#include <cstring>
#include <map>
#include <string>
#include <vector>
extern "C" {
void* FixtureDissVtable[93]{};void* FixtureDissManager=nullptr;
void __cdecl FixtureDissCtorBody(void*);void __cdecl FixtureDissEffectBody(void*,void*);void __cdecl FixtureDissModelBody(void*,const void*);
void* __cdecl FixtureDissAlloc(int);void __fastcall FixtureDissDelete(void*,void*,void*);
void __fastcall FixtureDissParent(void*,void*,void*,int);void __fastcall FixtureDissOrigin(void*,void*,const float*);
__attribute__((naked)) void* FixtureDissCtor(){__asm__ volatile(
 "pushl %esi\n.byte 0x8b,0xf1,0xc7,0x06\n.long _FixtureDissVtable\npushl %esi\ncall _FixtureDissCtorBody\naddl $4,%esp\nmovl %esi,%eax\npopl %esi\nret\n");}
__attribute__((naked)) void FixtureDissFlags(){__asm__ volatile(
 ".byte 0x55,0x8b,0xec,0x8b,0x45,8,0x09,0x81\n.long 0xf0\npopl %ebp\nret $4\n");}
__attribute__((naked)) void FixtureDissEffect(){__asm__ volatile(
 "1: .byte 0x55,0x8b,0xec,0x56,0x8b,0xf1,0x8b,0x86\n.long 0x5f8\njmp 2f\n.fill 0x4d-(.-1b),1,0x90\n.byte 0x89,0x8e\n.long 0x5f8\n.fill 0x58-(.-1b),1,0x90\n.byte 0xc7,0x86\n.long 0x5f8,0xffffffff\n2: pushl 8(%ebp)\npushl %esi\ncall _FixtureDissEffectBody\naddl $8,%esp\npopl %esi\nleave\nret $4\n");}
__attribute__((naked)) void FixtureDissModel(){__asm__ volatile(
 "1: .byte 0x55,0x8b,0xec,0x56,0x57,0x8b,0x7d,8,0x8b,0xf1,0x3b,0x7e,0x60,0x74,0x41\npushl %edi\npushl %esi\ncall _FixtureDissModelBody\naddl $8,%esp\njmp 2f\n.fill 0x50-(.-1b),1,0x90\n2: popl %edi\npopl %esi\nleave\nret $4\n");}
// Only the adapter scanner consumes this signature carrier. It is never run.
__attribute__((naked)) void FixtureDissPattern(){__asm__ volatile(
 "1: .byte 0x55,0x8b,0xec,0x56,0x68,0x80,0x06,0,0\ncall _FixtureDissAlloc\n.fill 0x17-(.-1b),1,0x90\ncall _FixtureDissCtor\n.fill 0x24-(.-1b),1,0x90\n.byte 0x8b,0x90,0x70,1,0,0\n.fill 0x39-(.-1b),1,0x90\n.byte 0x8b,0x0d\n.long _FixtureDissManager\n.byte 0x56\ncall @FixtureDissDelete@12\n.fill 0x4e-(.-1b),1,0x90\n.byte 0x68\n.fill 0x55-(.-1b),1,0x90\ncall _FixtureDissFlags\n.byte 0x6a,0,0x57,0x8b,0xce\ncall @FixtureDissParent@16\n.byte 0x8b,0x46,8,0x8b,0x50,0x10,0x8d,0x4e,8,0x6a,0,0xff,0xd2\n.fill 0x7a-(.-1b),1,0x90\n.byte 0x50,0x8b,0xce\ncall @FixtureDissOrigin@12\n.fill 0x87-(.-1b),1,0x90\n.byte 0xf3,0x0f,0x11,0x86,0x3c,6,0,0\n.fill 0xfe-(.-1b),1,0x90\ncall _FixtureDissEffect\nret\n");}
}
namespace {
template<class T>T& at(void* object,size_t offset){return *reinterpret_cast<T*>(static_cast<unsigned char*>(object)+offset);}
struct Prop{const char* name;int type;char pad[32];void* child;int offset;char tail[12];};
struct Table{Prop* props;int count;void* decoder;const char* name;};struct Class{void* create;void* event;const char* name;Table* table;Class* next;int id;};
void* targetTable[12]{},*netTable[2]{},*listTable[7]{},*fxNetTable[5]{},*modelTable[42]{};
struct Obj{void** vt;Class* klass=nullptr;}list{listTable},model{modelTable},manager{};
Prop props[]={{"m_fEffects",0,{},nullptr,0x30,{}},{"m_nRenderMode",0,{},nullptr,0x34,{}},{"m_clrRender",0,{},nullptr,0x38,{}},{"m_vecOrigin",2,{},nullptr,0x40,{}},{"m_iTeamNum",0,{},nullptr,0x50,{}},{"m_iHealth",0,{},nullptr,0x54,{}},{"m_lifeState",0,{},nullptr,0x58,{}}};
Table table{props,7,nullptr,"DT_DissolveFixture"};std::map<std::string,Class> classes;std::map<int,void*> entities;std::map<int,Obj> networks;std::vector<void*> allFx;
int created=0,deleted=0,errors=0,finds=0,origins=0,dataCalls=0,parents=0,fault=0;uint32_t serial=100;void* lastFx=nullptr;
void fail(int where){if(fault==where)RaiseException(0xe0421234,0,0,nullptr);}
int __fastcall noop(void*,void*){return 0;}
const uint32_t* __fastcall targetHandle(void* self,void*){return &at<uint32_t>(self,4);}
const uint32_t* __fastcall fxHandle(void* self,void*){return &at<uint32_t>(self,0x20);}
const float* __fastcall getOrigin(void* self,void*){fail(6);return &at<float>(self,0x70);}
Class* __fastcall klass(void* self,void*){return static_cast<Obj*>(self)->klass;}
void* __fastcall get(void*,void*,int idx){auto i=entities.find(idx);return i==entities.end()?nullptr:i->second;}
void* __fastcall net(void*,void*,int idx){auto i=networks.find(idx);return i==networks.end()?nullptr:&i->second;}
int __fastcall highest(void*,void*){return entities.empty()?0:entities.rbegin()->first;}
bool __fastcall initFx(void* self,void*,const char* name,int value){if(name||value)++errors;fail(2);if(fault==7)return false;at<uint32_t>(self,0x20)=(++serial<<12)|1800;return true;}
void __fastcall data(void* self,void*,int type){if(type||at<void*>(static_cast<unsigned char*>(self)-8,8)!=fxNetTable)++errors;++dataCalls;fail(3);}
const void* __fastcall find(void* self,void*,const char* path){if(self!=&model)++errors;++finds;return !strcmp(path,"sprites/glow01.vmt")?reinterpret_cast<void*>(0x123456):nullptr;}
void setup(){static bool done=false;if(done)return;done=true;targetTable[2]=reinterpret_cast<void*>(&targetHandle);targetTable[11]=reinterpret_cast<void*>(&getOrigin);netTable[1]=reinterpret_cast<void*>(&klass);
    listTable[0]=reinterpret_cast<void*>(&net);listTable[3]=reinterpret_cast<void*>(&get);listTable[6]=reinterpret_cast<void*>(&highest);modelTable[41]=reinterpret_cast<void*>(&find);
    FixtureDissVtable[0]=reinterpret_cast<void*>(&noop);FixtureDissVtable[2]=reinterpret_cast<void*>(&fxHandle);FixtureDissVtable[92]=reinterpret_cast<void*>(&initFx);fxNetTable[4]=reinterpret_cast<void*>(&data);FixtureDissManager=&manager;}
}
extern "C" {
void* __cdecl FixtureDissAlloc(int bytes){setup();if(bytes!=0x680)++errors;if(fault==8)return nullptr;auto p=VirtualAlloc(nullptr,4096,MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE);allFx.push_back(p);lastFx=p;++created;return p;}
void __cdecl FixtureDissCtorBody(void* self){fail(1);at<void*>(self,8)=fxNetTable;at<uint32_t>(self,0x20)=0xffffffffu;}
void __cdecl FixtureDissModelBody(void* self,const void* value){at<const void*>(self,0x60)=value;}
void __cdecl FixtureDissEffectBody(void* self,void* fx){at<uint32_t>(self,0x5f8)=fx?at<uint32_t>(fx,0x20):0xffffffffu;at<uint8_t>(self,0x34)=1;at<uint32_t>(self,0x38)=0x22334455;fail(4);}
void __fastcall FixtureDissParent(void* self,void*,void* target,int value){if(value)++errors;at<void*>(self,0x28)=target;++parents;}
void __fastcall FixtureDissOrigin(void* self,void*,const float* value){memcpy(static_cast<unsigned char*>(self)+0x30,value,12);++origins;}
void __fastcall FixtureDissDelete(void* mgr,void*,void* fx){if(mgr!=&manager||at<void*>(fx,0)!=FixtureDissVtable)++errors;fail(5);at<void*>(fx,0)=nullptr;++deleted;}
__declspec(dllexport) void* __cdecl CreateInterface(const char* name,int*){setup();return !strcmp(name,"VClientEntityList003")?&list:nullptr;}
__declspec(dllexport) void* __cdecl FixtureDissModelInfo(){setup();return &model;}
__declspec(dllexport) void __cdecl FixtureDissPut(int index,const char* name,uint32_t number,float x){setup();auto& e=entities[index];if(!e)e=VirtualAlloc(nullptr,4096,MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE);DWORD old;VirtualProtect(e,4096,PAGE_READWRITE,&old);memset(e,0,4096);
    at<void*>(e,0)=targetTable;at<uint32_t>(e,4)=(number<<12)|index;at<uint32_t>(e,0x30)=4;at<uint8_t>(e,0x34)=2;at<uint32_t>(e,0x38)=0xaabbccdd;at<float>(e,0x40)=x;at<float>(e,0x70)=x+10;at<int>(e,0x50)=index==1?2:3;at<int>(e,0x54)=100;at<uint8_t>(e,0x58)=1;at<uint32_t>(e,0xf0)=8;at<uint32_t>(e,0x5f8)=0xffffffffu;
    auto& c=classes[name];c={nullptr,nullptr,classes.find(name)->first.c_str(),&table,nullptr,1};networks[index]={netTable,&c};}
__declspec(dllexport) void* __cdecl FixtureDissEntity(int index){return entities.at(index);}
__declspec(dllexport) void __cdecl FixtureDissRemove(int index){entities.erase(index);networks.erase(index);}
__declspec(dllexport) uint32_t __cdecl FixtureDissValue(int index,int offset){return at<uint32_t>(entities.at(index),offset);}
__declspec(dllexport) void __cdecl FixtureDissEdit(int index,int offset,uint32_t value){at<uint32_t>(entities.at(index),offset)=value;}
__declspec(dllexport) float __cdecl FixtureDissFxFloat(int offset){return at<float>(lastFx,offset);}
__declspec(dllexport) uint32_t __cdecl FixtureDissFxInt(int offset){return at<uint32_t>(lastFx,offset);}
__declspec(dllexport) int __cdecl FixtureDissStats(int index){return index==0?created:index==1?deleted:index==2?errors:index==3?finds:index==4?origins:index==5?dataCalls:parents;}
__declspec(dllexport) void __cdecl FixtureDissAccess(int index,uint32_t protection){DWORD old;VirtualProtect(entities.at(index),4096,protection,&old);}
__declspec(dllexport) void __cdecl FixtureDissFxAccess(uint32_t protection){DWORD old;VirtualProtect(lastFx,4096,protection,&old);}
__declspec(dllexport) void __cdecl FixtureDissFault(int value){fault=value;}
__declspec(dllexport) void __cdecl FixtureDissUnsupported(){auto p=reinterpret_cast<unsigned char*>(&FixtureDissPattern);DWORD old,unused;VirtualProtect(p,0x103,PAGE_EXECUTE_READWRITE,&old);p[0x87]=0x90;VirtualProtect(p,0x103,old,&unused);FlushInstructionCache(GetCurrentProcess(),p,0x103);}
}
