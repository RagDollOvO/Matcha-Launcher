// GPL-3.0. ClientUxUpdateAddons ABI and mask ownership, Skeeto 2.2.19.
using AddonUpdate=void(__thiscall*)(void*);
extern "C" void __cdecl L4P_NativeFinally(void(__cdecl*)(void*),void*,void(__cdecl*)(void*));
struct AddonFilter{void* context;L4P_AddonFilterFn callback;bool allowed=false;};
struct AddonService{
    std::mutex mutex;std::map<uint32_t,AddonFilter> filters;L4P_AddonStatusV1 status{sizeof(L4P_AddonStatusV1)};
    std::atomic<bool> restoreFailed{false};std::atomic<uint32_t> wrongThread{0},thread{0};
    unsigned char* target=nullptr;unsigned char original[6]{},patch[6]{};AddonUpdate call=nullptr;
    int teamOffset=-1;bool created=false,enabled=false,terminal=false;uint32_t retryAt=0;
};
AddonService& addons(){static auto* a=new AddonService;return *a;}
bool addon_write(void* address,uint32_t value){SIZE_T size=0;return writable(address,4)&&WriteProcessMemory(GetCurrentProcess(),address,&value,4,&size)&&size==4;}
struct AddonCall{AddonUpdate call;void* self;void* mask;uint32_t before;};
void __cdecl addon_original(void* ptr){auto& c=*static_cast<AddonCall*>(ptr);c.call(c.self);}
void __cdecl addon_restore(void* ptr){auto& c=*static_cast<AddonCall*>(ptr);if(!addon_write(c.mask,c.before))addons().restoreFailed=true;}
void __fastcall addon_hook(void* self,void*){
    auto& a=addons();if(GetCurrentThreadId()!=a.thread.load(std::memory_order_acquire)){++a.wrongThread;a.call(self);return;}
    bool changed=false;AddonCall call{a.call,self,static_cast<unsigned char*>(self)+0x1880,0};
    {std::lock_guard<std::mutex> lock(a.mutex);++a.status.calls;
        if(!a.terminal&&!a.restoreFailed){int team=0;struct Input{uint32_t bits;int32_t weapons[5];} input{};
            bool wanted=false;for(auto& p:a.filters)wanted|=p.second.allowed;
            if(wanted&&entity_copy(&team,static_cast<unsigned char*>(self)+a.teamOffset,4)&&(team==2||team==3)&&entity_copy(&input,call.mask,sizeof(input))){
                uint32_t bits=input.bits;for(auto& p:a.filters)if(p.second.allowed&&p.second.callback){try{bits&=p.second.callback(p.second.context,team,bits,input.weapons);}catch(...){p.second.allowed=false;}}
                if(bits!=input.bits&&addon_write(call.mask,bits)){call.before=input.bits;changed=true;++a.status.filtered;}
            }else if(wanted)++a.status.read_failures;
        }
    }
    // All C++ locks/temporaries have ended before the original native call.
    // The C MSVC-target SEH boundary restores the received mask on both return
    // and native exception unwind, leaving the original exception intact.
    if(changed)L4P_NativeFinally(addon_original,&call,addon_restore);else a.call(self);
}
void addons_remove(uint32_t token){auto& a=addons();std::lock_guard<std::mutex> lock(a.mutex);a.filters.erase(token);a.status.filters=uint32_t(a.filters.size());}
void addons_clear(){auto& a=addons();std::lock_guard<std::mutex> lock(a.mutex);a.filters.clear();a.status.filters=0;}
void addons_pump(){
    auto& a=addons();std::lock_guard<std::mutex> lock(a.mutex);auto& s=service();a.thread=s.frame.game_thread;
    bool wanted=false;for(auto& p:a.filters){p.second.allowed=effects_scope(p.first)==L4P_OK;wanted|=p.second.allowed;}
    if(a.restoreFailed){a.status.state=6;a.terminal=true;}if(a.terminal)return;
    if(a.created&&memcmp(a.target,a.enabled?a.patch:a.original,6)){a.status.state=5;a.terminal=true;return;}
    if(wanted==a.enabled){a.status.state=wanted?2:0;return;}
    const auto now=GetTickCount();if(a.retryAt&&int32_t(now-a.retryAt)<0)return;
    if(!a.target){auto local=entity_record(s.frame.local_player);if(!local){a.status.state=1;return;}
        EntityClientClass klass{};if(!entity_copy(&klass,local->klass,sizeof(klass))){a.status.state=1;return;}
        auto team=entity_field_find(klass.table,"m_iTeamNum"),bits=entity_field_find(klass.table,"m_iAddonBits"),weapons=entity_field_find(klass.table,"m_AddonModelWeaponIDs");
        if(team.offset<0||bits.offset<0||weapons.offset<0){a.status.state=1;return;}
        const int pattern[]={0x55,0x8b,0xec,0x83,0xec,0x10,0x53,0x56,0x57,0x8b,0xf9,0x8b,0x0d,-1,-1,-1,-1,0x8b,1,0x8b,0x50,0x68};
        auto target=find_unique(L"client.dll",pattern,std::size(pattern),a.status.matched_signatures);unsigned char code[0x187]{};
        const unsigned char maskRead[]={0x8b,0x97,0x80,0x18,0,0},idsRead[]={0x8b,0x94,0x8f,0x84,0x18,0,0};
        if(!target||bits.offset!=0x1880||weapons.offset!=0x1884||!entity_copy(code,target,sizeof(code))||memcmp(code+0xfb,maskRead,6)||memcmp(code+0x180,idsRead,7)){
            a.status.state=3;a.terminal=true;return;}
        a.target=target;a.teamOffset=team.offset;memcpy(a.original,target,6);
    }
    MH_STATUS result=MH_OK;if(!a.created){result=MH_Initialize();if(result==MH_OK||result==MH_ERROR_ALREADY_INITIALIZED){result=MH_CreateHook(a.target,reinterpret_cast<void*>(&addon_hook),reinterpret_cast<void**>(&a.call));a.created=result==MH_OK;}}
    if(result==MH_OK)result=wanted?MH_EnableHook(a.target):MH_DisableHook(a.target);
    if(result!=MH_OK){a.status.state=4;a.retryAt=now+1000;return;}
    a.enabled=wanted;a.retryAt=0;a.status.state=wanted?2:0;if(wanted)memcpy(a.patch,a.target,6);
}
uint32_t L4P_CALL addons_filter(uint32_t token,void* context,L4P_AddonFilterFn callback){
    if(!paintCallback||!callback)return L4P_BAD_ARGUMENT;auto result=effects_scope(token);if(result!=L4P_OK)return result;
    auto& a=addons();std::lock_guard<std::mutex> lock(a.mutex);a.filters[token]={context,callback,true};a.status.filters=uint32_t(a.filters.size());return L4P_OK;
}
uint32_t L4P_CALL addons_release(uint32_t token){addons_remove(token);return L4P_OK;}
uint32_t L4P_CALL addons_status(L4P_AddonStatusV1* out){if(!out||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;auto& a=addons();std::lock_guard<std::mutex> lock(a.mutex);*out=a.status;out->wrong_thread=a.wrongThread;return L4P_OK;}
