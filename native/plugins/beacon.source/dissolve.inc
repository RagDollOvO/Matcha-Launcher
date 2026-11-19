// GPL-3.0. Skeeto ClientUxDissolve native boundary. Scheduling stays in the DLL.
using DissAlloc=void*(__cdecl*)(int);using DissCtor=void*(__thiscall*)(void*);
using DissModel=void(__thiscall*)(void*,const void*);using DissParent=void(__thiscall*)(void*,void*,int);
using DissOrigin=void(__thiscall*)(void*,const float*);using DissDelete=void(__thiscall*)(void*,void*);
using DissFlags=void(__thiscall*)(void*,int);using DissEffect=void(__thiscall*)(void*,void*);
using DissFind=const void*(__thiscall*)(void*,const char*);
struct DissNative {DissAlloc alloc=nullptr;DissCtor ctor=nullptr;DissModel model=nullptr;DissParent parent=nullptr;DissOrigin origin=nullptr;
    DissDelete remove=nullptr;DissFlags flags=nullptr;DissEffect effect=nullptr;DissFind find=nullptr;void** manager=nullptr;void** table=nullptr;void* modelInfo=nullptr;
    int flagOffset=-1,effectOffset=-1;const void* glow=nullptr;bool glowTried=false;};
struct DissLife {int user=0;uint32_t epoch=0,touched=0;};
struct DissField {int offset=-1;uint32_t before=0,last=0;bool present=false,owned=false;};
struct DissLease {
    uint32_t token=0,category=0,until=0;CorpseLease identity{};int user=0;uint32_t life=0;
    void* fx=nullptr;const uint32_t* fxSerial=nullptr;uint32_t fxHandle=0xffffffffu;
    DissField fields[5];bool player=false,common=false,hidden=false,releasing=false,finished=false,attached=false,constructed=false,registered=false;
};
struct DissRecent {L4P_EntityRefV1 ref;uint32_t at;};
struct DissService {DissNative native;std::vector<DissLease> leases;std::vector<DissRecent> recent;DissLife lives[64]{};
    uint32_t lifeSerial=0,entityEpoch=0;L4P_DissolveStatusV1 status{sizeof(L4P_DissolveStatusV1)};};
