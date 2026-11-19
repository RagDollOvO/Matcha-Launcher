// Owned x86 fixture: concrete RecvProps, per-class native Build slots and matrices.
#define NOMINMAX
#include <windows.h>
#include <cstdint>
#include <cstring>
#include <cstddef>
namespace {
struct Prop{const char* name;int type;char pad[24];void* proxy;void* pad2;void* child;int offset;char tail[12];};
static_assert(sizeof(Prop)==0x3c&&offsetof(Prop,proxy)==0x20,"RecvProp ABI");
struct Table{Prop* props;int count;void* decoder;const char* name;};
struct Class{void* create;void* event;const char* name;Table* table;Class* next;int id;};
struct Entity{void** vt;uint32_t handle;int team;float scale;float origin[3];char pad[0x6c0-28];float (*matrices)[3][4];};
static_assert(offsetof(Entity,matrices)==0x6c0,"bone matrix pointer ABI");
struct Obj{void** vt;int index;};
struct Recv{const void* prop;float value;int pad[2],type,element,objectId;};
struct Fixture{Entity e{};void* vtable[176]{};Obj network{};Class klass{};char name[96]{};float bones[3][3][4]{};bool present=false;};
Fixture items[2048];void* listTable[7]{},*netTable[2]{};Obj list{listTable,0};int errors=0,calls=0,foreignCalls=0;void* heldBuild=nullptr;
void __cdecl proxy(const void* data,void*,void* out){*static_cast<float*>(out)=static_cast<const Recv*>(data)->value;}
void __cdecl foreignProxy(const void* data,void* entity,void* out){++foreignCalls;proxy(data,entity,out);}
Prop props[]={{"m_iTeamNum",0,{},nullptr,nullptr,nullptr,offsetof(Entity,team),{}},{"m_vecOrigin",2,{},nullptr,nullptr,nullptr,offsetof(Entity,origin),{}},{"m_flModelScale",1,{},reinterpret_cast<void*>(&proxy),nullptr,nullptr,offsetof(Entity,scale),{}}};
Table table{props,3,nullptr,"DT_ModelFixture"};
const uint32_t* __fastcall handle(void* self,void*){return &static_cast<Entity*>(self)->handle;}
Class* __fastcall klass(void* self,void*){return &items[static_cast<Obj*>(self)->index].klass;}
void* __fastcall entity(void*,void*,int i){return i>0&&i<2048&&items[i].present?&items[i].e:nullptr;}
void* __fastcall network(void*,void*,int i){return i>0&&i<2048&&items[i].present?&items[i].network:nullptr;}
int __fastcall highest(void*,void*){for(int i=2047;i>0;--i)if(items[i].present)return i;return 0;}
void __fastcall build(void* self,void*,void* header,void* positions,void* rotations,const float* root,int mask,void* computed){
    ++calls;if(!header||positions!=reinterpret_cast<void*>(0x111)||rotations!=reinterpret_cast<void*>(0x222)||root[0]!=9||computed!=reinterpret_cast<void*>(0x333)||mask!=1)++errors;
    auto e=static_cast<Entity*>(self);for(int b=0;b<3;++b)for(int r=0;r<3;++r){for(int c=0;c<3;++c)e->matrices[b][r][c]=r==c?e->scale:0;e->matrices[b][r][3]=e->origin[r]+float(b+1)*e->scale;}
}
void __fastcall foreignBuild(void* self,void* edx,void* h,void* p,void* r,const float* root,int m,void* c){++foreignCalls;build(self,edx,h,p,r,root,m,c);}
}
extern "C" __declspec(dllexport) void* __cdecl CreateInterface(const char* name,int*){
    listTable[0]=reinterpret_cast<void*>(&network);listTable[3]=reinterpret_cast<void*>(&entity);listTable[6]=reinterpret_cast<void*>(&highest);netTable[1]=reinterpret_cast<void*>(&klass);
    return !strcmp(name,"VClientEntityList003")?&list:nullptr;
}
extern "C" __declspec(dllexport) void __cdecl FixtureModelSet(int i,const char* name,int team,int serial,float scale){
    auto& f=items[i];if(!f.present){f.vtable[2]=reinterpret_cast<void*>(&handle);f.vtable[175]=reinterpret_cast<void*>(&build);f.e.vt=f.vtable;f.e.matrices=f.bones;f.network={netTable,i};f.klass={nullptr,nullptr,f.name,&table,nullptr,i};f.present=true;}
    strncpy(f.name,name,95);f.e.handle=uint32_t((serial<<12)|i);f.e.team=team;f.e.scale=scale;f.e.origin[0]=10;f.e.origin[1]=20;f.e.origin[2]=30;
}
extern "C" __declspec(dllexport) float __cdecl FixtureModelValue(int i){return items[i].e.scale;}
extern "C" __declspec(dllexport) void __cdecl FixtureModelField(int i,float value){items[i].e.scale=value;}
extern "C" __declspec(dllexport) void __cdecl FixtureModelReceive(int i,float value,int objectId){Recv data{&props[2],value,{},1,0,objectId};using Fn=void(__cdecl*)(const void*,void*,void*);reinterpret_cast<Fn>(props[2].proxy)(&data,&items[i].e,&items[i].e.scale);}
extern "C" __declspec(dllexport) void __cdecl FixtureModelBuild(int i,int count,int retained){
    unsigned char raw[0xa0]{},header[0x30]{};*reinterpret_cast<int*>(raw+0x9c)=count;*reinterpret_cast<void**>(header)=raw;unsigned flags[3]={1,2,1};*reinterpret_cast<void**>(header+0x2c)=flags;float root[12]={9};
    using Fn=void(__thiscall*)(void*,void*,void*,void*,const float*,int,void*);reinterpret_cast<Fn>(retained?heldBuild:items[i].vtable[175])(&items[i].e,header,reinterpret_cast<void*>(0x111),reinterpret_cast<void*>(0x222),root,1,reinterpret_cast<void*>(0x333));
}
extern "C" __declspec(dllexport) float __cdecl FixtureModelBone(int i,int bone,int row,int col){return items[i].bones[bone][row][col];}
extern "C" __declspec(dllexport) int __cdecl FixtureModelErrors(){return errors;}
extern "C" __declspec(dllexport) int __cdecl FixtureModelForeign(){return foreignCalls;}
extern "C" __declspec(dllexport) void __cdecl FixtureModelMutate(int i,int prop){if(prop)props[2].proxy=reinterpret_cast<void*>(&foreignProxy);else{heldBuild=items[i].vtable[175];items[i].vtable[175]=reinterpret_cast<void*>(&foreignBuild);}}
