// GPL-3.0. Native trace / dlight layouts from Skeeto 2.2.19.
struct alignas(16) EffectsVector {float x,y,z,w;};
struct EffectsRay {EffectsVector start,delta,offset,extents;const void* transform;bool ray,swept;};
struct EffectsTrace {
    float start[3],end[3],normal[3],planeDistance;uint8_t planeType,signBits,pad[2];
    float fraction;int contents;uint16_t dispFlags;bool allSolid,startSolid;float leftSolid;
    const char* surface;int16_t surfaceProp;uint16_t surfaceFlags;int hitGroup;int16_t bone;uint16_t worldIndex;void* entity;int hitBox;
};
static_assert(sizeof(EffectsTrace)==84&&sizeof(EffectsRay)==80,"Source trace ABI");
struct EffectsLight {int flags;float origin[3],radius;uint8_t red,green,blue;int8_t exponent;float die,decay,minLight;int key,style;float direction[3],inner,outer;};
static_assert(sizeof(EffectsLight)==64,"Source dlight ABI");
struct EffectsFilter {void** vtable;void* skip;bool world;};
bool __fastcall effects_hit(void* self,void*,void* entity,int){auto f=static_cast<EffectsFilter*>(self);return !f->world&&entity!=f->skip;}
int __fastcall effects_type(void* self,void*){return static_cast<EffectsFilter*>(self)->world?1:0;}
void* effectsFilterVtable[]={reinterpret_cast<void*>(&effects_hit),reinterpret_cast<void*>(&effects_type)};
struct LightLease {int key;bool live=false,releasing=false;};
struct EffectsService {void* trace=nullptr;void* effects=nullptr;int next=0x464c0000;std::map<std::pair<uint32_t,uint32_t>,LightLease> lights;};
EffectsService& effects_service(){static auto* e=new EffectsService;return *e;}
bool effects_finite(const float* p){return p&&std::isfinite(p[0])&&std::isfinite(p[1])&&std::isfinite(p[2])&&std::abs(p[0])<1e7&&std::abs(p[1])<1e7&&std::abs(p[2])<1e7;}
uint32_t effects_scope(uint32_t token){
    auto& s=service();auto sub=s.subs.find(token);if(!s.running||sub==s.subs.end()||!sub->second->active)return L4P_BAD_ARGUMENT;
    return allowed(&s.frame,sub->second->scope)?L4P_OK:L4P_ENTITY_SCOPE;
}
uint32_t L4P_CALL effects_trace(uint32_t token,const float* from,const float* to,uint32_t mask,uint32_t world,const L4P_EntityRefV1* skip,L4P_TraceV1* out){
    if(!paintCallback||!effects_finite(from)||!effects_finite(to)||world>1||!out||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    auto status=effects_scope(token);if(status!=L4P_OK)return status;EntityRecord* ignore=nullptr;
    if(skip){status=entity_resolve(skip,ignore);if(status!=L4P_OK)return status;}
    auto& e=effects_service();if(!e.trace)e.trace=iface(L"engine.dll","EngineTraceClient003");
    using Trace=void(__thiscall*)(void*,const EffectsRay*,uint32_t,void*,void*);auto trace=method<Trace>(e.trace,5);if(!trace)return L4P_ENTITY_MISSING;
    EffectsRay ray{};ray.start={from[0],from[1],from[2],0};ray.delta={to[0]-from[0],to[1]-from[1],to[2]-from[2],0};ray.ray=true;ray.swept=ray.delta.x||ray.delta.y||ray.delta.z;
    EffectsFilter filter{effectsFilterVtable,ignore?ignore->entity:nullptr,world!=0};alignas(16) unsigned char raw[512]{};
    trace(e.trace,&ray,mask,&filter,raw);EffectsTrace native{};memcpy(&native,raw,sizeof(native));
    if(!effects_finite(native.end)||!std::isfinite(native.fraction)||native.fraction<0||native.fraction>1)return L4P_ERROR;
    L4P_TraceV1 result{sizeof(result)};memcpy(result.end,native.end,sizeof(result.end));memcpy(result.normal,native.normal,sizeof(result.normal));result.fraction=native.fraction;
    result.all_solid=native.allSolid;result.start_solid=native.startSolid;result.contents=native.contents;result.hit_group=native.hitGroup;result.hit_box=native.hitBox;
    if(native.entity){using Ref=const uint32_t*(__thiscall*)(void*);auto ref=method<Ref>(native.entity,2);uint32_t handle=0;
        if(ref&&entity_copy(&handle,ref(native.entity),4)){L4P_EntityRefV1 hit{};if(entity_handle(handle,&hit)==L4P_OK){auto r=entity_record(hit.index);if(r&&r->entity==native.entity)result.hit=hit;}}}
    *out=result;return L4P_OK;
}
EffectsLight* effects_allocate(int key){
    auto& e=effects_service();if(!e.effects)e.effects=iface(L"engine.dll","VEngineEffects001");
    using Allocate=EffectsLight*(__thiscall*)(void*,int);auto allocate=method<Allocate>(e.effects,4);if(!allocate)return nullptr;
    auto light=allocate(e.effects,key);return writable(light,sizeof(*light))?light:nullptr;
}
bool effects_destroy(LightLease& lease){
    if(!lease.live)return true;float now=0;auto result=entity_time(&now);if(result!=L4P_OK)return false;
    auto light=effects_allocate(lease.key);if(!light)return false;
    light->radius=0;light->decay=0;light->die=now-.01f;lease.live=false;return true;
}
void effects_epoch(){for(auto& p:effects_service().lights)p.second.live=false;}
void effects_pump(){
    auto& lights=effects_service().lights;
    for(auto i=lights.begin();i!=lights.end();){bool release=i->second.releasing||effects_scope(i->first.first)!=L4P_OK;
        if(release&&effects_destroy(i->second)){i=lights.erase(i);continue;}++i;}
}
void effects_unsubscribe(uint32_t token){for(auto& p:effects_service().lights)if(p.first.first==token)p.second.releasing=true;}
uint32_t L4P_CALL effects_light(uint32_t token,uint32_t id,const L4P_LightV1* input){
    if(!paintCallback||id>15||!input||input->struct_size!=sizeof(*input)||!effects_finite(input->origin)||!std::isfinite(input->radius)||input->radius<0||input->radius>4096||!std::isfinite(input->ttl)||input->ttl<.01f||input->ttl>1||input->exponent<-16||input->exponent>16)return L4P_BAD_ARGUMENT;
    auto status=effects_scope(token);if(status!=L4P_OK)return status;float now=0;status=entity_time(&now);if(status!=L4P_OK)return status;
    auto& e=effects_service();auto key=std::make_pair(token,id);auto found=e.lights.find(key);
    if(found==e.lights.end()){if(e.lights.size()>=2048||e.next==0x464fffff)return L4P_ERROR;found=e.lights.emplace(key,LightLease{e.next++}).first;}
    auto light=effects_allocate(found->second.key);if(!light)return L4P_ENTITY_MISSING;
    EffectsLight value{};memcpy(value.origin,input->origin,sizeof(value.origin));value.radius=input->radius;value.red=input->red;value.green=input->green;value.blue=input->blue;value.exponent=input->exponent;
    value.die=now+input->ttl;value.key=found->second.key;value.direction[2]=-1;*light=value;found->second.live=true;found->second.releasing=false;return L4P_OK;
}
uint32_t L4P_CALL effects_drop(uint32_t token,uint32_t id){
    if(id>15)return L4P_BAD_ARGUMENT;auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);
    auto& lights=effects_service().lights;auto found=lights.find({token,id});if(found==lights.end())return L4P_OK;
    found->second.releasing=true;if(paintCallback)effects_pump();return L4P_OK;
}
