// GPL-3.0. Skeeto ViewModelMirror/Scale, retaining native culling and bone mask.
struct VmInfoCall{VmInfo fn;uint16_t handle;void* out=nullptr;};
void __cdecl vm_info_call(void* context){auto& c=*static_cast<VmInfoCall*>(context);c.out=c.fn(c.handle);}
bool vm_lookup(uint16_t handle,void*& out){auto& v=vm();if(!v.info)return false;VmInfoCall c{v.info,handle};if(!L4P_NativeTry(vm_info_call,&c)){v.mirrorFault=true;return false;}out=c.out;return true;}
bool vm_mirror_resolve(){auto& v=vm();if(v.mirrorResolve)return v.mirrorResolve==1;if(!GetModuleHandleW(L"client.dll"))return false;v.mirrorResolve=2;uint32_t count=0;
    const int getter[]={0x55,0x8b,0xec,0x66,0x8b,0x45,0x08,0x66,0x3b,0x05,-1,-1,-1,-1,0x72,0x07,0xb8,-1,-1,-1,-1,0x5d,0xc3,0xb9,0xff,0xff,0,0,0x66,0x3b,0xc1,0x74};
    const int predicate[]={0x8b,0x81,0xc0,0x0b,0,0,0x83,0xf8,0xff,0x74,0x37,0x8b,0x15,-1,-1,-1,-1,0x8b,0xc8,0x81,0xe1,0xff,0x0f,0,0,0x03,0xc9,0x8d,0x4c,0xca,0x04};
    const int viewRead[]={0x8b,0x0d,-1,-1,-1,-1,0x8b,0x01,0x8b,0x50,0x30,0x6a,0xff,0xff,0xd2,0x8d,0x4d,0x9c};
    auto g=find_unique(L"client.dll",getter,std::size(getter),count),p=find_unique(L"client.dll",predicate,std::size(predicate),count),view=find_unique(L"client.dll",viewRead,std::size(viewRead),count);
    const unsigned char expected[]={0x80,0xb8,0x59,0x08,0,0,0};unsigned char bytes[sizeof(expected)]{};
    if(!g||!p||!view||!entity_copy(bytes,p+0x36,sizeof(bytes))||memcmp(bytes,expected,sizeof(bytes))||!entity_copy(&v.defaultInfo,g+0x11,4)||!entity_copy(&v.renderer,view+2,4))return false;
    v.info=reinterpret_cast<VmInfo>(g);v.mirrorResolve=1;return true;
}
bool vm_restore_mirror(VmMirrorOwner& owner){if(!owner.info)return true;void* currentInfo=nullptr;if(!vm_lookup(owner.handle,currentInfo))return false;
    if(currentInfo==owner.info){uint8_t current=0;if(!entity_copy(&current,static_cast<unsigned char*>(owner.info)+0x859,1))return false;
        if(current==(owner.before^1u)&&!model_write(static_cast<unsigned char*>(owner.info)+0x859,&owner.before,1))return false;}
    owner={};return true;
}
bool vm_weapon(const VmBinding& b,uint16_t& handle){uint32_t reference=0,serial=0;
    if(!b.object||!entity_copy(&reference,static_cast<unsigned char*>(b.object)+0xbc0,4)||(reference&0xfff)<1||(reference&0xfff)>=2048)return false;
    using Get=void*(__thiscall*)(void*,int);using Ref=const uint32_t*(__thiscall*)(void*);auto get=method<Get>(entity_service().list,3);if(!get)return false;auto weapon=get(entity_service().list,reference&0xfff);auto ref=method<Ref>(weapon,2);
    return ref&&entity_copy(&serial,ref(weapon),4)&&serial==reference&&entity_copy(&handle,static_cast<unsigned char*>(weapon)+0x9da,2);
}
void vm_mirror_pump(){auto& v=vm();bool scaleWanted[2]{},mirrored[2]{};bool anyScale=false,anyMirror=false;uint16_t handles[2]={0xffff,0xffff};
    v.status.scale_state=0;v.status.mirror_state=v.mirrorFault?3:0;
    for(int i=0;i<2;++i){auto& b=v.slots[i];const bool live=v.live&&b.object&&b.calc>=0&&!v.calcHooks[b.calc].foreign;
        scaleWanted[i]=live&&std::abs(b.pose.scale-1.f)>.0001f;anyScale|=scaleWanted[i];mirrored[i]=live&&b.pose.mirror&&!v.mirrorFault;anyMirror|=mirrored[i];
        // Keep the field at one while the feature owns this VM; preserve its
        // original/native values for cleanup instead of forcing one on disable.
        if(live&&b.scaleOffset>=0){float value=0,one=1;auto ptr=static_cast<unsigned char*>(b.object)+b.scaleOffset;
            if(entity_copy(&value,ptr,4)&&std::isfinite(value)){if(!b.scaleHeld||std::abs(value-1.f)>.0001f)b.scaleBefore=value;
                if(model_write(ptr,&one,4))b.scaleHeld=true;else{v.status.scale_state=3;++v.status.failures;}}
        }else if(!vm_restore_scale(b)){v.status.scale_state=3;++v.status.failures;}
    }
    bool conflict=false;if(anyMirror){const bool mixed=mirrored[0]!=mirrored[1];bool unknown=false;
        for(int i=0;i<2;++i)if(v.slots[i].object&&(mirrored[i]||mixed))if(!vm_weapon(v.slots[i],handles[i]))unknown=true;
        conflict=mixed&&(unknown||(handles[0]!=0xffff&&handles[0]==handles[1]));
        if(conflict){anyMirror=false;mirrored[0]=mirrored[1]=false;v.status.mirror_state=5;}
        else if(!vm_mirror_resolve()){anyMirror=false;mirrored[0]=mirrored[1]=false;v.status.mirror_state=v.mirrorResolve;}
    }
    for(int i=0;i<2;++i)if(!mirrored[i])handles[i]=0xffff;
    for(auto& owner:v.mirrors)if(owner.info&&(!anyMirror||(owner.handle!=handles[0]&&owner.handle!=handles[1])))if(!vm_restore_mirror(owner)){v.status.mirror_state=3;++v.status.failures;}
    if(anyMirror)for(auto handle:handles){if(handle==0xffff)continue;bool have=false;
        for(auto& owner:v.mirrors)if(owner.info&&owner.handle==handle){void* info=nullptr;if(vm_lookup(handle,info)&&info==owner.info){uint8_t current=0;
                    if(entity_copy(&current,static_cast<unsigned char*>(info)+0x859,1)&&current==(owner.before^1u))have=true;
                    else {v.mirrorFault=true;v.status.mirror_state=3;}}
                else if(info!=owner.info)owner={};}
        if(have)continue;void* info=nullptr;if(!vm_lookup(handle,info)||!info||info==v.defaultInfo)continue;uint8_t original=0;
        if(!entity_copy(&original,static_cast<unsigned char*>(info)+0x859,1)||original>1){v.mirrorFault=true;break;}
        for(auto& owner:v.mirrors)if(!owner.info){uint8_t desired=original^1u;if(!model_write(static_cast<unsigned char*>(info)+0x859,&desired,1)){v.mirrorFault=true;break;}owner={handle,info,original};break;}
    }
    if(v.mirrorFault){anyMirror=false;mirrored[0]=mirrored[1]=false;v.status.mirror_state=3;for(auto& owner:v.mirrors)if(!vm_restore_mirror(owner))++v.status.failures;}
    bool used[4]{};for(int i=0;i<2;++i){auto& b=v.slots[i];v.mirrorSlots[i]=false;b.build=-1;bool owned=false;
        if(mirrored[i])for(auto& owner:v.mirrors)if(owner.info&&owner.handle==handles[i])owned=true;
        if(!owned&&!scaleWanted[i])continue;void** table=nullptr;if(!vm_rtti(b.object,&table))continue;
        b.build=vm_attach(v.buildHooks,vmBuildThunks,table+175);if(b.build<0){if(owned)v.status.mirror_state=b.build==-2?5:2;if(scaleWanted[i])v.status.scale_state=b.build==-2?5:2;continue;}
        used[b.build]=true;v.mirrorSlots[i]=owned;if(owned)v.status.mirror_state=1;if(scaleWanted[i]&&!v.status.scale_state)v.status.scale_state=1;
    }vm_detach(v.buildHooks,vmBuildThunks,used);
    // A failed build hook must not leave only native culling mirrored.
    for(auto& owner:v.mirrors)if(owner.info){bool usedOwner=false;for(int i=0;i<2;++i)if(v.mirrorSlots[i]&&owner.handle==handles[i])usedOwner=true;if(!usedOwner&&!vm_restore_mirror(owner))++v.status.failures;}
}
struct VmBuildCall{VmBuild fn;void* self;void* header;void* positions;void* rotations;const float* root;int mask;void* computed;void* info=nullptr;uint8_t mirrored=0;};
void __cdecl vm_native_build(void* context){auto& c=*static_cast<VmBuildCall*>(context);c.fn(c.self,c.header,c.positions,c.rotations,c.root,c.mask,c.computed);}
void __cdecl vm_build_cleanup(void* context){auto& c=*static_cast<VmBuildCall*>(context);if(c.info&&!model_write(static_cast<unsigned char*>(c.info)+0x859,&c.mirrored,1))vm().mirrorFault=true;}
struct VmCameraCall{VmGetView get;void* renderer;const uint8_t* view=nullptr;};
void __cdecl vm_camera_call(void* context){auto& c=*static_cast<VmCameraCall*>(context);c.view=c.get(c.renderer,-1);}
// Keep culling and matrices consistent in the same render call if a read or
// native camera fails. Paint retains failed field restorations for retry.
void vm_build_failure(bool mirror,bool scale){auto& v=vm();std::lock_guard<std::mutex> lock(v.mutex);++v.status.failures;
    if(scale)v.status.scale_state=3;if(mirror){v.mirrorFault=true;v.status.mirror_state=3;
        v.mirrorSlots[0]=v.mirrorSlots[1]=false;for(auto& owner:v.mirrors)vm_restore_mirror(owner);}}
