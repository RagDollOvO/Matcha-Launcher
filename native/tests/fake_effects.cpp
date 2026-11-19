// Owned trace/dlight fixture. Raw layouts intentionally mirror Source x86 ABI.
#define NOMINMAX
#include <windows.h>
#include <map>
#include <cstring>
#include <cstdint>
#include <algorithm>
namespace {
struct alignas(16) Vec {float x,y,z,w;};struct Ray {Vec start,delta,offset,extents;void* transform;bool ray,swept;};
struct Light {int flags;float origin[3],radius;uint8_t red,green,blue;int8_t exponent;float die,decay,minLight;int key,style;float direction[3],inner,outer;};
static_assert(sizeof(Ray)==80&&sizeof(Light)==64,"effect ABI");
void* traceVt[6]{};void* effectsVt[5]{};struct Obj{void** vt;}trace{traceVt},effects{effectsVt};
std::map<int,Light> lights;float ceiling=100000.f,now=20.f;int calls=0,filterMode=-1;uint32_t lastMask=0;
bool forceTarget=false;float target[3]{},lastSegment[6]{};int skipOK=0;void* hitEntity=nullptr;
float roomDistance=-1;
void __fastcall traceRay(void*,void*,const Ray* ray,uint32_t mask,void* filter,void* result){
    ++calls;lastMask=mask;using Kind=int(__thiscall*)(void*);filterMode=reinterpret_cast<Kind>((*static_cast<void***>(filter))[1])(filter);
    auto raw=static_cast<unsigned char*>(result);memset(raw,0,84);float from[3]={ray->start.x,ray->start.y,ray->start.z};float delta[3]={ray->delta.x,ray->delta.y,ray->delta.z};
    float fraction=1;if(delta[2]>0&&ceiling<from[2]+delta[2])fraction=std::clamp((ceiling-from[2])/delta[2],0.f,1.f);
    if(roomDistance>=0)fraction=std::clamp(roomDistance/2000.f,0.f,1.f);
    memcpy(lastSegment,from,12);for(int i=0;i<3;++i)lastSegment[i+3]=from[i]+delta[i];
    if(!filterMode){auto skip=static_cast<void**>(filter)[1];using Hit=bool(__thiscall*)(void*,void*,int);skipOK=skip&&!reinterpret_cast<Hit>((*static_cast<void***>(filter))[0])(filter,skip,0);}
    memcpy(raw,from,12);float end[3];for(int i=0;i<3;++i)end[i]=forceTarget?target[i]:from[i]+delta[i]*fraction;memcpy(raw+12,end,12);memcpy(raw+44,&fraction,4);memcpy(raw+76,&hitEntity,4);
}
Light* __fastcall allocate(void*,void*,int key){auto& light=lights[key];light.key=key;return &light;}
}
void* FixtureEffectsInterface(const char* name){traceVt[5]=reinterpret_cast<void*>(&traceRay);effectsVt[4]=reinterpret_cast<void*>(&allocate);if(!strcmp(name,"EngineTraceClient003"))return &trace;if(!strcmp(name,"VEngineEffects001"))return &effects;return nullptr;}
float FixtureEffectsTime(){return now;}
extern "C" __declspec(dllexport) void __cdecl FixtureTraceEntity(void* entity){hitEntity=entity;}
extern "C" __declspec(dllexport) void __cdecl FixtureCeiling(float z){ceiling=z;}
extern "C" __declspec(dllexport) void __cdecl FixtureRoomDistance(float distance){roomDistance=distance;}
extern "C" __declspec(dllexport) uint32_t __cdecl FixtureTraceMask(){return lastMask;}
extern "C" __declspec(dllexport) void __cdecl FixtureEffectsReset(){lights.clear();calls=0;}
extern "C" __declspec(dllexport) int __cdecl FixtureTraceCalls(){return calls;}
extern "C" __declspec(dllexport) int __cdecl FixtureTraceWorld(){return filterMode==1&&lastMask==0x46004003;}
extern "C" __declspec(dllexport) void __cdecl FixtureTraceTarget(int on,float x,float y,float z){forceTarget=on!=0;target[0]=x;target[1]=y;target[2]=z;}
extern "C" __declspec(dllexport) int __cdecl FixtureTraceSegment(float* out){memcpy(out,lastSegment,sizeof(lastSegment));return skipOK&&filterMode==0&&lastMask==0x46004003;}
extern "C" __declspec(dllexport) int __cdecl FixtureLight(void* output){for(auto& p:lights)if(p.second.radius>0&&p.second.die>now){if(output)memcpy(output,&p.second,64);return 1;}return 0;}
