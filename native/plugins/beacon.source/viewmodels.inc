// GPL-3.0. Skeeto ViewModelBind/Install/Calc and immutable per-Paint poses.
using VmCalc=void(__thiscall*)(void*,void*,const skviewmodel::Vec&,const skviewmodel::Vec&);
using VmSet=void(__thiscall*)(void*,const skviewmodel::Vec&);
using VmBuild=void(__thiscall*)(void*,void*,void*,void*,const float*,int,void*);
using VmInfo=void*(__cdecl*)(int);using VmGetView=const uint8_t*(__thiscall*)(void*,int);
struct VmHook{void** slot=nullptr;std::atomic<void*> original{nullptr};bool foreign=false;};
struct VmBinding{
    L4P_ViewmodelSlotV1 publicInfo{};void* object=nullptr;const uint32_t* serial=nullptr;
    void* header=nullptr;void* raw=nullptr;void* local=nullptr;const uint32_t* localSerial=nullptr;uint32_t localHandle=0;
    int modelOffset=-1,modelIndex=0,scaleOffset=-1,calc=-1,build=-1;
    bool scaleHeld=false;float scaleBefore=1;skviewmodel::Pose pose{};
};
struct VmMirrorOwner{uint16_t handle=0xffff;void* info=nullptr;uint8_t before=0;};
struct VmService{
    std::mutex mutex;std::atomic<uint32_t> thread{0};std::atomic<bool> live{false},nativeFailure{false},mirrorFault{false};
    uint32_t owner=0,epoch=0,generation=0;bool releasing=false;
    VmBinding slots[2];VmHook calcHooks[4],buildHooks[4];VmSet setOrigin=nullptr,setAngles=nullptr;
    VmInfo info=nullptr;void* defaultInfo=nullptr;void** renderer=nullptr;VmGetView getView=nullptr;
    VmMirrorOwner mirrors[2];bool mirrorSlots[2]{};uint32_t mirrorResolve=0,setterState=0;
    L4P_ViewmodelStatusV1 status{sizeof(L4P_ViewmodelStatusV1)};
};
VmService& vm(){static auto* v=new VmService;return *v;}
void vm_mirror_pump();void vm_build_call(size_t,void*,void*,void*,void*,const float*,int,void*);
bool vm_serial(const VmBinding& b){uint32_t serial=0;return b.object&&entity_copy(&serial,b.serial,4)&&serial==b.publicInfo.ref.handle;}
int vm_identity(const VmBinding& b){if(!b.object||b.publicInfo.ref.epoch!=entity_service().epoch)return 0;using Get=void*(__thiscall*)(void*,int);auto get=method<Get>(entity_service().list,3);if(!get)return 2;
    if(get(entity_service().list,int(b.publicInfo.ref.index))!=b.object)return 0;uint32_t serial=0;if(!entity_copy(&serial,b.serial,4))return 2;return serial==b.publicInfo.ref.handle?1:0;}
