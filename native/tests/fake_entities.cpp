// Owned x86 Source entity/RecvTable fixture. Never packaged.
#define NOMINMAX
#include <windows.h>
#include <cstring>
#include <cstdint>
#include <cstddef>
namespace {
struct Prop {const char* name;int type;char padding[32];void* child;int offset;char tail[12];};
static_assert(sizeof(Prop)==0x3c,"RecvProp ABI");
struct Table {Prop* props;int count;void* decoder;const char* name;};
struct Class {void* create;void* event;const char* name;Table* table;Class* next;int id;};
void* baseVt[3]{};void* netVt[2]{};void* listVt[7]{};
struct Entity {void** vt;uint32_t handle;uint8_t life,padding[3];int team,observer;float origin[3],view[3];int zombieClass=0;uint8_t ghost=0;int model=1;uint32_t activeWeapon=0;float nextShove=0;int health=100,maxHealth=100;float buffer=0,bufferTime=0;uint8_t renderMode=0,moveType=0;float velocity[3]{};int effects=0;char addonPadding[0x1880-100]{};uint32_t addonBits=0;int addonWeapons[5]{};};
static_assert(offsetof(Entity,addonBits)==0x1880,"native addon input");
Entity entities[2]={{baseVt,0x1001,0,{0x99,0x88,0x77},2,0,{10,20,30},{0,0,62}},{baseVt,0x2002,0,{},2,0,{1,2,3},{0,0,60}}};
Prop props[]={{"m_lifeState",0,{},nullptr,offsetof(Entity,life),{}},{"m_iTeamNum",0,{},nullptr,offsetof(Entity,team),{}},{"m_iObserverMode",0,{},nullptr,offsetof(Entity,observer),{}},{"m_vecOrigin",2,{},nullptr,offsetof(Entity,origin),{}},{"m_vecViewOffset[0]",1,{},nullptr,offsetof(Entity,view),{}},{"m_isIncapacitated",0,{},nullptr,9,{}},{"m_isHangingFromLedge",0,{},nullptr,10,{}}};
Table table{props,7,nullptr,"DT_BasePlayer"};Prop nested[]{ {"baseclass",6,{},&table,0,{}},{"m_zombieClass",0,{},nullptr,offsetof(Entity,zombieClass),{}},{"m_isGhost",0,{},nullptr,offsetof(Entity,ghost),{}},{"m_nModelIndex",0,{},nullptr,offsetof(Entity,model),{}},{"m_hActiveWeapon",0,{},nullptr,offsetof(Entity,activeWeapon),{}},{"m_iAddonBits",0,{},nullptr,offsetof(Entity,addonBits),{}},{"m_AddonModelWeaponIDs",0,{},nullptr,offsetof(Entity,addonWeapons),{}},{"m_flNextShoveTime",1,{},nullptr,offsetof(Entity,nextShove),{}},
    {"m_iHealth",0,{},nullptr,offsetof(Entity,health),{}},{"m_iMaxHealth",0,{},nullptr,offsetof(Entity,maxHealth),{}},{"m_healthBuffer",1,{},nullptr,offsetof(Entity,buffer),{}},{"m_healthBufferTime",1,{},nullptr,offsetof(Entity,bufferTime),{}},{"m_nRenderMode",0,{},nullptr,offsetof(Entity,renderMode),{}},{"movetype",0,{},nullptr,0,{}},{"m_vecVelocity[0]",1,{},nullptr,offsetof(Entity,velocity),{}},{"m_fEffects",0,{},nullptr,offsetof(Entity,effects),{}} };Table root{nested,16,nullptr,"DT_TerrorPlayer"};
Class klass{nullptr,nullptr,"CTerrorPlayer",&root,nullptr,1};
Prop guardProp{"m_guard",1,{},nullptr,4096,{}};Table guardTable{&guardProp,1,nullptr,"DT_Guarded"};Class guardClass{nullptr,nullptr,"CGuardedFixture",&guardTable,nullptr,2};
Entity* guarded=nullptr;
struct Weapon {void** vt;uint32_t handle;int clip;uint8_t reload,dual=0;int model;float nextFire;char padding[0x9da-24]{};uint16_t script=7;};static_assert(offsetof(Weapon,script)==0x9da,"weapon script handle");Weapon weapon{baseVt,0x1041,30,0,0,1};bool weaponEnabled=false;char weaponName[96]="CRifle";
Prop weaponProps[]={{"m_iClip1",0,{},nullptr,offsetof(Weapon,clip),{}},{"m_bInReload",0,{},nullptr,offsetof(Weapon,reload),{}},{"m_nModelIndex",0,{},nullptr,offsetof(Weapon,model),{}},{"m_flNextPrimaryAttack",1,{},nullptr,offsetof(Weapon,nextFire),{}},{"m_hasDualWeapons",0,{},nullptr,offsetof(Weapon,dual),{}}};Table weaponTable{weaponProps,5,nullptr,"DT_Weapon"};Class weaponClass{nullptr,nullptr,weaponName,&weaponTable,nullptr,3};
struct Obj {void** vt;};Obj networks[5]={{netVt},{netVt},{netVt},{netVt},{netVt}},list{listVt};
struct Roster {void** vt;uint32_t handle;int teams[65]{};uint8_t alive[65]{};int16_t incap[65]{};};Roster roster{baseVt,0x1046};bool rosterEnabled=false,rosterMissing=false;
Prop teamArray[65]{},aliveArray[65]{},incapArray[65]{};Table teamTable{teamArray,65,nullptr,"Team"},aliveTable{aliveArray,65,nullptr,"Alive"},incapTable{incapArray,65,nullptr,"Incap"};
Prop rosterProps[]={{"m_iTeam",6,{},&teamTable,offsetof(Roster,teams),{}},{"m_bAlive",6,{},&aliveTable,offsetof(Roster,alive),{}},{"m_isIncapacitated",6,{},&incapTable,offsetof(Roster,incap),{}}};Table rosterTable{rosterProps,3,nullptr,"DT_TerrorPlayerResource"};Class rosterClass{nullptr,nullptr,"CTerrorPlayerResource",&rosterTable,nullptr,4};
const uint32_t* __fastcall handle(void* self,void*){return &static_cast<Entity*>(self)->handle;}
Class* __fastcall getClass(void* self,void*){return self==&networks[4]?&rosterClass:self==&networks[3]?&weaponClass:self==&networks[2]?&guardClass:&klass;}
void* __fastcall entity(void*,void*,int i){if(i==70&&rosterEnabled)return &roster;if(i==2&&rosterMissing)return nullptr;if(i==65&&weaponEnabled)return &weapon;return i==3?guarded:i>=1&&i<=2?&entities[i-1]:nullptr;}
void* __fastcall net(void*,void*,int i){return i==70&&rosterEnabled?&networks[4]:i==2&&rosterMissing?nullptr:i==65&&weaponEnabled?&networks[3]:i>=1&&i<=3?&networks[i-1]:nullptr;}
int __fastcall highest(void*,void*){return rosterEnabled?70:weaponEnabled?65:3;}
void __cdecl healthProxy(const void* data,void*,void* output){memcpy(output,static_cast<const unsigned char*>(data)+4,4);}
}
extern "C" __declspec(dllexport) void* __cdecl CreateInterface(const char* name,int*){
    if(!guarded){auto memory=static_cast<char*>(VirtualAlloc(nullptr,8192,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE));if(memory){guarded=reinterpret_cast<Entity*>(memory);guarded->vt=baseVt;guarded->handle=0x1003;DWORD old=0;VirtualProtect(memory+4096,4096,PAGE_NOACCESS,&old);}}
    baseVt[2]=reinterpret_cast<void*>(&handle);netVt[1]=reinterpret_cast<void*>(&getClass);listVt[0]=reinterpret_cast<void*>(&net);listVt[3]=reinterpret_cast<void*>(&entity);listVt[6]=reinterpret_cast<void*>(&highest);
    auto slot=reinterpret_cast<void**>(reinterpret_cast<unsigned char*>(&nested[8])+0x20);if(!*slot)*slot=reinterpret_cast<void*>(&healthProxy);
    return !strcmp(name,"VClientEntityList003")?&list:nullptr;
}
extern "C" __declspec(dllexport) void __cdecl FixturePlayer(int life,int team,int observer,uint32_t serial){entities[0].life=uint8_t(life);entities[0].team=team;entities[0].observer=observer;entities[0].handle=(serial<<12)|1;}
extern "C" __declspec(dllexport) void __cdecl FixtureOrigin(float x,float y,float z){entities[0].origin[0]=x;entities[0].origin[1]=y;entities[0].origin[2]=z;}
extern "C" __declspec(dllexport) void __cdecl FixtureInfected(int kind,int life,int ghost,int model,uint32_t serial,float distance){auto& e=entities[1];e.team=3;e.zombieClass=kind;e.life=uint8_t(life);e.ghost=uint8_t(ghost);e.model=model;e.handle=(serial<<12)|2;e.origin[0]=10+distance;e.origin[1]=20;e.origin[2]=30;}
extern "C" __declspec(dllexport) void __cdecl FixtureGuardEnable(){DWORD old=0;VirtualProtect(reinterpret_cast<char*>(guarded)+4096,4096,PAGE_READWRITE|PAGE_GUARD,&old);}
extern "C" __declspec(dllexport) int __cdecl FixtureGuardPresent(){MEMORY_BASIC_INFORMATION m{};VirtualQuery(reinterpret_cast<char*>(guarded)+4096,&m,sizeof(m));return (m.Protect&PAGE_GUARD)!=0;}
extern "C" __declspec(dllexport) void __cdecl FixtureWeapon(const char* name,int clip,int reload,uint32_t serial){strncpy(weaponName,name,95);weaponName[95]=0;weapon.clip=clip;weapon.reload=uint8_t(reload);weapon.handle=(serial<<12)|65;weaponEnabled=true;entities[0].activeWeapon=weapon.handle;}
extern "C" __declspec(dllexport) void __cdecl FixtureWeaponTimes(float fire,float shove){weapon.nextFire=fire;entities[0].nextShove=shove;}
extern "C" __declspec(dllexport) void __cdecl FixtureWeaponScript(unsigned handle){weapon.script=uint16_t(handle);}
extern "C" __declspec(dllexport) void __cdecl FixtureWeaponDual(int dual){weapon.dual=uint8_t(dual);}
extern "C" __declspec(dllexport) void __cdecl FixtureHealth(int hp,int max,float buffer,float time,int incap){auto& e=entities[0];e.health=hp;e.maxHealth=max;e.buffer=buffer;e.bufferTime=time;e.padding[0]=uint8_t(incap);}
extern "C" __declspec(dllexport) void __cdecl FixtureHealthDrop(int index,int hp){int data[7]{};data[1]=hp;data[6]=index;auto& e=entities[index-1];auto fn=*reinterpret_cast<void(__cdecl**)(const void*,void*,void*)>(reinterpret_cast<unsigned char*>(&nested[8])+0x20);fn(data,&e,&e.health);}
extern "C" __declspec(dllexport) int __cdecl FixtureHealthHooked(){return *reinterpret_cast<void**>(reinterpret_cast<unsigned char*>(&nested[8])+0x20)!=reinterpret_cast<void*>(&healthProxy);}
extern "C" __declspec(dllexport) void __cdecl FixtureMovement(int move,float x,float y,float z){auto& e=entities[0];e.moveType=uint8_t(move);e.velocity[0]=x;e.velocity[1]=y;e.velocity[2]=z;}
void* FixtureAddonEntity(int team,uint32_t bits,const int* ids){auto& e=entities[0];e.team=team;e.addonBits=bits;memcpy(e.addonWeapons,ids,20);return &e;}

