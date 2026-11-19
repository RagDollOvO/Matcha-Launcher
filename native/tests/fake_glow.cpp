// Owned executable signatures and RecvTable for the native glow SDK.
#define NOMINMAX
#include <windows.h>
#include <cstring>
#include <cstdint>
#include <cstddef>
extern "C" {
float FixtureGlowUnit=1.f/255;
int FixtureGlowTypeCalls=0,FixtureGlowProxyCalls=0,FixtureGlowRemoveCalls=0;
void __cdecl FixtureGlowColourBody(void*,void*,void*);
__attribute__((naked)) void __cdecl FixtureGlowProxy(){__asm__ volatile(
 "pushl %ebp\n.byte 0x8b,0xec\nmovl 8(%ebp),%eax\nmovl 4(%eax),%ecx\nmovl 12(%ebp),%eax\nmovl 16(%ebp),%edx\nmovss _FixtureGlowUnit,%xmm0\nmovl %ecx,(%edx)\nmovzbl 16(%eax),%ecx\n"
 "pushl 16(%ebp)\npushl 12(%ebp)\npushl 8(%ebp)\ncall _FixtureGlowColourBody\naddl $12,%esp\nleave\nret\n");}
__attribute__((naked)) void __cdecl FixtureGlowType(){__asm__ volatile(
 "pushl %ebp\n.byte 0x8b,0xec\npushl %ebx\nmovl 8(%ebp),%ebx\npushl %esi\npushl %edi\n.byte 0x8b,0xf9\ncmpl %ebx,4(%edi)\nleal 4(%edi),%esi\n.byte 0x74,0x0d\nmovl -4(%esi),%eax\nmovl (%eax),%edx\nleal -4(%esi),%ecx\npushl %esi\ncall *%edx\nnop\nnop\n"
 "movl %ebx,4(%edi)\nincl _FixtureGlowTypeCalls\npopl %edi\npopl %esi\npopl %ebx\nleave\nret $4\n");}
}
namespace {
struct Prop {const char* name;int type;char pad[32];void* child;int offset;char tail[12];};static_assert(sizeof(Prop)==0x3c,"RecvProp");
struct Table {Prop* props;int count;void* decoder;const char* name;};struct Class {void* create;void* event;const char* name;Table* table;Class* next;int id;};
void* nativeVt[1]{};void* playerVt[240]{},*networkVt[2]{},*listVt[7]{};
struct Glow {void** table;int type,range,min,colour,pad;float rgb[3];};
struct Entity {void** table;uint32_t handle;int team;Glow glow;unsigned char life,incap;uint16_t model,adjacent;int hp,observer,character,zombie,effects;uint32_t owner;};
Entity entities[2048]{};bool present[2048]{};
struct Obj{void** vt;};Obj nets[2048]{},list{listVt};
Prop glowProps[]={{"m_iGlowType",0,{},nullptr,4,{}},{"m_nGlowRange",0,{},nullptr,8,{}},{"m_nGlowRangeMin",0,{},nullptr,12,{}},{"m_glowColorOverride",0,{},nullptr,16,{}}};Table glowTable{glowProps,4,nullptr,"DT_Glow"};
Prop entityProps[]={
 {"m_iTeamNum",0,{},nullptr,offsetof(Entity,team),{}},{"m_Glow",6,{},&glowTable,offsetof(Entity,glow),{}},
 {"m_lifeState",0,{},nullptr,offsetof(Entity,life),{}},{"m_isIncapacitated",0,{},nullptr,offsetof(Entity,incap),{}},
 {"m_nModelIndex",0,{},nullptr,offsetof(Entity,model),{}},{"m_iHealth",0,{},nullptr,offsetof(Entity,hp),{}},
 {"m_iObserverMode",0,{},nullptr,offsetof(Entity,observer),{}},{"m_survivorCharacter",0,{},nullptr,offsetof(Entity,character),{}},
 {"m_zombieClass",0,{},nullptr,offsetof(Entity,zombie),{}},{"m_fEffects",0,{},nullptr,offsetof(Entity,effects),{}},{"m_hOwnerEntity",0,{},nullptr,offsetof(Entity,owner),{}}
};Table entityTable{entityProps,int(sizeof(entityProps)/sizeof(Prop)),nullptr,"DT_BaseEntity"};
Class playerClass{nullptr,nullptr,"CTerrorPlayer",&entityTable,nullptr,1},propClass{nullptr,nullptr,"CBaseUpgradeItem",&entityTable,nullptr,2};
void initEntities(){static bool ready=false;if(ready)return;ready=true;for(int i=1;i<2048;++i){entities[i]={playerVt,0x1000u+unsigned(i),i<=32?2:0,{nativeVt,0,40,7,0x332211},0,0,0,0xa55a,100,0,0,0,0,0};nets[i].vt=networkVt;}present[1]=present[2]=present[65]=true;}
Entity* getEntity(int index){initEntities();return index>0&&index<2048&&present[index]?entities+index:nullptr;}
const uint32_t* __fastcall serial(void* self,void*){return &static_cast<Entity*>(self)->handle;}
void* __fastcall get(void*,void*,int index){return getEntity(index);}
void* __fastcall net(void*,void*,int index){return getEntity(index)?nets+index:nullptr;}
int __fastcall highest(void*,void*){for(int i=2047;i>0;--i)if(present[i])return i;return 0;}
Class* __fastcall klass(void* self,void*){return static_cast<Obj*>(self)-nets>32?&propClass:&playerClass;}
void __fastcall nativeColour(void*,void*,float* r,float* g,float* b,float* a){*r=.2f;*g=.3f;*b=.4f;*a=.25f;}
void __fastcall remove(void*,void*,int*){++FixtureGlowRemoveCalls;}
using Colour=void(__thiscall*)(void*,float*,float*,float*,float*);Colour chained=nullptr;
void __fastcall foreign(void* self,void*,float* r,float* g,float* b,float* a){chained(self,r,g,b,a);*r+=.1f;}
}
extern "C" {
void __cdecl FixtureGlowColourBody(void*,void* self,void* out){auto g=static_cast<Glow*>(self);if(out!=&g->colour)return;++FixtureGlowProxyCalls;g->rgb[0]=(g->colour&255)/255.f;g->rgb[1]=((g->colour>>8)&255)/255.f;g->rgb[2]=((g->colour>>16)&255)/255.f;}
__declspec(dllexport) void* __cdecl CreateInterface(const char* name,int*){nativeVt[0]=reinterpret_cast<void*>(&remove);playerVt[2]=reinterpret_cast<void*>(&serial);if(!playerVt[239])playerVt[239]=reinterpret_cast<void*>(&nativeColour);networkVt[1]=reinterpret_cast<void*>(&klass);listVt[0]=reinterpret_cast<void*>(&net);listVt[3]=reinterpret_cast<void*>(&get);listVt[6]=reinterpret_cast<void*>(&highest);return !strcmp(name,"VClientEntityList003")?&list:nullptr;}
__declspec(dllexport) void __cdecl FixtureGlowGet(int index,float* out){auto e=getEntity(index);reinterpret_cast<Colour>(e->table[239])(e,out,out+1,out+2,out+3);}
__declspec(dllexport) void __cdecl FixtureGlowValues(int index,int* out,float* rgb){auto e=getEntity(index);memcpy(out,&e->glow.type,16);memcpy(rgb,e->glow.rgb,12);}
__declspec(dllexport) void __cdecl FixtureGlowExternal(int index,int type,int range,int minimum,int colour){auto& g=getEntity(index)->glow;g.type=type;g.range=range;g.min=minimum;g.colour=colour;}
__declspec(dllexport) void __cdecl FixtureGlowSerial(int index,unsigned serial){getEntity(index)->handle=(serial<<12)|unsigned(index);}
__declspec(dllexport) void __cdecl FixtureGlowForeign(){chained=reinterpret_cast<Colour>(playerVt[239]);playerVt[239]=reinterpret_cast<void*>(&foreign);}
__declspec(dllexport) void __cdecl FixtureGlowVariant(){auto p=reinterpret_cast<unsigned char*>(&FixtureGlowType);DWORD old=0;VirtualProtect(p,16,PAGE_EXECUTE_READWRITE,&old);p[13]=8;DWORD ignored=0;VirtualProtect(p,16,old,&ignored);FlushInstructionCache(GetCurrentProcess(),p,16);}
__declspec(dllexport) void __cdecl FixtureGlowPresent(int index,int value){initEntities();present[index]=value!=0;}
__declspec(dllexport) void __cdecl FixtureGlowPlayer(int index,int team,int life,int hp,int incap,int observer,int character,int model){initEntities();present[index]=true;auto& p=entities[index];p.team=team;p.life=life;p.hp=hp;p.incap=incap;p.observer=observer;p.character=character;p.model=model;}
__declspec(dllexport) void __cdecl FixtureGlowLaser(int index,int model,unsigned owner,int effects){initEntities();present[index]=true;auto& p=entities[index];p.model=model;p.owner=owner;p.effects=effects;}
}