bool vm_object(const VmBinding& b){return vm_identity(b)==1;}
bool vm_bound(const VmBinding& b){uint16_t index=0;void* header=nullptr;void* raw=nullptr;uint32_t localHandle=0,checksum=0;
    return vm_object(b)&&entity_copy(&localHandle,b.localSerial,4)&&localHandle==b.localHandle&&entity_copy(&index,static_cast<unsigned char*>(b.object)+b.modelOffset,2)&&index==b.modelIndex&&
        entity_copy(&header,static_cast<unsigned char*>(b.object)+0x934,4)&&header==b.header&&entity_copy(&raw,header,4)&&raw==b.raw&&entity_copy(&checksum,static_cast<unsigned char*>(raw)+8,4)&&checksum==b.publicInfo.checksum;
}
bool vm_restore_scale(VmBinding& b){if(!b.scaleHeld)return true;auto identity=vm_identity(b);if(!identity){b.scaleHeld=false;return true;}if(identity==2)return false;float value=0;auto ptr=static_cast<unsigned char*>(b.object)+b.scaleOffset;
    if(!entity_copy(&value,ptr,4))return false;if(std::abs(value-1.f)<.0001f&&!model_write(ptr,&b.scaleBefore,4))return false;b.scaleHeld=false;return true;
}
bool vm_rtti(void* object,void*** table){void* col=nullptr;void* type=nullptr;char name[48]{};
    if(!entity_copy(table,object,4)||uintptr_t(*table)<0x10004||!entity_copy(&col,*table-1,4)||!entity_copy(&type,static_cast<unsigned char*>(col)+12,4))return false;
    copy(name,static_cast<char*>(type)+8);return !strcmp(name,".?AVC_TerrorViewModel@@");
}
bool vm_resolve_setters(){auto& v=vm();if(v.setterState)return v.setterState==1;if(!GetModuleHandleW(L"client.dll"))return false;v.setterState=2;uint32_t count=0;
    const int origin[]={0x55,0x8b,0xec,0x56,0x57,0x8b,0x7d,0x08,0xf3,0x0f,0x10,0x07,0x8b,0xf1,0x0f,0x2e,0x86,0xa0,0,0,0};
    const int angles[]={0x55,0x8b,0xec,0x56,0x57,0x8b,0x7d,0x08,0xf3,0x0f,0x10,0x07,0x8b,0xf1,0x0f,0x2e,0x86,0xc4,0,0,0};
    auto a=find_unique(L"client.dll",origin,std::size(origin),count),b=find_unique(L"client.dll",angles,std::size(angles),count);
    if(!a||!b)return false;v.setOrigin=reinterpret_cast<VmSet>(a);v.setAngles=reinterpret_cast<VmSet>(b);v.setterState=1;return true;
}
struct VmPoseCall{VmSet origin,angles;void* object;skviewmodel::Vec position,rotation;bool rotated;};
void __cdecl vm_pose_call(void* context){auto& c=*static_cast<VmPoseCall*>(context);c.origin(c.object,c.position);if(c.rotated)c.angles(c.object,c.rotation);}
void vm_calc_call(size_t hook,void* self,void* player,const skviewmodel::Vec& eye,const skviewmodel::Vec& angles){
    auto& v=vm();auto native=reinterpret_cast<VmCalc>(v.calcHooks[hook].original.load());if(!native)return;native(self,player,eye,angles);
    if(GetCurrentThreadId()!=v.thread||!v.live)return;VmBinding binding{};VmSet origin=nullptr,setAngles=nullptr;
    {std::lock_guard<std::mutex> lock(v.mutex);++v.status.calls;if(!v.live||v.nativeFailure||v.calcHooks[hook].foreign)return;
        bool found=false;for(const auto& b:v.slots)if(b.object==self&&b.local==player&&b.calc==int(hook)&&b.pose.active&&vm_bound(b)){binding=b;found=true;break;}if(!found)return;
        origin=v.setOrigin;setAngles=v.setAngles;}
    skviewmodel::Vec pos{},rot{},finalPos{},finalRot{};if(!entity_copy(&pos,static_cast<unsigned char*>(self)+0xa0,12)||!entity_copy(&rot,static_cast<unsigned char*>(self)+0xc4,12)||!effects_finite(&pos.x)||!effects_finite(&rot.x)||!effects_finite(&angles.x))return;
    skviewmodel::Apply(binding.pose,angles,pos,rot,&finalPos,&finalRot);if(!effects_finite(&finalPos.x)||!effects_finite(&finalRot.x)||!v.live)return;
    VmPoseCall call{origin,setAngles,self,finalPos,finalRot,binding.pose.rotated};if(!L4P_NativeTry(vm_pose_call,&call)){v.nativeFailure=true;return;}
    std::lock_guard<std::mutex> lock(v.mutex);++v.status.applied;
}
template<size_t I> void __fastcall vm_calc_thunk(void* self,void*,void* player,const skviewmodel::Vec& eye,const skviewmodel::Vec& angles){vm_calc_call(I,self,player,eye,angles);}
template<size_t I> void __fastcall vm_build_thunk(void* self,void*,void* header,void* pos,void* rot,const float* root,int mask,void* computed){vm_build_call(I,self,header,pos,rot,root,mask,computed);}
template<size_t... I> auto vm_calc_table(std::index_sequence<I...>){return std::array<void*,sizeof...(I)>{reinterpret_cast<void*>(&vm_calc_thunk<I>)...};}
template<size_t... I> auto vm_build_table(std::index_sequence<I...>){return std::array<void*,sizeof...(I)>{reinterpret_cast<void*>(&vm_build_thunk<I>)...};}
const auto vmCalcThunks=vm_calc_table(std::make_index_sequence<4>{}),vmBuildThunks=vm_build_table(std::make_index_sequence<4>{});
int vm_attach(VmHook (&hooks)[4],const std::array<void*,4>& thunks,void** slot){
    void* current=nullptr;if(!entity_copy(&current,slot,4)||!executable(current))return -1;int index=-1;
    for(int i=0;i<4;++i)if(hooks[i].slot==slot){index=i;break;}
    if(index>=0){auto& h=hooks[index];if(h.foreign)return -2;if(current==thunks[index])return index;if(current!=h.original.load()){h.foreign=true;return -2;}}
    else {for(int i=0;i<4;++i)if(!hooks[i].slot){index=i;break;}if(index<0)return -1;for(auto fn:thunks)if(fn==current)return -2;hooks[index].slot=slot;hooks[index].original=current;}
    if(!cvar_swap(slot,current,thunks[index]))return -2;return index;
}
void vm_detach(VmHook (&hooks)[4],const std::array<void*,4>& thunks,const bool used[4]){for(int i=0;i<4;++i){auto& h=hooks[i];if(!h.slot||h.foreign)continue;void* current=nullptr;
    if(!entity_copy(&current,h.slot,4)){h.foreign=true;++vm().status.conflicts;continue;}
    if(current!=thunks[i]&&current!=h.original.load()){h.foreign=true;++vm().status.conflicts;continue;}
    if(!used[i]&&current==thunks[i]&&!cvar_swap(h.slot,current,h.original.load())){h.foreign=true;++vm().status.conflicts;}
}}
bool vm_binding(uint32_t handle,void* local,uint32_t localHandle,VmBinding& out){
    L4P_EntityRefV1 ref{};if(entity_handle(handle,&ref))return false;EntityRecord* r=nullptr;if(entity_resolve(&ref,r))return false;void** table=nullptr;if(!vm_rtti(r->entity,&table))return false;
    auto field=entity_field(*r,"m_nModelIndex");if(field.type!=0||field.offset<0||field.offset>0x4000)return false;
    uint16_t index=0;void* header=nullptr;void* raw=nullptr;struct Id{uint32_t magic,version,checksum;} id{};
    if(!entity_copy(&index,static_cast<unsigned char*>(r->entity)+field.offset,2)||!index||index>32767||!entity_copy(&header,static_cast<unsigned char*>(r->entity)+0x934,4)||!entity_copy(&raw,header,4)||!entity_copy(&id,raw,sizeof(id))||id.magic!=0x54534449)return false;
    char model[260]{},normalized[260]{};auto info=iface(L"engine.dll","VModelInfoClient004");if(!entity_model_copy(info,index,model)||!skviewmodel::NormalizeModel(model,normalized))return false;
    using Handle=const uint32_t*(__thiscall*)(void*);auto get=method<Handle>(r->entity,2),getLocal=method<Handle>(local,2);if(!get||!getLocal)return false;
    out={};out.publicInfo={++vm().generation,ref,id.checksum,{}};strcpy(out.publicInfo.model,normalized);out.object=r->entity;out.serial=get(r->entity);out.header=header;out.raw=raw;out.modelOffset=field.offset;out.modelIndex=index;out.local=local;out.localHandle=localHandle;out.localSerial=getLocal(local);
    auto scale=entity_field(*r,"m_flModelScale");if(scale.type==1&&scale.offset>0&&scale.offset<=0x2000)out.scaleOffset=scale.offset;out.pose.scale=1;return true;
}
// Bindings survive a disabled frame for editing, while all mutations are released.
void vm_refresh(){auto& v=vm();uint32_t handles[2]{};EntityRecord* local=entity_record(service().frame.local_player);void* localObject=nullptr;uint32_t localHandle=0;
    if(local){auto f=entity_field(*local,"m_hViewModel[0]");if(f.offset<0)f=entity_field(*local,"m_hViewModel");
        if(f.offset>0&&f.offset<=0x4000&&entity_copy(handles,static_cast<unsigned char*>(local->entity)+f.offset,8)){localObject=local->entity;localHandle=local->handle;}}
    for(int i=0;i<2;++i){auto& b=v.slots[i];if(b.object&&localObject==b.local&&localHandle==b.localHandle&&handles[i]==b.publicInfo.ref.handle&&b.publicInfo.ref.epoch==entity_service().epoch&&vm_bound(b))continue;
        if(!vm_restore_scale(b)){++v.status.failures;continue;}VmBinding replacement{};if(localObject)vm_binding(handles[i],localObject,localHandle,replacement);b=replacement;
    }
}
void vm_remove(uint32_t token){auto& v=vm();std::lock_guard<std::mutex> lock(v.mutex);if(v.owner&&(!token||v.owner==token)){v.live=false;v.releasing=true;}}
void vm_epoch(){auto& v=vm();std::lock_guard<std::mutex> lock(v.mutex);v.live=false;for(auto& b:v.slots)b={};v.releasing=true;v.epoch=entity_service().epoch;}
void vm_pump(){auto& v=vm();std::lock_guard<std::mutex> lock(v.mutex);v.thread=service().frame.game_thread;
    if(v.nativeFailure){v.status.pose_state=3;v.status.mirror_state=3;v.live=false;v.releasing=true;}
    if(v.owner&&(v.releasing||effects_scope(v.owner)!=L4P_OK)){v.live=false;v.status.pose_state=v.nativeFailure?3:0;bool done=true;for(auto& b:v.slots){done=vm_restore_scale(b)&&done;b.pose={};b.pose.scale=1;}
        vm_mirror_pump();bool used[4]{};vm_detach(v.calcHooks,vmCalcThunks,used);vm_detach(v.buildHooks,vmBuildThunks,used);
        for(const auto& owner:v.mirrors)if(owner.info)done=false;if(done){v.owner=0;v.releasing=false;}return;}
    if(!v.live)return;vm_refresh();vm_mirror_pump();
}
uint32_t L4P_CALL vm_snapshot(uint32_t token,L4P_ViewmodelSnapshotV1* out){if(!paintCallback||!out||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;auto code=effects_scope(token);if(code)return code;
    auto& v=vm();std::lock_guard<std::mutex> lock(v.mutex);vm_refresh();L4P_ViewmodelSnapshotV1 result{sizeof(result)};for(int i=0;i<2;++i)result.slots[i]=v.slots[i].publicInfo;*out=result;return L4P_OK;
}
uint32_t L4P_CALL vm_set(uint32_t token,const L4P_ViewmodelPoseV1 poses[2]){if(!paintCallback||!poses)return L4P_BAD_ARGUMENT;auto code=effects_scope(token);if(code)return code;
    for(int i=0;i<2;++i){const auto& p=poses[i];if(p.mirror>1||!std::isfinite(p.scale)||p.scale<.1f||p.scale>5)return L4P_BAD_ARGUMENT;
        for(int k=0;k<3;++k)if(!std::isfinite(p.position[k])||std::abs(p.position[k])>100||!std::isfinite(p.rotation[k])||std::abs(p.rotation[k])>180||!std::isfinite(p.pivot[k])||std::abs(p.pivot[k])>100)return L4P_BAD_ARGUMENT;}
    auto& v=vm();std::lock_guard<std::mutex> lock(v.mutex);if(v.owner&&(v.owner!=token||v.releasing))return L4P_VIEWMODEL_CONFLICT;if(v.nativeFailure)return L4P_ENTITY_MISSING;
    vm_refresh();for(int i=0;i<2;++i)if(poses[i].binding_id!=v.slots[i].publicInfo.binding_id)return L4P_ENTITY_STALE;
    if(!vm_resolve_setters()){v.status.pose_state=2;return L4P_ENTITY_MISSING;}
    bool used[4]{};v.owner=token;v.live=true;v.status.pose_state=0;uint32_t failure=0;
    for(int i=0;i<2;++i){auto& b=v.slots[i];const auto& p=poses[i];b.pose={};b.pose.position={p.position[0],p.position[1],p.position[2]};b.pose.rotation={p.rotation[0],p.rotation[1],p.rotation[2]};b.pose.pivot={p.pivot[0],p.pivot[1],p.pivot[2]};b.pose.scale=p.scale;b.pose.mirror=p.mirror!=0;b.pose.Rebuild();if(!b.object)continue;
        void** table=nullptr;if(!vm_rtti(b.object,&table)){failure=L4P_ENTITY_MISSING;continue;}b.calc=vm_attach(v.calcHooks,vmCalcThunks,table+222);if(b.calc<0){failure=b.calc==-2?L4P_VIEWMODEL_CONFLICT:L4P_ENTITY_MISSING;continue;}used[b.calc]=true;v.status.pose_state=1;
    }vm_detach(v.calcHooks,vmCalcThunks,used);vm_mirror_pump();if(failure)v.status.pose_state=failure==5?5:2;return failure;
}
uint32_t L4P_CALL vm_release(uint32_t token){if(!token)return L4P_BAD_ARGUMENT;vm_remove(token);if(paintCallback)vm_pump();return L4P_OK;}
uint32_t L4P_CALL vm_status(L4P_ViewmodelStatusV1* out){if(!out||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;std::lock_guard<std::mutex> lock(vm().mutex);*out=vm().status;return L4P_OK;}