DissService& dissolve(){static auto* s=new DissService;return *s;}
bool diss_same(const L4P_EntityRefV1& a,const L4P_EntityRefV1& b){return a.index==b.index&&a.handle==b.handle&&a.epoch==b.epoch;}
bool diss_target_owned(const L4P_EntityRefV1& ref){for(const auto& l:dissolve().leases)if(diss_same(l.identity.ref,ref))return true;return false;}
bool diss_player_class(const char* name){return strstr(name,"TerrorPlayer")||strstr(name,"CSPlayer")||!_stricmp(name,"C_BasePlayer")||!_stricmp(name,"CBasePlayer");}
bool diss_common_class(const char* name){return !_stricmp(name,"Infected")||!_stricmp(name,"C_Infected");}
bool diss_witch_class(const char* name){return !_stricmp(name,"Witch")||!_stricmp(name,"C_Witch");}
bool diss_special_class(const char* name){for(auto n:{"Tank","Boomer","Hunter","Smoker","Jockey","Charger","Spitter"})if(!_stricmp(name,n))return true;return false;}
void diss_fault(){auto& s=dissolve();s.status.backend=3;++s.status.failures;}
bool diss_bytes(const void* ptr,const std::initializer_list<unsigned char>& expected){unsigned char bytes[32];return expected.size()<=sizeof(bytes)&&entity_copy(bytes,ptr,expected.size())&&!memcmp(bytes,expected.begin(),expected.size());}
void* diss_call_target(const unsigned char* call){int32_t relative=0;unsigned char op=0;if(!entity_copy(&op,call,1)||op!=0xe8||!entity_copy(&relative,call+1,4))return nullptr;auto address=const_cast<unsigned char*>(call+5+relative);return executable(address)?address:nullptr;}
bool diss_resolve(){auto& s=dissolve();if(s.status.backend)return s.status.backend==1;if(!GetModuleHandleW(L"client.dll"))return false;
    s.status.backend=2;auto& n=s.native;std::vector<int> pattern(0x103,-1);
    auto bytes=[&](size_t at,std::initializer_list<int> data){std::copy(data.begin(),data.end(),pattern.begin()+at);};
    bytes(0,{0x55,0x8b,0xec,0x56,0x68,0x80,0x06,0,0,0xe8});bytes(0x17,{0xe8});bytes(0x24,{0x8b,0x90,0x70,0x01,0,0});bytes(0x39,{0x8b,0x0d});bytes(0x3f,{0x56,0xe8});
    bytes(0x4e,{0x68});bytes(0x55,{0xe8});bytes(0x5a,{0x6a,0,0x57,0x8b,0xce,0xe8});bytes(0x64,{0x8b,0x46,8,0x8b,0x50,0x10,0x8d,0x4e,8,0x6a,0,0xff,0xd2});
    bytes(0x7a,{0x50,0x8b,0xce,0xe8});bytes(0x87,{0xf3,0x0f,0x11,0x86,0x3c,0x06,0,0});bytes(0xfe,{0xe8});uint32_t count=0;
    auto fn=find_unique(L"client.dll",pattern.data(),pattern.size(),count);if(!fn)return false;
    n.alloc=reinterpret_cast<DissAlloc>(diss_call_target(fn+9));n.ctor=reinterpret_cast<DissCtor>(diss_call_target(fn+0x17));n.remove=reinterpret_cast<DissDelete>(diss_call_target(fn+0x40));
    n.flags=reinterpret_cast<DissFlags>(diss_call_target(fn+0x55));n.parent=reinterpret_cast<DissParent>(diss_call_target(fn+0x5f));n.origin=reinterpret_cast<DissOrigin>(diss_call_target(fn+0x7d));n.effect=reinterpret_cast<DissEffect>(diss_call_target(fn+0xfe));
    if(!n.alloc||!n.ctor||!n.remove||!n.flags||!n.parent||!n.origin||!n.effect||!entity_copy(&n.manager,fn+0x3b,4))return false;
    unsigned char ctor[0x40]{};if(!entity_copy(ctor,reinterpret_cast<void*>(n.ctor),sizeof(ctor)))return false;
    for(size_t i=0;i+6<=sizeof(ctor);++i)if(ctor[i]==0xc7&&ctor[i+1]==6){memcpy(&n.table,ctor+i+2,4);break;}
    void* first=nullptr,*init=nullptr;if(!entity_copy(&first,n.table,4)||!entity_copy(&init,n.table+92,4)||!executable(first)||!executable(init))return false;
    const int modelPattern[]={0x55,0x8b,0xec,0x56,0x57,0x8b,0x7d,8,0x8b,0xf1,0x3b,0x7e,0x60,0x74,0x41};
    n.model=reinterpret_cast<DissModel>(find_unique(L"client.dll",modelPattern,std::size(modelPattern),count));if(!n.model)return false;
    n.modelInfo=iface(L"engine.dll","VModelInfoClient004");if(!n.modelInfo)n.modelInfo=iface(L"engine.dll","VModelInfoClient006");n.find=method<DissFind>(n.modelInfo,41);if(!n.find)return false;
    // Verify the native flag OR and effect-handle setter before capturing fields.
    auto flag=reinterpret_cast<unsigned char*>(n.flags),effect=reinterpret_cast<unsigned char*>(n.effect);int offset2=0,offset3=0;
    if(!diss_bytes(flag,{0x55,0x8b,0xec,0x8b,0x45,8,0x09,0x81})||!entity_copy(&n.flagOffset,flag+8,4)||n.flagOffset<=0||n.flagOffset>0x4000)return false;
    if(!diss_bytes(effect,{0x55,0x8b,0xec,0x56,0x8b,0xf1,0x8b,0x86})||!entity_copy(&n.effectOffset,effect+8,4)||n.effectOffset<=0||n.effectOffset>0x4000||
        !diss_bytes(effect+0x4d,{0x89,0x8e})||!entity_copy(&offset2,effect+0x4f,4)||!diss_bytes(effect+0x58,{0xc7,0x86})||!entity_copy(&offset3,effect+0x5a,4)||offset2!=n.effectOffset||offset3!=n.effectOffset)return false;
    s.status.backend=1;return true;
}
uint32_t L4P_CALL diss_life(int32_t user,uint32_t* epoch){if(!callbackThread||user<=0||!epoch)return L4P_BAD_ARGUMENT;auto& s=dissolve();DissLife* oldest=&s.lives[0];auto now=service().frame.time_ms;
    for(auto& value:s.lives){if(value.user==user){value.touched=now;*epoch=value.epoch;return L4P_OK;}if(!value.user){oldest=&value;break;}if(int32_t(now-value.touched)>int32_t(now-oldest->touched))oldest=&value;}
    *oldest={user,++s.lifeSerial,now};*epoch=oldest->epoch;return L4P_OK;
}
bool diss_life_same(const DissLease& l){if(!l.user)return true;for(auto& life:dissolve().lives)if(life.user==l.user)return life.epoch==l.life;return false;}
void diss_spawn(void* event){int user=event_int(event,"userid",0);if(user<=0)return;for(auto& life:dissolve().lives)if(life.user==user){life.epoch=++dissolve().lifeSerial;life.touched=service().frame.time_ms;}}
bool diss_is_fx(void* object){void** table=nullptr;return object&&entity_copy(&table,object,4)&&table==dissolve().native.table;}
int diss_fx_identity(const DissLease& l){if(!l.constructed||!l.fx)return 0;void** table=nullptr;
    if(!entity_copy(&table,l.fx,4)){MEMORY_BASIC_INFORMATION page{};return VirtualQuery(l.fx,&page,sizeof(page))&&page.State!=MEM_COMMIT?0:2;}
    if(table!=dissolve().native.table)return 0;if(!l.registered)return 1;
    uint32_t serial=0;if(!l.fxSerial||!entity_copy(&serial,l.fxSerial,4))return 2;return serial==l.fxHandle?1:0;}