void vm_build_call(size_t hook,void* self,void* header,void* positions,void* rotations,const float* root,int mask,void* computed){auto& v=vm();auto native=reinterpret_cast<VmBuild>(v.buildHooks[hook].original.load());if(!native)return;
    VmBinding binding{};VmMirrorOwner owner{};bool eligible=false,mirror=false;float scale=1;
    if(GetCurrentThreadId()==v.thread&&v.live){std::lock_guard<std::mutex> lock(v.mutex);
        if(v.live&&!v.buildHooks[hook].foreign)for(int i=0;i<2;++i){auto& b=v.slots[i];if(b.object==self&&b.build==int(hook)&&vm_bound(b)){binding=b;eligible=true;scale=b.pose.scale;mirror=v.mirrorSlots[i]&&!v.mirrorFault;
            if(mirror){uint16_t handle=0xffff;if(!vm_weapon(b,handle))mirror=false;else for(const auto& candidate:v.mirrors)if(candidate.info&&candidate.handle==handle){owner=candidate;break;}if(!owner.info)mirror=false;}break;}}
    }
    VmBuildCall call{native,self,header,positions,rotations,root,mask,computed};
    if(mirror){VmInfoCall lookup{v.info,owner.handle};uint8_t current=0;
        if(!L4P_NativeTry(vm_info_call,&lookup)||lookup.out!=owner.info||!entity_copy(&current,static_cast<unsigned char*>(owner.info)+0x859,1)||current!=(owner.before^1u)||!model_write(static_cast<unsigned char*>(owner.info)+0x859,&owner.before,1)){v.mirrorFault=true;mirror=false;eligible=false;}
        else {call.info=owner.info;call.mirrored=current;}}
    // Cleanup runs through native SEH as well as normal return, with no C++ lock.
    if(call.info)L4P_NativeFinally(vm_native_build,&call,vm_build_cleanup);else vm_native_build(&call);
    if(!eligible||!v.live||(!mirror&&std::abs(scale-1.f)<.0001f))return;
    {std::lock_guard<std::mutex> lock(v.mutex);bool current=false;for(const auto& b:v.slots)if(b.publicInfo.binding_id==binding.publicInfo.binding_id&&vm_bound(b))current=true;if(!current||!v.live)return;}
    void* raw=nullptr;float (*matrices)[3][4]=nullptr;unsigned* flags=nullptr;int count=0;
    if(!entity_copy(&raw,header,4)||raw!=binding.raw||!entity_copy(&count,static_cast<unsigned char*>(raw)+0x9c,4)||count<1||count>128||!entity_copy(&flags,static_cast<unsigned char*>(header)+0x2c,4)||!entity_copy(&matrices,static_cast<unsigned char*>(self)+0x6c0,4)){vm_build_failure(mirror,true);return;}
    float bones[128][3][4];unsigned boneFlags[128];if(!entity_copy(bones,matrices,count*sizeof(bones[0]))||!entity_copy(boneFlags,flags,count*4)){vm_build_failure(mirror,true);return;}
    for(int i=0;i<count;++i)for(auto& row:bones[i])for(auto value:row)if(!std::isfinite(value)){vm_build_failure(mirror,true);return;}
    skviewmodel::Vec pivot{};int used=0;for(int i=0;i<count;++i)if(boneFlags[i]&unsigned(mask)){pivot.x+=bones[i][0][3];pivot.y+=bones[i][1][3];pivot.z+=bones[i][2][3];++used;}
    if(used&&std::abs(scale-1.f)>.0001f){pivot.x/=used;pivot.y/=used;pivot.z/=used;float center[]={pivot.x,pivot.y,pivot.z};
        for(int i=0;i<count;++i)if(boneFlags[i]&unsigned(mask))for(int row=0;row<3;++row){for(int col=0;col<3;++col)bones[i][row][col]*=scale;bones[i][row][3]=center[row]+(bones[i][row][3]-center[row])*scale;}}
    if(mirror){void* renderer=nullptr;bool ok=v.renderer&&entity_copy(&renderer,v.renderer,4);auto get=method<VmGetView>(renderer,12);VmCameraCall cameraCall{get,renderer};struct Camera{skviewmodel::Vec origin,angles;} camera{};
        ok=ok&&get&&L4P_NativeTry(vm_camera_call,&cameraCall)&&cameraCall.view&&entity_copy(&camera,cameraCall.view+0x3c,sizeof(camera))&&effects_finite(&camera.origin.x)&&effects_finite(&camera.angles.x);
        if(!ok)vm_build_failure(true,false);else{auto basis=skviewmodel::AngleMatrix(camera.angles);float normal[]={basis.m[0][1],basis.m[1][1],basis.m[2][1]},eye[]={camera.origin.x,camera.origin.y,camera.origin.z};
            for(int i=0;i<count;++i)if(boneFlags[i]&unsigned(mask))for(int col=0;col<4;++col){float dot=0;for(int row=0;row<3;++row)dot+=normal[row]*(bones[i][row][col]-(col==3?eye[row]:0));for(int row=0;row<3;++row)bones[i][row][col]-=2*normal[row]*dot;}}}
    for(int i=0;i<count;++i)for(auto& row:bones[i])for(auto value:row)if(!std::isfinite(value)){vm_build_failure(mirror,true);return;}
    if(!model_write(matrices,bones,count*sizeof(bones[0])))vm_build_failure(mirror,true);
    else{std::lock_guard<std::mutex> lock(v.mutex);++v.status.builds;v.status.matrices+=used;}
}
