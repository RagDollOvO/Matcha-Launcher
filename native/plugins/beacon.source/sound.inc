// GPL-3.0. S_StartSound signature, EDI layout and CSfxTable name ABI from
// Skeeto 2.2.19. MinHook owns instruction relocation and thread-safe patching.
// Included inside Source's private namespace; all shared hooks live here.
struct SoundFilter {void* context;L4P_SoundFilterFn fn;};
struct SoundService {
    std::mutex mutex;std::map<uint32_t,SoundFilter> filters;
    L4P_SoundStatusV1 status{sizeof(L4P_SoundStatusV1)};
    unsigned char* target=nullptr;unsigned char original[9]{},patch[9]{};
    bool created=false,enabled=false,terminal=false;uint32_t retryAt=0;
};
SoundService& sound_service(){static auto* s=new SoundService;return *s;}
extern "C" {void* L4P_SoundTrampoline=nullptr;}
extern "C" void __cdecl L4P_SfxGetName(void*,void*,char*,int);
extern "C" void __cdecl L4P_SoundStartHook();
#if defined(_MSC_VER) && !defined(__clang__)
extern "C" __declspec(naked) void __cdecl L4P_SfxGetName(void*,void*,char*,int){
    __asm {push ebp
        mov ebp,esp
        mov ecx,[ebp+8]
        mov eax,[ebp+12]
        push [ebp+20]
        push [ebp+16]
        call eax
        pop ebp
        ret}
}
#else
extern "C" __attribute__((naked)) void __cdecl L4P_SfxGetName(void*,void*,char*,int){
    __asm__ volatile("pushl %ebp\nmovl %esp,%ebp\nmovl 8(%ebp),%ecx\nmovl 12(%ebp),%eax\npushl 20(%ebp)\npushl 16(%ebp)\ncall *%eax\npopl %ebp\nret\n");
}
#endif
extern "C" void __cdecl L4P_FilterSoundStart(void* params){
    auto& s=sound_service();std::lock_guard<std::mutex> lock(s.mutex);
    if(s.filters.empty()||s.terminal)return;
    ++s.status.sounds;
    if(!readable(params,0x2c)){++s.status.unresolved_names;return;}
    auto p=static_cast<unsigned char*>(params);auto sfx=*reinterpret_cast<void**>(p+0x0c);
    auto fn=static_cast<unsigned char*>(slot(sfx,0));
    static constexpr unsigned char prologue[]={0x55,0x8b,0xec,0x81,0x79,0x04,0xff,0xff,0x00,0x00};
    if(!readable(fn,sizeof(prologue))||memcmp(fn,prologue,sizeof(prologue))){++s.status.unresolved_names;return;}
    char name[0x104]{};L4P_SfxGetName(sfx,fn,name,sizeof(name));name[sizeof(name)-1]=0;
    auto volume=reinterpret_cast<float*>(p+0x28);if(!name[0]||!std::isfinite(*volume)){++s.status.unresolved_names;return;}
    const float before=*volume;float next=before;
    for(auto& filter:s.filters)if(filter.second.fn){
        try{float result=filter.second.fn(filter.second.context,name,next);
            if(std::isfinite(result)&&result>=0&&result<=1)next=result;
        }catch(...){filter.second.fn=nullptr;++s.status.callback_errors;}
    }
    if(next!=before){*volume=next;++s.status.modified;}
}
#if defined(_MSC_VER) && !defined(__clang__)
extern "C" __declspec(naked) void __cdecl L4P_SoundStartHook(){
    __asm {pushfd
        pushad
        mov ebx,esp
        and esp,0fffffff0h
        sub esp,528
        fxsave [esp+16]
        mov [esp],edi
        call L4P_FilterSoundStart
        fxrstor [esp+16]
        mov esp,ebx
        popad
        popfd
        jmp dword ptr [L4P_SoundTrampoline]}
}
#else
extern "C" __attribute__((naked)) void __cdecl L4P_SoundStartHook(){
    __asm__ volatile("pushfl\npushal\nmovl %esp,%ebx\nandl $-16,%esp\nsubl $528,%esp\nfxsave 16(%esp)\nmovl %edi,(%esp)\ncall _L4P_FilterSoundStart\nfxrstor 16(%esp)\nmovl %ebx,%esp\npopal\npopfl\njmp *_L4P_SoundTrampoline\n");
}
#endif
unsigned char* sound_find(uint32_t& count){
    constexpr int pattern[]={0x55,0x8b,0xec,0x81,0xec,0x10,0x03,0,0,0xa1,-1,-1,-1,-1,0x33,0xc5,0x89,0x45,0xfc,0x8b,0x0d,-1,-1,-1,-1,0x85,0xc9,0x0f,0x84,-1,-1,-1,-1,0x8b,0x01,0x8b,0x50,0x04,0xff,0xd2,0x84,0xc0,0x0f,0x84,-1,-1,-1,-1,0x8b,0x4f,0x44};
    return find_unique(L"engine.dll",pattern,std::size(pattern),count);
}
// Only Paint touches patch lifecycle. Audio callbacks never acquire Source's
// mutex; filter callbacks may not reenter any SDK, keeping lock order one-way.
void sound_pump(){
    auto& s=sound_service();std::lock_guard<std::mutex> lock(s.mutex);
    const bool wanted=!s.filters.empty();
    if(s.terminal)return;
    if(s.created&&memcmp(s.target,s.enabled?s.patch:s.original,sizeof(s.original))){s.status.state=5;s.terminal=true;return;}
    if(wanted==s.enabled){s.status.state=wanted?2:0;return;}
    const auto now=GetTickCount();if(s.retryAt&&int32_t(now-s.retryAt)<0)return;
    if(!s.target){if(!GetModuleHandleW(L"engine.dll")){s.status.state=1;return;}
        s.target=sound_find(s.status.matched_signatures);if(!s.target){s.terminal=true;s.status.state=3;return;}
        memcpy(s.original,s.target,sizeof(s.original));
    }
    if(memcmp(s.target,s.enabled?s.patch:s.original,sizeof(s.original))){s.status.state=5;s.terminal=true;return;}
    MH_STATUS result=MH_OK;
    if(!s.created){result=MH_Initialize();if(result==MH_OK||result==MH_ERROR_ALREADY_INITIALIZED){
        result=MH_CreateHook(s.target,reinterpret_cast<void*>(&L4P_SoundStartHook),&L4P_SoundTrampoline);s.created=result==MH_OK;}}
    if(result==MH_OK)result=wanted?MH_EnableHook(s.target):MH_DisableHook(s.target);
    if(result!=MH_OK){s.status.state=4;s.retryAt=now+1000;return;}
    s.enabled=wanted;s.retryAt=0;s.status.state=wanted?2:0;
    if(wanted)memcpy(s.patch,s.target,sizeof(s.patch));
    // Retain the trampoline for delayed calls and subsequent enable cycles.
}
void sound_remove(uint32_t token){auto& s=sound_service();std::lock_guard<std::mutex> lock(s.mutex);s.filters.erase(token);s.status.filters=uint32_t(s.filters.size());}
void sound_clear(){auto& s=sound_service();std::lock_guard<std::mutex> lock(s.mutex);s.filters.clear();s.status.filters=0;}
uint32_t L4P_CALL sound_filter(uint32_t token,void* context,L4P_SoundFilterFn fn){
    if(!fn)return L4P_BAD_ARGUMENT;
    auto& source=service();std::lock_guard<std::recursive_mutex> guard(source.mutex);auto sub=source.subs.find(token);
    if(!source.running||sub==source.subs.end()||!sub->second->active||sub->second->scope!=L4P_SOURCE_ANY)return L4P_BAD_ARGUMENT;
    auto& s=sound_service();std::lock_guard<std::mutex> lock(s.mutex);s.filters[token]={context,fn};s.status.filters=uint32_t(s.filters.size());if(!s.enabled&&!s.terminal)s.status.state=1;return L4P_OK;
}
uint32_t L4P_CALL sound_release(uint32_t token){sound_remove(token);return L4P_OK;}
uint32_t L4P_CALL sound_status(L4P_SoundStatusV1* out){if(!out||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;auto& s=sound_service();std::lock_guard<std::mutex> lock(s.mutex);*out=s.status;return L4P_OK;}