struct DissDeleteCall {void* manager;void* fx;};
void __cdecl diss_delete_call(void* context){auto& c=*static_cast<DissDeleteCall*>(context);dissolve().native.remove(c.manager,c.fx);}
bool diss_delete(DissLease& l){if(!l.fx)return true;int identity=diss_fx_identity(l);if(identity==2)return false;if(!identity){l.fx=nullptr;return true;}void* manager=nullptr;auto& n=dissolve().native;
    if(!entity_copy(&manager,n.manager,4)||!readable(manager,4))return false;DissDeleteCall call{manager,l.fx};if(!L4P_NativeTry(diss_delete_call,&call)){diss_fault();return false;}l.fx=nullptr;return true;
}
struct DissIdentityCall {const DissLease* lease;int result=2;};
void __cdecl diss_identity_call(void* context){auto& c=*static_cast<DissIdentityCall*>(context);c.result=corpse_identity(c.lease->identity);}
int diss_identity(const DissLease& l){if(!diss_life_same(l))return 0;DissIdentityCall call{&l};
    if(!L4P_NativeTry(diss_identity_call,&call)){diss_fault();return 2;}return call.result;}
bool diss_restore(DissLease& l){int identity=diss_identity(l);if(!identity)return true;if(identity==2)return false;bool complete=true;
    auto base=static_cast<unsigned char*>(l.identity.object);uint32_t effect=0;if(l.attached&&(!entity_copy(&effect,base+dissolve().native.effectOffset,4)))return false;
    // A new native effect owns its own fade; preserve those fields wholesale.
    if(l.attached&&effect!=l.fxHandle&&effect!=0xffffffffu){for(auto& f:l.fields)f.present=false;l.attached=false;return true;}
    for(unsigned i=0;i<5;++i){auto& f=l.fields[i];if(!f.present||!f.owned)continue;uint32_t current=0;size_t bytes=i==1?1:4;auto ptr=base+f.offset;
        if(!entity_copy(&current,ptr,bytes)){complete=false;continue;}
        if(i==0){if((current&32u)!=(f.last&32u)){f.present=false;continue;}current=(current&~32u)|(f.before&32u);}
        else if(i==3){if((current&0x10000000u)!=(f.last&0x10000000u)){f.present=false;continue;}current=(current&~0x10000000u)|(f.before&0x10000000u);}
        else if(i==4){if(current!=l.fxHandle&&current!=0xffffffffu){f.present=false;continue;}current=0xffffffffu;}
        else {if(!l.attached&&current!=f.last){f.present=false;continue;}current=f.before;}
        if(!model_write(ptr,&current,bytes)){complete=false;continue;}f.present=false;
    }return complete;
}
bool diss_hide(DissLease& l){if(l.player||l.common||diss_identity(l)!=1)return true;bool ok=true;auto base=static_cast<unsigned char*>(l.identity.object);
    for(unsigned i:{0u,1u}){auto& f=l.fields[i];if(!f.present)continue;uint32_t value=0;size_t bytes=i==1?1:4;if(!entity_copy(&value,base+f.offset,bytes)){ok=false;continue;}
        value=i==0?value|32u:10u;if(!model_write(base+f.offset,&value,bytes)){ok=false;continue;}f.last=value;f.owned=true;}l.hidden=true;return ok;
}
void diss_epoch(){auto& s=dissolve();s.leases.clear();s.recent.clear();s.native.glow=nullptr;s.native.glowTried=false;s.entityEpoch=entity_service().epoch;for(auto& life:s.lives)life={};
    if(s.status.backend==2)s.status.backend=0;
}
void diss_pump(){auto& s=dissolve();if(s.entityEpoch!=entity_service().epoch)diss_epoch();auto now=GetTickCount();
    for(auto i=s.leases.begin();i!=s.leases.end();){auto& l=*i;int identity=diss_identity(l);
        bool release=l.releasing||effects_scope(l.token)!=L4P_OK||s.status.backend==3;
        if(!identity){if(diss_delete(l)){i=s.leases.erase(i);continue;}++i;continue;}
        if(identity==2){++i;continue;}
        if(release){bool removed=diss_delete(l);if(removed&&diss_restore(l)){i=s.leases.erase(i);continue;}++i;continue;}
        if(l.fx&&(diss_fx_identity(l)==0||int32_t(now-l.until)>=0)){if(!diss_delete(l)){++i;continue;}++s.status.finished;l.finished=true;if(l.player)l.releasing=true;else diss_hide(l);}
        if(l.player&&l.finished&&diss_restore(l)){i=s.leases.erase(i);continue;}++i;
    }
    s.recent.erase(std::remove_if(s.recent.begin(),s.recent.end(),[&](const auto& r){return r.ref.epoch!=entity_service().epoch||int32_t(now-r.at)>2000;}),s.recent.end());
}
void diss_remove(uint32_t token,uint32_t category=L4P_DISSOLVE_ALL){for(auto& lease:dissolve().leases)if((!token||lease.token==token)&&(category==2||lease.category==category))lease.releasing=true;}
uint32_t L4P_CALL diss_release(uint32_t token,uint32_t category){if(!token||category>2)return L4P_BAD_ARGUMENT;std::lock_guard<std::recursive_mutex> lock(service().mutex);diss_remove(token,category);if(paintCallback)diss_pump();return L4P_OK;}
uint32_t L4P_CALL diss_busy(const L4P_EntityRefV1* ref,uint32_t* busy){if(!paintCallback||!ref||!busy)return L4P_BAD_ARGUMENT;auto& s=dissolve();*busy=0;
    for(const auto& lease:s.leases)if(diss_same(lease.identity.ref,*ref)){*busy=1;return L4P_OK;}
    for(const auto& r:s.recent)if(diss_same(r.ref,*ref)&&int32_t(GetTickCount()-r.at)<=2000){*busy=1;break;}return L4P_OK;
}
struct DissCreateCall {DissLease* lease;uint32_t type,duration;float time,origin[3];bool haveOrigin=false;void* storage=nullptr;bool success=false;};
void __cdecl diss_create_call(void* context){auto& c=*static_cast<DissCreateCall*>(context);auto& n=dissolve().native;auto& l=*c.lease;
    if(!n.glowTried){n.glowTried=true;for(const auto path:{"sprites/glow01.vmt","sprites/light_glow01.vmt","sprites/glow.vmt","sprites/laserbeam.vmt"}){n.glow=n.find(n.modelInfo,path);if(n.glow)break;}}
    c.storage=n.alloc(0x680);if(!c.storage)return;l.fx=n.ctor(c.storage);l.constructed=diss_is_fx(l.fx);if(!l.constructed)return;
    using Init=bool(__thiscall*)(void*,const char*,int);auto init=method<Init>(l.fx,92);if(!init||!init(l.fx,nullptr,0))return;
    using Ref=const uint32_t*(__thiscall*)(void*);auto handle=method<Ref>(l.fx,2);if(!handle)return;l.fxSerial=handle(l.fx);if(!entity_copy(&l.fxHandle,l.fxSerial,4)||l.fxHandle==0xffffffffu)return;l.registered=true;
    auto net=static_cast<unsigned char*>(l.fx)+8;using Data=void(__thiscall*)(void*,int);auto data=method<Data>(net,4);if(!data)return;
    if(n.glow)n.model(l.fx,n.glow);if(!l.player){l.fields[3].owned=true;l.fields[3].last|=0x10000000u;n.flags(l.identity.object,0x10000000);}
    n.parent(l.fx,l.identity.object,0);data(net,0);
    using Origin=const float*(__thiscall*)(void*);auto getOrigin=method<Origin>(l.identity.object,11);float absolute[3]{};
    if(getOrigin&&entity_copy(absolute,getOrigin(l.identity.object),sizeof(absolute))&&std::isfinite(absolute[0])&&std::isfinite(absolute[1])&&std::isfinite(absolute[2]))n.origin(l.fx,absolute);
    else if(c.haveOrigin)n.origin(l.fx,c.origin);
    float scale=float(c.duration)/550.f;float timing[]={c.time,0,.45f*scale,.02f*scale,.28f*scale,.02f*scale,.35f*scale};
    if(!model_write(static_cast<unsigned char*>(l.fx)+0x63c,timing,sizeof(timing)))return;
    if(!model_write(static_cast<unsigned char*>(l.fx)+0x658,&c.type,4))return;float spark=c.time+.06f;uint8_t flag=0;
    if(!model_write(static_cast<unsigned char*>(l.fx)+0x65c,&spark,4)||!model_write(static_cast<unsigned char*>(l.fx)+0x678,&flag,1))return;
    if(diss_identity(l)!=1)return;l.attached=true;for(unsigned i:{0u,1u,2u,4u})l.fields[i].owned=l.fields[i].present;
    n.effect(l.identity.object,l.fx);c.success=true;
}
struct DissHandleCall {void* object;const uint32_t* serial=nullptr;};
void __cdecl diss_handle_call(void* context){auto& c=*static_cast<DissHandleCall*>(context);using Ref=const uint32_t*(__thiscall*)(void*);auto handle=method<Ref>(c.object,2);if(handle)c.serial=handle(c.object);}
uint32_t L4P_CALL diss_start(uint32_t token,const L4P_DissolveRequestV1* request){if(!paintCallback||!request||request->struct_size!=sizeof(*request)||request->category>1||request->type>3||request->duration_ms<200||request->duration_ms>2000)return L4P_BAD_ARGUMENT;
    auto code=effects_scope(token);if(code)return code;diss_pump();auto& s=dissolve();if(!diss_resolve())return L4P_ENTITY_MISSING;
    EntityRecord* r=nullptr;code=entity_resolve(&request->target,r);if(code)return code;L4P_EntityInfoV1 info{sizeof(info)};if(entity_describe(&request->target,&info))return L4P_ENTITY_MISSING;
    auto corpse=corpses.find(request->target.index);if(corpse!=corpses.end()&&corpse_identity(corpse->second))return L4P_DISSOLVE_CONFLICT;
    bool player=request->target.index<=64||diss_player_class(info.class_name),common=diss_common_class(info.class_name);
    if(!player&&!common&&!diss_witch_class(info.class_name)&&!corpse_class(info.class_name)&&!diss_special_class(info.class_name))return L4P_BAD_ARGUMENT;
    if(player){int team=0;uint32_t life=0;if(request->player_user<=0||info.user_id!=request->player_user||entity_read(&request->target,"m_iTeamNum",L4P_FIELD_INT,&team)||team!=3||diss_life(request->player_user,&life)||life!=request->player_life)return L4P_ENTITY_STALE;}
    uint32_t busy=0;diss_busy(&request->target,&busy);if(busy)return L4P_DISSOLVE_CONFLICT;unsigned active=0,ci=0;for(const auto& l:s.leases)if(l.fx){++active;if(l.common)++ci;}
    if(active>=6||(common&&ci>=3)||s.leases.size()>=256)return L4P_DISSOLVE_LIMIT;
    DissLease l{};l.token=token;l.category=request->category;l.player=player;l.common=common;l.user=player?request->player_user:0;l.life=request->player_life;l.until=GetTickCount()+request->duration_ms;
    DissHandleCall handle{r->entity};if(!L4P_NativeTry(diss_handle_call,&handle)){diss_fault();return L4P_ERROR;}if(!handle.serial)return L4P_ENTITY_MISSING;
    l.identity.token=token;l.identity.ref=request->target;l.identity.object=r->entity;l.identity.serial=handle.serial;l.identity.klass=r->klass;
    const char* names[]={"m_fEffects","m_nRenderMode","m_clrRender"};auto base=static_cast<unsigned char*>(r->entity);
    for(unsigned i=0;i<5;++i){auto& f=l.fields[i];if(i<3){auto prop=entity_field(*r,names[i]);if(prop.type!=0||prop.offset<=0||prop.offset>0x4000)continue;f.offset=prop.offset;}else f.offset=i==3?s.native.flagOffset:s.native.effectOffset;
        size_t bytes=i==1?1:4;if(!entity_copy(&f.before,base+f.offset,bytes))return L4P_ENTITY_MISSING;f.last=f.before;f.present=true;}
    // SetEffect releases the old native effect; leave an existing effect alone.
    if(l.fields[4].before!=0xffffffffu)return L4P_DISSOLVE_CONFLICT;
    if(player)l.fields[3].present=false;float origin[3]{},time=0;bool haveOrigin=!entity_read(&request->target,"m_vecOrigin",L4P_FIELD_VECTOR,origin)&&std::isfinite(origin[0])&&std::isfinite(origin[1])&&std::isfinite(origin[2]);
    if(entity_time(&time)||!std::isfinite(time))return L4P_ENTITY_MISSING;
    DissCreateCall call{&l,request->type,request->duration_ms,time,{origin[0],origin[1],origin[2]},haveOrigin};
    const uint32_t failuresBefore=s.status.failures;bool nativeOk=L4P_NativeTry(diss_create_call,&call)!=0;
    if(!nativeOk)diss_fault();
    if(!nativeOk||!call.success){
        // A constructor that faulted has no completed native destructor contract.
        // Stop this backend after one such allocation instead of retrying leaks.
        if(call.storage&&!l.constructed){++s.status.orphans;l.fx=nullptr;if(s.status.backend!=3)diss_fault();}
        l.releasing=true;if(!diss_delete(l)||!diss_restore(l))s.leases.push_back(l);if(s.status.failures==failuresBefore)++s.status.failures;return L4P_ERROR;
    }
    for(unsigned i=0;i<5;++i)if(l.fields[i].present)entity_copy(&l.fields[i].last,base+l.fields[i].offset,i==1?1:4);
    diss_hide(l);s.leases.push_back(l);if(s.recent.size()==16)s.recent.erase(s.recent.begin());s.recent.push_back({request->target,GetTickCount()});++s.status.started;return L4P_OK;
}
uint32_t L4P_CALL diss_clean(uint32_t token){if(!paintCallback)return L4P_BAD_ARGUMENT;auto code=effects_scope(token);if(code)return code;
    using Fn=void(__thiscall*)(void*,const char*);auto fn=method<Fn>(service().engine,107);if(!fn)return L4P_ENTITY_MISSING;fn(service().engine,"cl_destroy_ragdolls");return L4P_OK;}
uint32_t L4P_CALL diss_status(uint32_t token,L4P_DissolveStatusV1* out){if(!out||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;std::lock_guard<std::recursive_mutex> lock(service().mutex);auto status=dissolve().status;
    status.active=status.common_active=status.retained=status.common_retained=status.special_retained=0;
    for(const auto& l:dissolve().leases)if(!token||l.token==token){++status.retained;if(l.category==L4P_DISSOLVE_COMMON)++status.common_retained;else ++status.special_retained;if(l.fx){++status.active;if(l.common)++status.common_active;}}*out=status;return L4P_OK;}
