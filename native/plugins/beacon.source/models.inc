// GPL-3.0. WModelScale field/proxy and BuildTransformations paths, Skeeto 2.2.19.
using ModelBuild=void(__thiscall*)(void*,void*,void*,void*,const float*,int,void*);
using ModelProxy=void(__cdecl*)(const void*,void*,void*);
struct ModelLease{
    uint32_t token=0;L4P_EntityRefV1 ref{};void* object=nullptr;const uint32_t* serial=nullptr;
    int scaleOffset=-1,originOffset=-1,build=-1,proxy=-1;uint32_t method=0;
    float baseline=1,written=1,desired=1;bool releasing=false,allowed=false;
};
struct ModelHook{void** slot=nullptr;std::atomic<void*> original{nullptr};bool foreign=false;};
struct ModelService{
    std::mutex mutex;std::array<ModelLease,2048> leases{};std::map<void*,uint32_t> objects;
    ModelHook builds[16],proxies[12];std::atomic<uint32_t> thread{0};uint32_t epoch=0,conflicts=0,failures=0;
};
ModelService& models(){static auto* m=new ModelService;return *m;}
void model_clear(ModelLease& l){if(l.object)models().objects.erase(l.object);l={};}
ModelLease* model_find(void* object,size_t hook){
    auto& m=models();auto found=m.objects.find(object);if(found==m.objects.end())return nullptr;
    auto& l=m.leases[found->second];return l.object==object&&l.token&&l.build==int(hook)&&l.allowed&&!l.releasing?&l:nullptr;
}
bool model_write(void* to,const void* from,size_t size){SIZE_T done=0;return writable(to,size)&&WriteProcessMemory(GetCurrentProcess(),to,from,size,&done)&&done==size;}
bool model_serial(const ModelLease& l){uint32_t value=0;return l.token&&entity_copy(&value,l.serial,4)&&value==l.ref.handle;}
bool model_object(const ModelLease& l){
    if(!model_serial(l))return false;using Get=void*(__thiscall*)(void*,int);auto fn=method<Get>(entity_service().list,3);
    return fn&&fn(entity_service().list,int(l.ref.index))==l.object;
}
bool model_restore(ModelLease& l){
    if(!l.token)return true;if(!model_object(l)){model_clear(l);return true;}
    float value=0;auto ptr=static_cast<unsigned char*>(l.object)+l.scaleOffset;
    if(!entity_copy(&value,ptr,4))return false;
    if(std::abs(value-l.written)<.0001f&&!model_write(ptr,&l.baseline,4))return false;
    model_clear(l);return true;
}
void model_build(size_t hook,void* self,void* header,void* positions,void* rotations,const float* root,int mask,void* computed){
    auto& m=models();auto native=reinterpret_cast<ModelBuild>(m.builds[hook].original.load(std::memory_order_acquire));if(!native)return;
    bool eligible=GetCurrentThreadId()==m.thread.load(std::memory_order_acquire);
    if(eligible){std::lock_guard<std::mutex> lock(m.mutex);auto l=model_find(self,hook);eligible=l&&model_serial(*l)&&!m.builds[hook].foreign;
        if(eligible){float before=0,one=1;auto ptr=static_cast<unsigned char*>(self)+l->scaleOffset;
            eligible=entity_copy(&before,ptr,4)&&std::isfinite(before);if(eligible){if(std::abs(before-l->written)>=.0001f)l->baseline=before;eligible=model_write(ptr,&one,4);}}}
    // No C++ lock remains across native code; native exceptions propagate.
    native(self,header,positions,rotations,root,mask,computed);if(!eligible)return;
    std::lock_guard<std::mutex> lock(m.mutex);auto lease=model_find(self,hook);
    if(!lease||!model_serial(*lease)||m.builds[hook].foreign)return;auto& l=*lease;
    void* raw=nullptr;float (*matrices)[3][4]=nullptr;unsigned* flags=nullptr;int count=0;float origin[3]{};
    if(!entity_copy(&raw,header,4)||!entity_copy(&count,static_cast<unsigned char*>(raw)+0x9c,4)||count<1||count>128||
        !entity_copy(&flags,static_cast<unsigned char*>(header)+0x2c,4)||!entity_copy(&matrices,static_cast<unsigned char*>(self)+0x6c0,4)||
        !entity_copy(origin,static_cast<unsigned char*>(self)+l.originOffset,12)||!effects_finite(origin)){++m.failures;return;}
    float bones[128][3][4];unsigned boneFlags[128];if(!entity_copy(bones,matrices,count*sizeof(bones[0]))||!entity_copy(boneFlags,flags,count*4)){++m.failures;return;}
    for(int bone=0;bone<count;++bone){if(!(boneFlags[bone]&unsigned(mask)))continue;
        for(int row=0;row<3;++row){for(int col=0;col<3;++col)bones[bone][row][col]*=l.desired;bones[bone][row][3]=origin[row]+(bones[bone][row][3]-origin[row])*l.desired;}
    }
    for(int i=0;i<count;++i)for(auto& row:bones[i])for(float value:row)if(!std::isfinite(value)){++m.failures;return;}
    if(!model_write(matrices,bones,count*sizeof(bones[0])))++m.failures;
}
template<size_t I> void __fastcall model_build_thunk(void* self,void*,void* header,void* positions,void* rotations,const float* root,int mask,void* computed){model_build(I,self,header,positions,rotations,root,mask,computed);}
template<size_t... I> auto model_build_table(std::index_sequence<I...>){return std::array<void*,sizeof...(I)>{reinterpret_cast<void*>(&model_build_thunk<I>)...};}
const auto modelBuildThunks=model_build_table(std::make_index_sequence<16>{});
struct ModelRecv{const void* prop;float value;int padding[2],type,element,objectId;};
static_assert(sizeof(ModelRecv)==28,"native RecvProxyData");
void model_proxy(size_t hook,const void* data,void* entity,void* out){
    auto& m=models();auto original=reinterpret_cast<ModelProxy>(m.proxies[hook].original.load(std::memory_order_acquire));if(!original)return;original(data,entity,out);
    ModelRecv input{};if(GetCurrentThreadId()!=m.thread.load()||!entity_copy(&input,data,sizeof(input))||input.objectId<1||input.objectId>=2048)return;
    std::lock_guard<std::mutex> lock(m.mutex);auto& l=m.leases[input.objectId];
    if(!l.token||!l.allowed||l.releasing||l.proxy!=int(hook)||l.object!=entity||out!=static_cast<unsigned char*>(entity)+l.scaleOffset||!model_serial(l)||m.proxies[hook].foreign)return;
    float native=0;if(!entity_copy(&native,out,4)||!std::isfinite(native)){++m.failures;return;}
    l.baseline=native;l.written=l.method==L4P_MODEL_BONES?1:l.desired;if(!model_write(out,&l.written,4))++m.failures;
}
template<size_t I> void __cdecl model_proxy_thunk(const void* data,void* entity,void* out){model_proxy(I,data,entity,out);}
template<size_t... I> auto model_proxy_table(std::index_sequence<I...>){return std::array<void*,sizeof...(I)>{reinterpret_cast<void*>(&model_proxy_thunk<I>)...};}
const auto modelProxyThunks=model_proxy_table(std::make_index_sequence<12>{});
template<size_t N> int model_attach(ModelHook (&hooks)[N],const std::array<void*,N>& thunks,void** slot){
    void* current=nullptr;if(!entity_copy(&current,slot,4)||!executable(current))return -1;size_t index=N;
    for(size_t i=0;i<N;++i)if(hooks[i].slot==slot){index=i;break;}
    if(index<N){auto& h=hooks[index];if(h.foreign)return -2;if(current==thunks[index])return int(index);
        if(current!=h.original.load()){h.foreign=true;++models().conflicts;return -2;}}
    else{for(size_t i=0;i<N;++i)if(!hooks[i].slot){index=i;break;}if(index==N)return -1;
        for(auto thunk:thunks)if(current==thunk)return -2;
        hooks[index].slot=slot;hooks[index].original.store(current,std::memory_order_release);}
    if(!cvar_swap(slot,current,thunks[index]))return -2;return int(index);
}
template<size_t N> void model_detach(ModelHook (&hooks)[N],const std::array<void*,N>& thunks,const std::array<bool,N>& used){
    auto& m=models();for(size_t i=0;i<N;++i){auto& h=hooks[i];if(!h.slot||h.foreign)continue;void* current=nullptr;
        if(!entity_copy(&current,h.slot,4)){h.foreign=true;++m.conflicts;continue;}
        if(current!=thunks[i]&&current!=h.original.load()){h.foreign=true;++m.conflicts;continue;}
        if(!used[i]&&current==thunks[i]&&!cvar_swap(h.slot,current,h.original.load())){h.foreign=true;++m.conflicts;}
    }
}
void model_detach_unused(){auto& m=models();std::array<bool,16> builds{};std::array<bool,12> proxies{};
    for(auto& pair:m.objects){auto& l=m.leases[pair.second];if(l.token&&!l.releasing&&l.allowed){if(l.build>=0)builds[l.build]=true;if(l.proxy>=0)proxies[l.proxy]=true;}}
    model_detach(m.builds,modelBuildThunks,builds);model_detach(m.proxies,modelProxyThunks,proxies);
}
void models_epoch(){auto& m=models();std::lock_guard<std::mutex> lock(m.mutex);for(auto& l:m.leases)l={};m.objects.clear();m.epoch=entity_service().epoch;model_detach_unused();}
void models_remove(uint32_t token){auto& m=models();std::lock_guard<std::mutex> lock(m.mutex);for(auto& l:m.leases)if(l.token&&(!token||l.token==token)){l.allowed=false;l.releasing=true;}}
// Before entity_epoch on a scope transition, restore still-identical live objects.
void models_scope_pump(){
    auto& m=models();std::lock_guard<std::mutex> lock(m.mutex);m.thread=service().frame.game_thread;
    for(auto& l:m.leases)if(l.token){l.allowed=effects_scope(l.token)==L4P_OK;if(l.releasing||!l.allowed){l.releasing=true;if(!model_restore(l))++m.failures;}}
    model_detach_unused();
}
void models_pump(){
    auto& m=models();std::lock_guard<std::mutex> lock(m.mutex);auto epoch=entity_service().epoch;
    if(m.epoch!=epoch){for(auto& l:m.leases)l={};m.objects.clear();m.epoch=epoch;}
    model_detach_unused();
    for(auto& l:m.leases)if(l.token){
        if(!model_object(l)){model_clear(l);continue;}
        bool foreign=(l.build>=0&&m.builds[l.build].foreign)||(l.proxy>=0&&m.proxies[l.proxy].foreign);
        if(foreign){l.releasing=true;if(!model_restore(l))++m.failures;continue;}
        float current=0;auto ptr=static_cast<unsigned char*>(l.object)+l.scaleOffset;
        if(!entity_copy(&current,ptr,4)||!std::isfinite(current)){++m.failures;continue;}
        if(std::abs(current-l.written)>=.0001f){l.baseline=current;if(!model_write(ptr,&l.written,4))++m.failures;}
    }
    model_detach_unused();
}
uint32_t L4P_CALL model_release(uint32_t token,const L4P_EntityRefV1* ref){
    if(ref&&(ref->index<1||ref->index>=2048))return L4P_BAD_ARGUMENT;
    auto& s=service();std::lock_guard<std::recursive_mutex> sourceLock(s.mutex);
    auto& m=models();std::lock_guard<std::mutex> lock(m.mutex);bool changed=false;
    auto release=[&](ModelLease& l){if(!l.token||l.token!=token)return;l.releasing=true;l.allowed=false;changed=true;if(paintCallback&&!model_restore(l))++m.failures;};
    if(ref){auto& l=m.leases[ref->index];if(l.ref.handle==ref->handle&&l.ref.epoch==ref->epoch)release(l);}
    else if(!m.objects.empty())for(auto& l:m.leases)release(l);
    if(changed&&paintCallback)model_detach_unused();return L4P_OK;
}
uint32_t L4P_CALL model_scale(uint32_t token,const L4P_EntityRefV1* ref,float value,uint32_t mode){
    if(!paintCallback||!ref||!std::isfinite(value)||value<.1f||value>5||mode>L4P_MODEL_BONES)return L4P_BAD_ARGUMENT;
    auto sub=service().subs.find(token);if(sub==service().subs.end()||sub->second->scope!=L4P_SOURCE_LOCAL||effects_scope(token)!=L4P_OK)return L4P_ENTITY_SCOPE;
    EntityRecord* r=nullptr;auto result=entity_resolve(ref,r);if(result!=L4P_OK)return result;
    if(std::abs(value-1)<.0001f)return model_release(token,ref);
    auto field=entity_field(*r,"m_flModelScale"),origin=entity_field(*r,"m_vecOrigin");
    if(field.offset<0||field.offset>0x2000||field.type!=1||!field.prop||(mode==L4P_MODEL_BONES&&(origin.offset<0||origin.offset>0x4000||origin.type!=2)))return L4P_ENTITY_MISSING;
    auto& m=models();std::lock_guard<std::mutex> lock(m.mutex);m.epoch=entity_service().epoch;m.thread=service().frame.game_thread;
    auto& l=m.leases[ref->index];if(l.token&&(!model_serial(l)||l.ref.epoch!=ref->epoch||l.object!=r->entity))model_clear(l);
    if(l.token&&l.token!=token)return L4P_CVAR_CONFLICT;
    float before=0;auto ptr=static_cast<unsigned char*>(r->entity)+field.offset;if(!entity_copy(&before,ptr,4)||!std::isfinite(before))return L4P_ENTITY_MISSING;
    using Handle=const uint32_t*(__thiscall*)(void*);auto handle=method<Handle>(r->entity,2);auto serial=handle?handle(r->entity):nullptr;uint32_t check=0;if(!entity_copy(&check,serial,4)||check!=ref->handle)return L4P_ENTITY_STALE;
    int proxy=model_attach(m.proxies,modelProxyThunks,reinterpret_cast<void**>(field.prop+0x20));if(proxy<0){model_detach_unused();return proxy==-2?L4P_CVAR_CONFLICT:L4P_ENTITY_MISSING;}
    int build=-1;if(mode==L4P_MODEL_BONES){void** table=nullptr;if(!entity_copy(&table,r->entity,4)){model_detach_unused();return L4P_ENTITY_MISSING;}
        build=model_attach(m.builds,modelBuildThunks,table+175);if(build<0){model_detach_unused();return build==-2?L4P_CVAR_CONFLICT:L4P_ENTITY_MISSING;}}
    float target=mode==L4P_MODEL_BONES?1:value;if(!model_write(ptr,&target,4)){model_detach_unused();return L4P_ENTITY_MISSING;}
    const float baseline=l.token?l.baseline:before;l={token,*ref,r->entity,serial,field.offset,origin.offset,build,proxy,mode,baseline,target,value,false,true};m.objects[l.object]=ref->index;return L4P_OK;
}
uint32_t L4P_CALL model_status(L4P_ModelStatusV1* out){
    if(!out||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;auto& m=models();std::lock_guard<std::mutex> lock(m.mutex);L4P_ModelStatusV1 state{sizeof(state)};
    for(auto& l:m.leases)if(l.token)++state.leases;
    for(size_t i=0;i<16;++i)if(m.builds[i].slot&&readable(m.builds[i].slot,4)&&*m.builds[i].slot==modelBuildThunks[i])++state.build_hooks;
    for(size_t i=0;i<12;++i)if(m.proxies[i].slot&&readable(m.proxies[i].slot,4)&&*m.proxies[i].slot==modelProxyThunks[i])++state.proxy_hooks;
    state.conflicts=m.conflicts;state.read_failures=m.failures;*out=state;return L4P_OK;
}
