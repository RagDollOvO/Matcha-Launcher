// Private entity fixture for corpse field lifecycle; never shipped.
#define NOMINMAX
#include <windows.h>
#include <map>
#include <string>
#include <cstring>
#include <cstdint>
#include <cstddef>
struct Prop{const char* name;int type;char pad[32];void* child;int offset;char tail[12];};static_assert(sizeof(Prop)==0x3c,"RecvProp");
struct Table{Prop* props;int count;void* decoder;const char* name;};
struct Class{void* create;void* event;const char* name;Table* table;Class* next;int id;};
void* entityVt[3]{},*netVt[2]{},*listVt[7]{};
struct Entity{void** vt;uint32_t handle;int effects;uint8_t mode,pad[3];uint32_t colour;float origin[3];};
Prop props[]={{"m_fEffects",0,{},nullptr,offsetof(Entity,effects),{}},{"m_nRenderMode",0,{},nullptr,offsetof(Entity,mode),{}},{"m_clrRender",0,{},nullptr,offsetof(Entity,colour),{}},{"m_vecOrigin",2,{},nullptr,offsetof(Entity,origin),{}}};Table table{props,4,nullptr,"DT_CorpseFixture"};
std::map<std::string,Class> classes;struct Network{void** vt=netVt;Class* klass=nullptr;};
std::map<int,Entity*> objects;std::map<int,Network> networks;int lookups=0,highCalls=0;
struct List{void** vt=listVt;}list;
const uint32_t* __fastcall handle(void* self,void*){return &static_cast<Entity*>(self)->handle;}
Class* __fastcall klass(void* self,void*){return static_cast<Network*>(self)->klass;}
void* __fastcall get(void*,void*,int index){++lookups;auto i=objects.find(index);return i==objects.end()?nullptr:i->second;}
void* __fastcall net(void*,void*,int index){auto i=networks.find(index);return i==networks.end()?nullptr:&i->second;}
int __fastcall highest(void*,void*){++highCalls;return objects.empty()?0:objects.rbegin()->first;}
extern "C" __declspec(dllexport) void* __cdecl CreateInterface(const char* name,int*){
    entityVt[2]=reinterpret_cast<void*>(&handle);netVt[1]=reinterpret_cast<void*>(&klass);listVt[0]=reinterpret_cast<void*>(&net);listVt[3]=reinterpret_cast<void*>(&get);listVt[6]=reinterpret_cast<void*>(&highest);return !strcmp(name,"VClientEntityList003")?&list:nullptr;
}
extern "C" __declspec(dllexport) void __cdecl FixturePut(int index,const char* name,int effects,int mode,uint32_t colour,uint32_t serial){
    auto& object=objects[index];if(!object)object=static_cast<Entity*>(VirtualAlloc(nullptr,4096,MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE));
    DWORD old=0;VirtualProtect(object,4096,PAGE_READWRITE,&old);*object={entityVt,(serial<<12)|uint32_t(index),effects,uint8_t(mode),{},colour,{1,2,3}};
    auto& c=classes[name];c={nullptr,nullptr,classes.find(name)->first.c_str(),&table,nullptr,1};networks[index]={netVt,&c};
}
extern "C" __declspec(dllexport) uint32_t __cdecl FixtureValue(int index,int field){auto e=objects.at(index);return field==0?e->effects:field==1?e->mode:field==2?e->colour:uint32_t(e->origin[0]);}
extern "C" __declspec(dllexport) void __cdecl FixtureEdit(int index,int effects,int mode,uint32_t colour){auto e=objects.at(index);e->effects=effects;e->mode=uint8_t(mode);e->colour=colour;}
extern "C" __declspec(dllexport) void __cdecl FixtureAccess(int index,uint32_t protection){DWORD old=0;VirtualProtect(objects.at(index),4096,protection,&old);}
extern "C" __declspec(dllexport) int __cdecl FixtureGuard(int index){MEMORY_BASIC_INFORMATION m{};VirtualQuery(objects.at(index),&m,sizeof(m));return (m.Protect&PAGE_GUARD)!=0;}
extern "C" __declspec(dllexport) void __cdecl FixtureRemove(int index){objects.erase(index);networks.erase(index);}
extern "C" __declspec(dllexport) int __cdecl FixtureHighestCalls(){return highCalls;}
