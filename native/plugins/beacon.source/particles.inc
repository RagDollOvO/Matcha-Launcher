// GPL-3.0. Skeeto 2.2.19 particle dispatch and manifest extension.
// The setup worker touches executable entries only; engine file access stays
// on the original manifest thread. The hook never takes Source's mutex.
using ParticleDispatch=void(__cdecl*)(const char*,float*,float*,int,int,int);
using ParticlePrecache=int(__cdecl*)(const char*);
using ParticleFind=int(__thiscall*)(void*,const char*);
using ParticleManifest=void(__cdecl*)(void*);
using ParticleManifestFile=void(__cdecl*)(void*,const char*);
struct ParticleManifestConfig{uint32_t token,limit;char prefix[64];};
struct ParticleBudget{uint32_t since=0,count=0,dispatched=0,throttled=0;};
struct ParticleService{
    std::mutex mutex;
    std::shared_ptr<const ParticleManifestConfig> config;
    HANDLE stop=nullptr,worker=nullptr;
    std::atomic<void*> original{nullptr};std::atomic<ParticleManifestFile> parser{nullptr};
    std::atomic<uint32_t> manifestState{0},appended{0},manifestFailures{0};
    unsigned char* target=nullptr;unsigned char originalBytes[6]{},patch[6]{};
    bool created=false,enabled=false;uint32_t retryAt=0;
    ParticleDispatch dispatch=nullptr;ParticlePrecache precache=nullptr;ParticleFind find=nullptr;void** manager=nullptr;
    uint32_t backend=0,failures=0;std::map<uint32_t,ParticleBudget> budgets;
};
ParticleService& particles(){static auto* p=new ParticleService;return *p;}
bool particle_owner(uint32_t token){auto& s=service();auto it=s.subs.find(token);return s.running&&it!=s.subs.end()&&it->second->active;}
struct ParticleAppendCall{void* list;void* fs;ParticleManifestFile parser;const ParticleManifestConfig* config;int handle=-1;uint32_t appended=0;};
void __cdecl particle_append(void* context){
    auto& c=*static_cast<ParticleAppendCall*>(context);
    using First=const char*(__thiscall*)(void*,const char*,const char*,int*);using Next=const char*(__thiscall*)(void*,int);using Dir=bool(__thiscall*)(void*,int);
    auto first=method<First>(c.fs,32);auto next=method<Next>(c.fs,29);auto dir=method<Dir>(c.fs,30);if(!first||!next||!dir||!slot(c.fs,31))return;
    char glob[96]{};snprintf(glob,sizeof(glob),"particles/%s*.txt",c.config->prefix);
    auto name=first(c.fs,glob,"GAME",&c.handle);
    for(uint32_t visited=0;name&&visited<4096&&c.appended<c.config->limit;++visited){
        if(!dir(c.fs,c.handle)&&name[0]&&name[0]!='.'){
            char path[260]{};const int n=snprintf(path,sizeof(path),"particles/%s",name);
            if(n>0&&n<int(sizeof(path))){c.parser(c.list,path);++c.appended;}
        }if(c.appended>=c.config->limit)break;name=next(c.fs,c.handle);
    }
}
void __cdecl particle_append_close(void* context){auto& c=*static_cast<ParticleAppendCall*>(context);if(c.handle==-1)return;
    using Close=void(__thiscall*)(void*,int);auto close=method<Close>(c.fs,31);if(close)close(c.fs,c.handle);c.handle=-1;
}
void __cdecl particle_append_guarded(void* context){L4P_NativeFinally(particle_append,context,particle_append_close);}
void __cdecl particle_manifest_hook(void* list){
    auto& p=particles();auto original=reinterpret_cast<ParticleManifest>(p.original.load(std::memory_order_acquire));if(original)original(list);
    auto config=std::atomic_load(&p.config);auto parser=p.parser.load(std::memory_order_acquire);
    if(!config||!list||!parser||p.manifestState.load()!=2)return;
    auto fs=iface(L"filesystem_stdio.dll","VFileSystem018");if(!fs)return;
    ParticleAppendCall call{list,fs,parser,config.get()};
    if(!L4P_NativeTry(particle_append_guarded,&call)){++p.manifestFailures;p.manifestState=4;}
    p.appended+=call.appended;
}
void particle_setup(){
    auto& p=particles();std::lock_guard<std::mutex> lock(p.mutex);
    auto config=std::atomic_load(&p.config);if(!config||p.manifestState.load()>=3)return;
    if(p.enabled){unsigned char bytes[6]{};if(!entity_copy(bytes,p.target,sizeof(bytes))||memcmp(bytes,p.patch,sizeof(bytes)))p.manifestState=5;return;}
    if(!GetModuleHandleW(L"client.dll"))return;const auto now=GetTickCount();if(p.retryAt&&int32_t(now-p.retryAt)<0)return;
    if(!p.target){uint32_t count=0;
        const int manifest[]={0x55,0x8b,0xec,0x8b,0x45,0x08,0x68,-1,-1,-1,-1,0x50,0xe8,-1,-1,-1,-1,0x83,0xc4,0x08,0x5d,0xc3};
        const int parser[]={0x55,0x8b,0xec,0x83,0xec,0x14,0x6a,0x2c,0xe8,-1,-1,-1,-1,0x83,0xc4,0x04,0x85,0xc0,0x74,0x14,0x8b,0x4d,0x0c,0x6a};
        p.target=find_unique(L"client.dll",manifest,std::size(manifest),count);auto parse=find_unique(L"client.dll",parser,std::size(parser),count);
        if(!p.target||!parse){p.manifestState=3;return;}
        if(!entity_copy(p.originalBytes,p.target,sizeof(p.originalBytes))){p.manifestState=4;return;}
        p.parser.store(reinterpret_cast<ParticleManifestFile>(parse),std::memory_order_release);
    }
    if(memcmp(p.target,p.originalBytes,sizeof(p.originalBytes))){p.manifestState=5;return;}
    MH_STATUS result=MH_OK;if(!p.created){result=MH_Initialize();if(result==MH_OK||result==MH_ERROR_ALREADY_INITIALIZED){
        void* original=nullptr;result=MH_CreateHook(p.target,reinterpret_cast<void*>(&particle_manifest_hook),&original);
        if(result==MH_OK){p.original.store(original,std::memory_order_release);p.created=true;}
    }}
    if(result==MH_OK){p.manifestState=2;result=MH_EnableHook(p.target);}
    if(result!=MH_OK){p.manifestState=1;p.retryAt=now+1000;return;}
    memcpy(p.patch,p.target,sizeof(p.patch));p.enabled=true;p.retryAt=0;
}
DWORD WINAPI particle_worker(void*){auto& p=particles();while(WaitForSingleObject(p.stop,p.enabled?500:25)==WAIT_TIMEOUT)particle_setup();return 0;}
uint32_t L4P_CALL particle_boot(uint32_t token,const char* prefix,uint32_t limit){
    if(!prefix||!*prefix||strnlen(prefix,64)>=64||!limit||limit>48||strspn(prefix,"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")!=strlen(prefix))return L4P_BAD_ARGUMENT;
    auto& s=service();std::lock_guard<std::recursive_mutex> sourceLock(s.mutex);if(!particle_owner(token))return L4P_BAD_ARGUMENT;
    auto& p=particles();std::lock_guard<std::mutex> lock(p.mutex);auto old=std::atomic_load(&p.config);if(old&&old->token!=token)return L4P_CVAR_CONFLICT;
    if(!p.worker){p.stop=CreateEventW(nullptr,TRUE,FALSE,nullptr);if(!p.stop)return L4P_ERROR;
        p.worker=CreateThread(nullptr,0,particle_worker,nullptr,0,nullptr);if(!p.worker){CloseHandle(p.stop);p.stop=nullptr;return L4P_ERROR;}}
    auto next=std::make_shared<ParticleManifestConfig>();next->token=token;next->limit=limit;strcpy(next->prefix,prefix);
    std::atomic_store(&p.config,std::shared_ptr<const ParticleManifestConfig>(std::move(next)));if(!p.manifestState.load())p.manifestState=1;return L4P_OK;
}
void particle_remove(uint32_t token){auto& p=particles();auto config=std::atomic_load(&p.config);if(!token||(config&&config->token==token))std::atomic_store(&p.config,std::shared_ptr<const ParticleManifestConfig>{});if(token)p.budgets.erase(token);else p.budgets.clear();}
uint32_t L4P_CALL particle_release(uint32_t token){auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);if(!token)return L4P_BAD_ARGUMENT;particle_remove(token);return L4P_OK;}
void particle_shutdown(){auto& p=particles();std::atomic_store(&p.config,std::shared_ptr<const ParticleManifestConfig>{});
    if(p.stop)SetEvent(p.stop);if(p.worker){WaitForSingleObject(p.worker,INFINITE);CloseHandle(p.worker);p.worker=nullptr;}if(p.stop){CloseHandle(p.stop);p.stop=nullptr;}
}
bool particle_resolve(){auto& p=particles();if(p.backend)return p.backend==1;if(!GetModuleHandleW(L"client.dll"))return false;uint32_t count=0;
    const int dispatch[]={0x55,0x8b,0xec,0x8b,0x45,0x08,0x50,0xe8,-1,-1,-1,-1,0x8b,0x4d,0x1c,0x8b,0x55,0x18,0x51,0x8b,0x4d,0x14,0x52,0x8b};
    const int precache[]={0x55,0x8b,0xec,0x8b,0x0d,-1,-1,-1,-1,0x85,0xc9,0x75,0x07,0xb8};
    const int find[]={0x55,0x8b,0xec,0x51,0x53,0x8b,0x5d,0x08,0x56,0x8b,0xb1,0x8c};
    const int manager[]={0x0c,0x8b,0x0d,-1,-1,-1,-1,0x52,0x50,0xe8};
    p.dispatch=reinterpret_cast<ParticleDispatch>(find_unique(L"client.dll",dispatch,std::size(dispatch),count));
    p.precache=reinterpret_cast<ParticlePrecache>(find_unique(L"client.dll",precache,std::size(precache),count));
    p.find=reinterpret_cast<ParticleFind>(find_unique(L"client.dll",find,std::size(find),count));
    auto ref=find_unique(L"client.dll",manager,std::size(manager),count);if(ref)entity_copy(&p.manager,ref+3,4);
    p.backend=p.dispatch&&p.precache?1:2;return p.backend==1;
}
bool particle_name(const char* name){if(!name||!*name||strnlen(name,64)>=64)return false;for(auto p=name;*p;++p)if(static_cast<unsigned char>(*p)<32)return false;return true;}
struct ParticleCall{const char* name;float origin[3]{},angles[3]{};int operation,result=-1;void* manager=nullptr;};
void __cdecl particle_call(void* context){auto& c=*static_cast<ParticleCall*>(context);auto& p=particles();
    if(c.operation==0)c.result=p.precache(c.name);else if(c.operation==1)c.result=p.find(c.manager,c.name);else p.dispatch(c.name,c.origin,c.angles,2,0,0);
}
uint32_t particle_native(ParticleCall& call){if(!L4P_NativeTry(particle_call,&call)){auto& p=particles();++p.failures;p.backend=3;return L4P_ERROR;}return L4P_OK;}
uint32_t L4P_CALL particle_precache(uint32_t token,const char* name){if(!paintCallback||!particle_name(name))return L4P_BAD_ARGUMENT;auto code=effects_scope(token);if(code)return code;if(!particle_resolve())return L4P_ENTITY_MISSING;ParticleCall call{name,{},{},0};return particle_native(call);}
uint32_t L4P_CALL particle_exists(uint32_t token,const char* name,uint32_t* present){
    if(!paintCallback||!present||!particle_name(name))return L4P_BAD_ARGUMENT;auto code=effects_scope(token);if(code)return code;if(!particle_resolve())return L4P_ENTITY_MISSING;auto& p=particles();
    ParticleCall call{name,{},{},1};if(!p.find||!p.manager||!entity_copy(&call.manager,p.manager,4)||!call.manager)return L4P_ENTITY_MISSING;
    code=particle_native(call);if(!code)*present=call.result!=0;return code;
}
uint32_t L4P_CALL particle_dispatch(uint32_t token,const char* name,const float origin[3],uint32_t world){
    if(!paintCallback||!particle_name(name)||!origin||world>1||!std::isfinite(origin[0])||!std::isfinite(origin[1])||!std::isfinite(origin[2]))return L4P_BAD_ARGUMENT;
    auto code=effects_scope(token);if(code)return code;if(!particle_resolve())return L4P_ENTITY_MISSING;auto& p=particles();auto& budget=p.budgets[token];const auto now=service().frame.time_ms;
    if(!budget.since||uint32_t(now-budget.since)>=1000){budget.since=now;budget.count=0;}if(budget.count>=32){++budget.throttled;return L4P_ERROR;}++budget.count;
    ParticleCall call{name,{},{},2};if(world){std::copy(origin,origin+3,call.origin);call.angles[1]=270;}
    code=particle_native(call);if(!code)++budget.dispatched;return code;
}
uint32_t L4P_CALL particle_status(uint32_t token,L4P_ParticleStatusV1* out){
    if(!out||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);if(!particle_owner(token))return L4P_BAD_ARGUMENT;
    auto& p=particles();auto config=std::atomic_load(&p.config);auto b=p.budgets.find(token);ParticleBudget budget{};if(b!=p.budgets.end())budget=b->second;
    *out={sizeof(*out),p.backend,config&&config->token==token?p.manifestState.load():0,p.appended.load(),budget.dispatched,budget.throttled,p.failures+p.manifestFailures.load()};return L4P_OK;
}
