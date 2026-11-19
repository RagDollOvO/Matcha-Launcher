// Owned x86 native VM fixture. Never loaded into, or copied to, the real game.
#define NOMINMAX
#include <windows.h>
#include <cstdint>
#include <cstring>
#include <cmath>
#include <initializer_list>
extern "C" {
uint16_t FixtureVmInfoLimit=16;unsigned char FixtureVmDefault[0x900]{};
void __cdecl FixtureVmSetter(void*,const float*,int);
void* __cdecl FixtureVmInfoBody(unsigned);
void* FixtureVmRenderer=nullptr;
__attribute__((naked)) void FixtureVmOrigin(){__asm__ volatile(
 "pushl %ebp\n.byte 0x8b,0xec\npushl %esi\npushl %edi\nmovl 8(%ebp),%edi\nmovss (%edi),%xmm0\n.byte 0x8b,0xf1\nucomiss 0xa0(%esi),%xmm0\npushl $0\npushl %edi\npushl %esi\ncall _FixtureVmSetter\naddl $12,%esp\npopl %edi\npopl %esi\nleave\nret $4\n");}
__attribute__((naked)) void FixtureVmAngles(){__asm__ volatile(
 "pushl %ebp\n.byte 0x8b,0xec\npushl %esi\npushl %edi\nmovl 8(%ebp),%edi\nmovss (%edi),%xmm0\n.byte 0x8b,0xf1\nucomiss 0xc4(%esi),%xmm0\npushl $1\npushl %edi\npushl %esi\ncall _FixtureVmSetter\naddl $12,%esp\npopl %edi\npopl %esi\nleave\nret $4\n");}
__attribute__((naked)) void* FixtureVmInfo(int){__asm__ volatile(
 "pushl %ebp\n.byte 0x8b,0xec\nmovw 8(%ebp),%ax\ncmpw _FixtureVmInfoLimit,%ax\njb 1f\nmovl $_FixtureVmDefault,%eax\npopl %ebp\nret\n1: movl $65535,%ecx\n .byte 0x66,0x3b,0xc1\nje 2f\nmovzwl %ax,%eax\npushl %eax\ncall _FixtureVmInfoBody\naddl $4,%esp\nleave\nret\n2: movl $_FixtureVmDefault,%eax\nleave\nret\n");}
__attribute__((naked)) void FixtureVmPredicate(){__asm__ volatile(
 ".byte 0x8b,0x81,0xc0,0x0b,0,0,0x83,0xf8,0xff,0x74,0x37,0x8b,0x15\n.long 0\n.byte 0x8b,0xc8,0x81,0xe1,0xff,0x0f,0,0,0x03,0xc9,0x8d,0x4c,0xca,0x04\n.fill 23,1,0x90\n.byte 0x80,0xb8,0x59,0x08,0,0,0\nret\n");}
__attribute__((naked)) void FixtureVmViewPattern(){__asm__ volatile(
 "movl _FixtureVmRenderer,%ecx\n.byte 0x8b,0x01,0x8b,0x50,0x30,0x6a,0xff,0xff,0xd2,0x8d,0x4d,0x9c\nret\n");}
}
namespace {
struct Prop{const char* name;int type;char pad[24];void* proxy;void* pad2;void* child;int offset;char tail[12];};
struct Table{Prop* props;int count;void* decoder;const char* name;};
struct Class{void* create;void* event;const char* name;Table* table;Class* next;int id;};
struct Obj{void** vt;int index;};
struct Item {unsigned char* e=nullptr;void* vt[225]{};unsigned char raw[0xa0]{},header[0x30]{};unsigned flags[3]{1,2,1};float bones[3][3][4]{};Obj network{};Class klass{};bool present=false;};
Item local,models[2],weapons[2];void* listTable[7]{},*networkTable[2]{},*rendererTable[13]{};Obj list{listTable},renderer{rendererTable};
unsigned char camera[0x54]{},infos[2][0x900]{},type[64]{},col[20]{};int errors=0,calcCalls=0,buildCalls=0,setCalls=0,fault=0;
void* heldCalc=nullptr,*heldBuild=nullptr;int nativeCull[2]{},foreignCalls=0;
Prop localProps[]={{"m_hViewModel[0]",0,{},nullptr,nullptr,nullptr,0x300,{}}};Table localTable{localProps,1,nullptr,"DT_Local"};
Prop modelProps[]={{"m_nModelIndex",0,{},nullptr,nullptr,nullptr,0x100,{}},{"m_flModelScale",1,{},nullptr,nullptr,nullptr,0x200,{}}};Table modelTable{modelProps,2,nullptr,"DT_Vm"};
Item* item(int i){return i==1?&local:i==65?&models[0]:i==66?&models[1]:i==100?&weapons[0]:i==101?&weapons[1]:nullptr;}
template<class T> T& at(void* e,size_t off){return *reinterpret_cast<T*>(static_cast<unsigned char*>(e)+off);}
const uint32_t* __fastcall handle(void* self,void*){return &at<uint32_t>(self,4);}
Class* __fastcall klass(void* self,void*){return &item(static_cast<Obj*>(self)->index)->klass;}
void* __fastcall entity(void*,void*,int i){auto p=item(i);return p&&p->present?p->e:nullptr;}
void* __fastcall network(void*,void*,int i){auto p=item(i);return p&&p->present?&p->network:nullptr;}
int __fastcall highest(void*,void*){return 101;}
void fail(int kind){if(fault!=kind)return;auto p=VirtualAlloc(nullptr,4096,MEM_RESERVE|MEM_COMMIT,PAGE_NOACCESS);*static_cast<volatile int*>(p)=1;}
const uint8_t* __fastcall getView(void* self,void*,int slot){if(self!=&renderer||slot!=-1)++errors;fail(3);return camera;}
void __fastcall calc(void* self,void*,void* player,const float* eye,const float* angles){++calcCalls;if(player!=local.e||eye[0]!=10)++errors;
    float pos[3]={10,20,30};memcpy(static_cast<unsigned char*>(self)+0xa0,pos,12);memcpy(static_cast<unsigned char*>(self)+0xc4,angles,12);}
void __fastcall build(void* self,void*,void* header,void* positions,void* rotations,const float* root,int mask,void* computed){++buildCalls;
    int index=self==models[0].e?0:1;auto& m=models[index];if(header!=m.header||positions!=reinterpret_cast<void*>(0x111)||rotations!=reinterpret_cast<void*>(0x222)||root[0]!=9||mask!=1||computed!=reinterpret_cast<void*>(0x333))++errors;
    uint32_t weapon=at<uint32_t>(self,0xbc0);auto w=item(weapon&0xfff);int script=at<uint16_t>(w->e,0x9da);nativeCull[index]=infos[script-7][0x859];fail(4);
    for(int b=0;b<3;++b)for(int r=0;r<3;++r){for(int c=0;c<3;++c)m.bones[b][r][c]=r==c?at<float>(self,0x200):0;m.bones[b][r][3]=(r+1)*10.f+(b+1)*at<float>(self,0x200);}
}
void __fastcall foreignCalc(void* s,void* d,void* p,const float* e,const float* a){++foreignCalls;using Fn=void(__thiscall*)(void*,void*,const float*,const float*);reinterpret_cast<Fn>(heldCalc)(s,p,e,a);}
void __fastcall foreignBuild(void* s,void*,void* h,void* p,void* r,const float* root,int mask,void* c){++foreignCalls;using Fn=void(__thiscall*)(void*,void*,void*,void*,const float*,int,void*);reinterpret_cast<Fn>(heldBuild)(s,h,p,r,root,mask,c);}
void setup(){static bool done=false;if(done)return;done=true;
    strcpy(reinterpret_cast<char*>(type+8),".?AVC_TerrorViewModel@@");at<void*>(col,12)=type;at<void*>(camera,0)=nullptr;
    networkTable[1]=reinterpret_cast<void*>(&klass);listTable[0]=reinterpret_cast<void*>(&network);listTable[3]=reinterpret_cast<void*>(&entity);listTable[6]=reinterpret_cast<void*>(&highest);rendererTable[12]=reinterpret_cast<void*>(&getView);FixtureVmRenderer=&renderer;
    for(int i:{1,65,66,100,101}){auto& f=*item(i);f.e=static_cast<unsigned char*>(VirtualAlloc(nullptr,4096,MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE));f.present=true;f.vt[0]=col;f.vt[3]=reinterpret_cast<void*>(&handle);at<void*>(f.e,0)=f.vt+1;at<uint32_t>(f.e,4)=4096+i;f.network={networkTable,i};f.klass={nullptr,nullptr,i==1?"CTerrorPlayer":i<100?"CTerrorViewModel":"CRifle",i==1?&localTable:&modelTable,nullptr,i};}
    for(int i=0;i<2;++i){auto& f=models[i];f.vt[223]=reinterpret_cast<void*>(&calc);f.vt[176]=reinterpret_cast<void*>(&build);
        at<uint32_t>(local.e,0x300+i*4)=4096+65+i;at<uint16_t>(f.e,0x100)=10+i;at<float>(f.e,0x200)=1.5f;
        at<void*>(f.e,0x934)=f.header;at<void*>(f.header,0)=f.raw;at<void*>(f.header,0x2c)=f.flags;at<void*>(f.e,0x6c0)=f.bones;
        at<uint32_t>(f.raw,0)=0x54534449;at<uint32_t>(f.raw,8)=0xaabb0000+i;at<int>(f.raw,0x9c)=3;
        at<uint32_t>(f.e,0xbc0)=4096+100+i;at<uint16_t>(weapons[i].e,0x9da)=7+i;}
}
}
extern "C" {
void __cdecl FixtureVmSetter(void* self,const float* value,int angle){++setCalls;fail(1);memcpy(static_cast<unsigned char*>(self)+(angle?0xc4:0xa0),value,12);}
void* __cdecl FixtureVmInfoBody(unsigned handle){fail(2);return handle==7?infos[0]:handle==8?infos[1]:FixtureVmDefault;}
__declspec(dllexport) void* __cdecl CreateInterface(const char* name,int*){setup();return !strcmp(name,"VClientEntityList003")?&list:nullptr;}
__declspec(dllexport) void __cdecl FixtureVmFault(int value){fault=value;}
__declspec(dllexport) void __cdecl FixtureVmCalc(int i){float eye[3]={10,20,30},angles[3]={};using Fn=void(__thiscall*)(void*,void*,const float*,const float*);reinterpret_cast<Fn>(models[i].vt[223])(models[i].e,local.e,eye,angles);}
__declspec(dllexport) void __cdecl FixtureVmBuild(int i){float root[12]={9};auto& f=models[i];using Fn=void(__thiscall*)(void*,void*,void*,void*,const float*,int,void*);
    reinterpret_cast<Fn>(f.vt[176])(f.e,f.header,reinterpret_cast<void*>(0x111),reinterpret_cast<void*>(0x222),root,1,reinterpret_cast<void*>(0x333));}
__declspec(dllexport) float __cdecl FixtureVmValue(int i,int field){if(field<3)return at<float>(models[i].e,0xa0+field*4);if(field<6)return at<float>(models[i].e,0xc4+(field-3)*4);return at<float>(models[i].e,0x200);}
__declspec(dllexport) float __cdecl FixtureVmBone(int i,int b,int row,int col){return models[i].bones[b][row][col];}
__declspec(dllexport) int __cdecl FixtureVmCull(int i,int native){return native?nativeCull[i]:infos[i][0x859];}
__declspec(dllexport) void __cdecl FixtureVmSet(int i,int field,uint32_t value){setup();auto& f=models[i];
    if(field==0)at<uint32_t>(f.raw,8)=value;
    if(field==1){f.present=value!=0;at<uint32_t>(local.e,0x300+i*4)=value?at<uint32_t>(f.e,4):0xffffffff;}
    if(field==2)at<uint16_t>(weapons[i].e,0x9da)=uint16_t(value);
    if(field==3)at<float>(f.e,0x200)=float(value)/100;
    if(field==4)at<int>(f.raw,0x9c)=int(value);
    if(field==5){at<uint32_t>(f.e,4)=(value<<12)|(65+i);at<uint32_t>(local.e,0x300+i*4)=at<uint32_t>(f.e,4);}
    if(field==6){heldCalc=f.vt[223];f.vt[223]=reinterpret_cast<void*>(&foreignCalc);}
    if(field==7){heldBuild=f.vt[176];f.vt[176]=reinterpret_cast<void*>(&foreignBuild);}
    if(field==8){DWORD old;VirtualProtect(f.e,4096,value?PAGE_READONLY:PAGE_READWRITE,&old);}
}
__declspec(dllexport) int __cdecl FixtureVmStats(int index){return index==0?errors:index==1?calcCalls:index==2?buildCalls:index==3?setCalls:foreignCalls;}
__declspec(dllexport) void __cdecl FixtureVmUnsupported(){auto p=reinterpret_cast<unsigned char*>(&FixtureVmOrigin);DWORD old,ignored;VirtualProtect(p,32,PAGE_EXECUTE_READWRITE,&old);p[20]=1;VirtualProtect(p,32,old,&ignored);FlushInstructionCache(GetCurrentProcess(),p,32);}
}
