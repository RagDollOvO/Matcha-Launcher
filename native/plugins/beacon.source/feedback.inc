// GPL-3.0. Skeeto's player m_iHealth receive observation and r_screenoverlay.
using HealthProxy=void(__cdecl*)(const void*,void*,void*);
struct HealthHook{void** slot=nullptr;std::atomic<void*> original{nullptr};bool foreign=false;};
struct HealthSlot{L4P_EntityRefV1 ref{};void* object=nullptr;const uint32_t* serial=nullptr;void* output=nullptr;int hook=-1,team=0,user=0;uint32_t generation=0;};
struct HealthSample{L4P_HealthDropV1 data{};void* object=nullptr;uint32_t generation=0;};
struct HealthWatcher{std::vector<HealthSample> queue;bool active=false;};
struct FeedbackService{
    std::mutex mutex;HealthHook hooks[8];HealthSlot slots[65];std::map<uint32_t,HealthWatcher> watchers;uint32_t generation=0;
    uint32_t overlayOwner=0,restoreAt=0;void* overlayCommand=nullptr;int beforeFlags=0,writtenFlags=0;bool clearing=false,clearSent=false;
};
FeedbackService& feedback(){static auto* f=new FeedbackService;return *f;}
void health_proxy(size_t index,const void* data,void* object,void* output){
    auto& h=feedback();auto original=reinterpret_cast<HealthProxy>(h.hooks[index].original.load(std::memory_order_acquire));if(!original)return;
    int id=0,before=0;HealthSlot snapshot{};bool tracked=false;
    if(entity_copy(&id,static_cast<const unsigned char*>(data)+24,4)&&id>0&&id<=64&&entity_copy(&before,output,4)){
        std::lock_guard<std::mutex> lock(h.mutex);snapshot=h.slots[id];tracked=snapshot.object==object&&snapshot.output==output&&snapshot.hook==int(index)&&!h.hooks[index].foreign;
    }
    original(data,object,output);if(!tracked)return;int after=0;uint32_t serial=0;
    if(!entity_copy(&after,output,4)||!entity_copy(&serial,snapshot.serial,4)||serial!=snapshot.ref.handle)return;
    std::lock_guard<std::mutex> lock(h.mutex);auto& slot=h.slots[id];if(slot.object!=object||slot.generation!=snapshot.generation)return;
    if(after>before){slot.generation=++h.generation;return;}
    if(after<0||after>=before||before<=0||before>1000000||slot.team!=3)return;
    HealthSample sample{{sizeof(L4P_HealthDropV1),slot.ref,GetTickCount(),before,after,slot.team,slot.user},object,slot.generation};
    for(auto& item:h.watchers){auto& w=item.second;if(w.active&&w.queue.size()<32)w.queue.push_back(sample);}
}
template<size_t I> void __cdecl health_thunk(const void* data,void* object,void* out){health_proxy(I,data,object,out);}
template<size_t... I> auto health_thunks(std::index_sequence<I...>){return std::array<void*,sizeof...(I)>{reinterpret_cast<void*>(&health_thunk<I>)...};}
const auto healthThunks=health_thunks(std::make_index_sequence<8>{});
int health_attach(void** location){auto& f=feedback();void* old=nullptr;if(!entity_copy(&old,location,4)||!executable(old))return -1;
    size_t index=8;for(size_t i=0;i<8;++i)if(f.hooks[i].slot==location){index=i;break;}
    if(index==8){for(size_t i=0;i<8;++i)if(!f.hooks[i].slot){index=i;break;}if(index==8)return -1;
        f.hooks[index].slot=location;f.hooks[index].original.store(old,std::memory_order_release);}
    auto& hook=f.hooks[index];if(hook.foreign)return -1;if(old==healthThunks[index])return int(index);
    if(old!=hook.original.load()){hook.foreign=true;return -1;}
    return cvar_swap(location,old,healthThunks[index])?int(index):-1;
}
void health_pump(){auto& f=feedback();std::lock_guard<std::mutex> lock(f.mutex);bool wanted=false;
    for(auto& w:f.watchers){w.second.active=effects_scope(w.first)==L4P_OK;wanted|=w.second.active;if(!w.second.active)w.second.queue.clear();}
    bool used[8]{};
    for(int i=1;i<=64;++i){auto& previous=f.slots[i];HealthSlot next{};
        if(wanted){auto record=entity_record(i);if(record){auto field=entity_field(*record,"m_iHealth");if(field.prop&&field.offset>=0&&field.offset<=0x4000){
            const int hook=health_attach(reinterpret_cast<void**>(field.prop+0x20));
            if(hook>=0){next.ref={uint32_t(i),record->handle,entity_service().epoch};next.object=record->entity;next.output=static_cast<unsigned char*>(record->entity)+field.offset;next.hook=hook;
                using Ref=const uint32_t*(__thiscall*)(void*);auto get=method<Ref>(record->entity,2);next.serial=get?get(record->entity):nullptr;
                entity_read(&next.ref,"m_iTeamNum",L4P_FIELD_INT,&next.team);L4P_EntityInfoV1 info{sizeof(info)};if(!entity_describe(&next.ref,&info))next.user=info.user_id;used[hook]=true;
            }
        }}}
        next.generation=next.object==previous.object&&next.ref.handle==previous.ref.handle&&next.ref.epoch==previous.ref.epoch&&next.user==previous.user?previous.generation:++f.generation;
        previous=next;
    }
    for(size_t i=0;i<8;++i)if(!used[i]&&f.hooks[i].slot)cvar_swap(f.hooks[i].slot,healthThunks[i],f.hooks[i].original.load());
}
void health_spawn(void* event){const int user=event_int(event,"userid",0);if(user<=0)return;auto& f=feedback();std::lock_guard<std::mutex> lock(f.mutex);for(auto& slot:f.slots)if(slot.user==user)slot.generation=++f.generation;}
uint32_t L4P_CALL feedback_watch(uint32_t token,uint32_t enabled){
    if(!paintCallback||enabled>1)return L4P_BAD_ARGUMENT;auto result=effects_scope(token);if(enabled&&result)return result;auto& f=feedback();
    {std::lock_guard<std::mutex> lock(f.mutex);if(enabled){if(f.watchers.count(token))return L4P_OK;f.watchers.try_emplace(token);}else{if(!f.watchers.erase(token))return L4P_OK;}}health_pump();return L4P_OK;
}
uint32_t L4P_CALL feedback_next(uint32_t token,L4P_HealthDropV1* out,uint32_t* available){
    if(!paintCallback||!out||out->struct_size!=sizeof(*out)||!available)return L4P_BAD_ARGUMENT;auto code=effects_scope(token);if(code)return code;auto& f=feedback();
    for(;;){HealthSample sample{};{std::lock_guard<std::mutex> lock(f.mutex);auto w=f.watchers.find(token);if(w==f.watchers.end())return L4P_BAD_ARGUMENT;
        if(w->second.queue.empty()){*available=0;return L4P_OK;}sample=w->second.queue.front();w->second.queue.erase(w->second.queue.begin());
        const auto& slot=f.slots[sample.data.target.index];if(slot.generation!=sample.generation||slot.object!=sample.object)continue;}
        if(uint32_t(service().frame.time_ms-sample.data.time_ms)>400)continue;EntityRecord* record=nullptr;
        if(entity_resolve(&sample.data.target,record)||record->entity!=sample.object)continue;
        *out=sample.data;*available=1;return L4P_OK;
    }
}
void* feedback_command(){auto& s=service();if(!s.cvar)s.cvar=iface(L"vstdlib.dll","VEngineCvar007");using Find=void*(__thiscall*)(void*,const char*);auto find=method<Find>(s.cvar,10);return find?find(s.cvar,"r_screenoverlay"):nullptr;}
bool feedback_send(const char* material){using Command=void(__thiscall*)(void*,const char*);auto send=method<Command>(service().engine,7);if(!send)return false;
    std::string text="r_screenoverlay \"";text+=material;text+='"';send(service().engine,text.c_str());return true;
}
void overlay_pump(){auto& f=feedback();if(!f.overlayOwner)return;
    if(effects_scope(f.overlayOwner)!=L4P_OK)f.clearing=true;if(!f.clearing)return;
    if(service().frame.loading&&service().running)return;
    if(!f.clearSent){if(!feedback_send(""))return;f.clearSent=true;f.restoreAt=service().frame.sequence+2;}
    if(service().running&&int32_t(service().frame.sequence-f.restoreAt)<0)return;
    if(feedback_command()==f.overlayCommand){int flags=0;auto ptr=static_cast<unsigned char*>(f.overlayCommand)+0x14;if(!entity_copy(&flags,ptr,4))return;
        constexpr int mask=(1<<14)|(1<<30);if((flags&mask)==(f.writtenFlags&mask)){int restore=(flags&~mask)|(f.beforeFlags&mask);if(!model_write(ptr,&restore,4))return;}}
    f.overlayOwner=0;f.overlayCommand=nullptr;f.clearing=f.clearSent=false;
}
uint32_t L4P_CALL feedback_overlay(uint32_t token,const char* material){
    if(!paintCallback||!material||strnlen(material,96)>=96||(*material&&!file_path(material,false)))return L4P_BAD_ARGUMENT;
    auto code=effects_scope(token);if(code)return code;auto& f=feedback();if(f.overlayOwner&&f.overlayOwner!=token)return L4P_CVAR_CONFLICT;
    if(!*material){if(f.overlayOwner==token){f.clearing=true;overlay_pump();}return L4P_OK;}
    void* cmd=feedback_command();if(!cmd)return L4P_ENTITY_MISSING;auto ptr=static_cast<unsigned char*>(cmd)+0x14;int flags=0;if(!entity_copy(&flags,ptr,4))return L4P_ENTITY_MISSING;
    int desired=(flags&~(1<<14))|(1<<30);
    if(!f.overlayOwner||cmd!=f.overlayCommand){f.beforeFlags=flags;f.overlayCommand=cmd;}
    if(!model_write(ptr,&desired,4))return L4P_ERROR;f.overlayOwner=token;f.writtenFlags=desired;f.clearing=f.clearSent=false;
    return feedback_send(material)?L4P_OK:L4P_ERROR;
}
void feedback_remove(uint32_t token){auto& f=feedback();{std::lock_guard<std::mutex> lock(f.mutex);if(token)f.watchers.erase(token);else f.watchers.clear();}
    if(!token||f.overlayOwner==token)f.clearing=true;
}
uint32_t L4P_CALL feedback_release(uint32_t token){if(!token)return L4P_BAD_ARGUMENT;auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);feedback_remove(token);return L4P_OK;}
uint32_t L4P_CALL feedback_addon_loading(uint32_t token,int32_t* out){
    if(!out)return L4P_BAD_ARGUMENT;auto code=file_scope(token);if(code)return code;static HMODULE checked=nullptr;static void** baseSlot=nullptr;static uintptr_t end=0;
    auto module=GetModuleHandleW(L"gameui.dll");if(!module)return L4P_ENTITY_MISSING;
    if(module!=checked){checked=module;baseSlot=nullptr;IMAGE_DOS_HEADER dos{};IMAGE_NT_HEADERS32 nt{};
        if(!entity_copy(&dos,module,sizeof(dos))||dos.e_magic!=IMAGE_DOS_SIGNATURE||dos.e_lfanew<0||dos.e_lfanew>1024*1024||!entity_copy(&nt,reinterpret_cast<unsigned char*>(module)+dos.e_lfanew,sizeof(nt))||nt.FileHeader.Machine!=IMAGE_FILE_MACHINE_I386)return L4P_ENTITY_MISSING;
        end=uintptr_t(module)+nt.OptionalHeader.SizeOfImage;const int pat[]={0xe8,-1,-1,-1,-1,0x80,0xb8,0xd0,0x02,0,0,0,0x8b,0x8e,0xf0,0x02,0,0,0x8b,0x11,0x8b,0x92,0x84,0,0,0,0x0f,0x94,0xc0,0x0f,0xb6,0xc0,0x50,0xff,0xd2};uint32_t count=0;auto hit=find_unique(L"gameui.dll",pat,std::size(pat),count);int relative=0;
        if(!hit||!entity_copy(&relative,hit+1,4))return L4P_ENTITY_MISSING;auto getter=hit+5+relative;unsigned char bytes[6]{};void** slot=nullptr;
        if(uintptr_t(getter)<uintptr_t(module)||uintptr_t(getter)+6>end||!entity_copy(bytes,getter,6)||bytes[0]!=0xa1||bytes[5]!=0xc3)return L4P_ENTITY_MISSING;memcpy(&slot,bytes+1,4);
        if(uintptr_t(slot)<uintptr_t(module)||uintptr_t(slot)+4>end)return L4P_ENTITY_MISSING;baseSlot=slot;
    }
    void* base=nullptr;void* vt=nullptr;uint8_t done=0;if(!baseSlot||!entity_copy(&base,baseSlot,4)||!entity_copy(&vt,base,4)||uintptr_t(vt)<uintptr_t(module)||uintptr_t(vt)>=end||!entity_copy(&done,static_cast<unsigned char*>(base)+0x2d0,1)||done>1)return L4P_ENTITY_MISSING;
    *out=done?0:1;return L4P_OK;
}