extern "C" __declspec(dllexport) void __cdecl FixtureRoster(int enabled,int team1,int alive1,int incap1,int team2,int alive2,int incap2){
 rosterEnabled=enabled!=0;roster.teams[1]=team1;roster.teams[2]=team2;roster.alive[1]=uint8_t(alive1);roster.alive[2]=uint8_t(alive2);roster.incap[1]=int16_t(incap1);roster.incap[2]=int16_t(incap2);
 for(int i=0;i<65;++i){teamArray[i]={"entry",0,{},nullptr,i*4,{}};aliveArray[i]={"entry",0,{},nullptr,i,{}};incapArray[i]={"entry",0,{},nullptr,i*2,{}};}
 for(int i=0;i<2;++i){entities[i].team=roster.teams[i+1];entities[i].life=roster.alive[i+1]?0:1;entities[i].padding[0]=uint8_t(roster.incap[i+1]);entities[i].padding[1]=0;}
}
extern "C" __declspec(dllexport) void __cdecl FixtureRosterMissing(int missing){rosterMissing=missing!=0;}
extern "C" __declspec(dllexport) void __cdecl FixtureRosterHanging(int index,int hanging){entities[index-1].padding[1]=uint8_t(hanging);}

extern "C" __declspec(dllexport) void __cdecl FixtureFlashlight(int on){entities[0].effects=on?4:0;}
