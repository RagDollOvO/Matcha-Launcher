// Numeric ConVar leases. Included inside beacon.source's private namespace.
// L4D2 layout and IConVar setter from upstream CvarReadPair / DspLockWriteVal.
struct CvarValue { unsigned char* var=nullptr; unsigned char* parent=nullptr; float value=0; int flags=0,parentFlags=0; };
struct Lease {
    uint32_t token=0; float baseline=0,target=0; void* identity=nullptr;void* setterObject=nullptr;
    bool captured=false,releasing=false,locked=false,checkpoint=false;
    uint32_t next=0,result=L4P_OK,hookNext=0,hookAttempts=0;int hook=-1;
};
std::map<std::string,Lease> leases;
thread_local bool internalCvarWrite=false;
bool cvar_restore(const std::string& name,Lease& lease);
struct SetterHook {void** location=nullptr;std::atomic<void*> original{nullptr};};
// Keep each original alive for delayed callers, even after its slot is restored.
// A distinct thunk per slot also forwards correctly if an object's vtable changes.
SetterHook setterHooks[16];
void cvar_setter(size_t index,void* self,float value) {
    using Set=void(__thiscall*)(void*,float);
    auto original=reinterpret_cast<Set>(setterHooks[index].original.load(std::memory_order_acquire));
    if(!original)return;
    if(internalCvarWrite){original(self,value);return;}
    auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);
    for(auto& p:leases){auto& l=p.second;
        if(!l.locked||l.releasing||!l.captured||l.setterObject!=self||l.hook!=int(index))continue;
        // Soundscape writes normally occur on the game thread. Refresh the gate
        // there; worker writes use the last frame/event snapshot without calling
        // game interfaces from an arbitrary audio worker.
        if(GetCurrentThreadId()==s.frame.game_thread)capture();
        auto sub=s.subs.find(l.token);
        if(s.running&&sub!=s.subs.end()&&sub->second->active&&allowed(&s.frame,sub->second->scope))value=l.target;
        else cvar_restore(p.first,l);
        break;
    }
    original(self,value);
}
template<size_t Index> void __fastcall cvar_setter_thunk(void* self,void*,float value){cvar_setter(Index,self,value);}
template<size_t... Index> auto cvar_thunks(std::index_sequence<Index...>){return std::array<void*,sizeof...(Index)>{reinterpret_cast<void*>(&cvar_setter_thunk<Index>)...};}
const auto setterThunks=cvar_thunks(std::make_index_sequence<16>{});
bool cvar_swap(void** location,void* expected,void* replacement){
    if(!readable(location,sizeof(void*)))return false;DWORD protection=0;
    if(!VirtualProtect(location,sizeof(void*),PAGE_READWRITE,&protection))return false;
    auto previous=InterlockedCompareExchangePointer(location,replacement,expected);
    DWORD ignored=0;VirtualProtect(location,sizeof(void*),protection,&ignored);
    return previous==expected;
}
void cvar_detach_unused(){
    for(size_t i=0;i<16;++i){auto& h=setterHooks[i];if(!h.location)continue;
        bool used=false;for(const auto& p:leases)if(p.second.locked&&!p.second.releasing&&p.second.hook==int(i)){used=true;break;}
        if(!used&&readable(h.location,sizeof(void*))&&*h.location==setterThunks[i])cvar_swap(h.location,setterThunks[i],h.original.load());
    }
}
bool cvar_name(const char* name) {
    if(!name || !*name || strlen(name)>79)return false;
    return strspn(name,"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")==strlen(name);
}
std::string cvar_key(const char* name) {std::string key=name;for(auto& c:key)if(c>='A'&&c<='Z')c+=32;return key;}
bool cvar_value(const char* name,CvarValue& v) {
    auto& s=service();if(!s.cvar)s.cvar=iface(L"vstdlib.dll","VEngineCvar007");
    using Find=void*(__thiscall*)(void*,const char*);auto find=method<Find>(s.cvar,12);if(!find)return false;
    v.var=static_cast<unsigned char*>(find(s.cvar,name));if(!readable(v.var,0x34))return false;
    v.parent=*reinterpret_cast<unsigned char**>(v.var+0x1c);
    if(!readable(v.parent,0x34)||*reinterpret_cast<void**>(v.parent+0x1c)!=v.parent)return false;
    v.value=*reinterpret_cast<float*>(v.parent+0x2c);
    v.flags=*reinterpret_cast<int*>(v.var+0x14);v.parentFlags=*reinterpret_cast<int*>(v.parent+0x14);
    return std::isfinite(v.value)&&std::abs(v.value)<=1e8f;
}
bool writable(void* p,size_t n) {
    if(!readable(p,n))return false;MEMORY_BASIC_INFORMATION m{};VirtualQuery(p,&m,sizeof m);
    return (m.Protect&(PAGE_READWRITE|PAGE_WRITECOPY|PAGE_EXECUTE_READWRITE|PAGE_EXECUTE_WRITECOPY))!=0;
}
bool cvar_write(CvarValue& v,float value,bool force) {
    using Set=void(__thiscall*)(void*,float);auto set=method<Set>(v.var+0x18,2);if(!set)return false;
    constexpr int restricted=(1<<1)|(1<<4)|(1<<14); // developer-only, hidden, cheat
    if(force && (!writable(v.var+0x14,4)||!writable(v.parent+0x14,4)))return false;
    if(force){*reinterpret_cast<int*>(v.var+0x14)=v.flags&~restricted;*reinterpret_cast<int*>(v.parent+0x14)=v.parentFlags&~restricted;}
    const bool previous=internalCvarWrite;internalCvarWrite=true;
    set(v.var+0x18,value);internalCvarWrite=previous;
    if(force){*reinterpret_cast<int*>(v.var+0x14)=v.flags;*reinterpret_cast<int*>(v.parent+0x14)=v.parentFlags;}
    return readable(v.parent,0x34)&&std::abs(*reinterpret_cast<float*>(v.parent+0x2c)-value)<0.0001f;
}
// A changed identity belongs to a new engine variable. Never apply an old
// variable's baseline to it. Restoration uses the current name + exact identity.
bool cvar_restore(const std::string& name,Lease& lease) {
    lease.locked=false;
    if(!lease.captured)return true;CvarValue v;
    if(!cvar_value(name.c_str(),v))return false;
    if(v.parent!=lease.identity){lease.captured=false;return true;}
    if(!cvar_write(v,lease.baseline,true))return false;
    lease.captured=false;return true;
}
void cvar_pump() {
    auto& s=service();
    for(auto it=leases.begin();it!=leases.end();){
        auto& l=it->second;auto sub=s.subs.find(l.token);
        bool active=s.running&&sub!=s.subs.end()&&sub->second->active&&allowed(&s.frame,sub->second->scope);
        if(l.releasing || !active) {
            if(cvar_restore(it->first,l)&&(l.releasing||sub==s.subs.end()||l.checkpoint)){it=leases.erase(it);continue;}
        }
        ++it;
    }
    cvar_detach_unused();
}
uint32_t L4P_CALL cvar_pin(uint32_t token,const char* name,float value) {
    if(!callbackThread||!cvar_name(name)||!std::isfinite(value)||std::abs(value)>1e8f)return L4P_BAD_ARGUMENT;
    auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);
    auto sub=s.subs.find(token);if(sub==s.subs.end()||!sub->second->active||!s.running)return L4P_BAD_ARGUMENT;
    if(!allowed(&s.frame,sub->second->scope))return L4P_CVAR_SCOPE;
    CvarValue v;if(!cvar_value(name,v))return L4P_CVAR_MISSING;
    constexpr int restricted=(1<<1)|(1<<2)|(1<<4)|(1<<13)|(1<<14);
    const bool local=sub->second->scope==L4P_SOURCE_LOCAL && s.frame.local_server;
    const bool visual=!strcmp(name,"sv_rollangle")||!strcmp(name,"sv_rollspeed");
    const int blocked=visual?(restricted&~(1<<13)):restricted;
    if(((v.flags|v.parentFlags)&blocked)&&!local)return L4P_CVAR_SCOPE;
    auto key=cvar_key(name);auto found=leases.find(key);
    if(found!=leases.end()&&(found->second.token!=token||found->second.checkpoint))return L4P_CVAR_CONFLICT;
    if(found==leases.end()&&leases.size()>=256)return L4P_ERROR;
    auto& l=leases[key];l.token=token;l.releasing=false;
    if(!l.captured||l.identity!=v.parent){l.baseline=v.value;l.identity=v.parent;l.setterObject=v.var+0x18;l.captured=true;l.next=0;l.locked=false;l.hookAttempts=0;l.hookNext=0;}
    const bool changed=l.target!=value;l.target=value;
    if(!changed&&l.next&&int32_t(s.frame.time_ms-l.next)<0)return l.result;
    l.next=s.frame.time_ms+250;
    if(std::abs(v.value-value)<0.0001f)return l.result=L4P_OK;
    if(visual&&!changed)l.baseline=v.value; // Preserve fresh server replication.
    return l.result=cvar_write(v,value,local)?L4P_OK:L4P_ERROR;
}
uint32_t L4P_CALL cvar_pin_locked(uint32_t token,const char* name,float value){
    const auto result=cvar_pin(token,name,value);if(result!=L4P_OK)return result;
    auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);
    auto& l=leases.at(cvar_key(name));auto object=l.setterObject;
    auto original=slot(object,2);if(!original)return L4P_ERROR;
    auto location=&(*static_cast<void***>(object))[2];
    int index=-1;
    for(size_t i=0;i<16;++i)if(setterHooks[i].location==location){
        if(original!=setterThunks[i]&&original!=setterHooks[i].original.load()){l.locked=false;return L4P_CVAR_CONFLICT;}
        index=int(i);break;
    }
    if(index>=0&&original==setterThunks[index]){l.hook=index;l.locked=true;return L4P_OK;}
    if(l.hookAttempts>=6||(l.hookNext&&int32_t(s.frame.time_ms-l.hookNext)<0))return L4P_ERROR;
    ++l.hookAttempts;l.hookNext=s.frame.time_ms+1000;
    if(index<0){for(size_t i=0;i<16;++i)if(!setterHooks[i].location){index=int(i);break;}
        if(index<0)return L4P_ERROR;
        setterHooks[index].location=location;setterHooks[index].original.store(original,std::memory_order_release);
    }
    l.hook=index;l.locked=true;
    if(!cvar_swap(location,original,setterThunks[index])){l.locked=false;return L4P_CVAR_CONFLICT;}
    return L4P_OK;
}
uint32_t L4P_CALL cvar_pin_relative(uint32_t token,const char* name,float factor){
    if(!callbackThread||!cvar_name(name)||!std::isfinite(factor)||factor<0||factor>10)return L4P_BAD_ARGUMENT;
    auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);
    CvarValue v;if(!cvar_value(name,v))return L4P_CVAR_MISSING;
    auto found=leases.find(cvar_key(name));float baseline=v.value;
    if(found!=leases.end()){
        const auto& l=found->second;if(l.token!=token)return L4P_CVAR_CONFLICT;
        if(l.captured&&l.identity==v.parent)baseline=l.baseline;
    }
    return cvar_pin(token,name,baseline*factor);
}
uint32_t L4P_CALL cvar_release(uint32_t token,const char* name) {
    if(name&&!cvar_name(name))return L4P_BAD_ARGUMENT;
    auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);
    const auto key=name?cvar_key(name):std::string();
    for(auto& p:leases)if(p.second.token==token&&(!name||p.first==key))p.second.releasing=true;
    if(callbackThread)cvar_pump();return L4P_OK;
}
uint32_t L4P_CALL cvar_read(const char* name,float* value) {
    if(!callbackThread||!value||!cvar_name(name))return L4P_BAD_ARGUMENT;
    CvarValue v;if(!cvar_value(name,v))return L4P_CVAR_MISSING;*value=v.value;return L4P_OK;
}
uint32_t L4P_CALL cvar_checkpoint(uint32_t token,const char* name){
    if(!callbackThread||!cvar_name(name))return L4P_BAD_ARGUMENT;
    auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);auto sub=s.subs.find(token);
    if(!s.running||sub==s.subs.end()||!sub->second->active)return L4P_BAD_ARGUMENT;
    if(!allowed(&s.frame,sub->second->scope))return L4P_CVAR_SCOPE;
    CvarValue v;if(!cvar_value(name,v))return L4P_CVAR_MISSING;
    constexpr int restricted=(1<<1)|(1<<2)|(1<<4)|(1<<13)|(1<<14);
    const bool local=sub->second->scope==L4P_SOURCE_LOCAL&&s.frame.local_server;
    const bool visual=!strcmp(name,"sv_rollangle")||!strcmp(name,"sv_rollspeed");
    if(((v.flags|v.parentFlags)&(visual?(restricted&~(1<<13)):restricted))&&!local)return L4P_CVAR_SCOPE;
    auto key=cvar_key(name);auto found=leases.find(key);
    if(found!=leases.end()&&(found->second.token!=token||!found->second.checkpoint||found->second.releasing))return L4P_CVAR_CONFLICT;
    if(found==leases.end()&&leases.size()>=256)return L4P_ERROR;
    auto& l=leases[key];l.token=token;l.checkpoint=true;
    if(!l.captured||l.identity!=v.parent){l.baseline=v.value;l.identity=v.parent;l.captured=true;}
    return L4P_OK;
}
uint32_t L4P_CALL cvar_restore_checkpoints(uint32_t token){
    if(!token)return L4P_BAD_ARGUMENT;auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);
    for(auto& p:leases)if(p.second.token==token&&p.second.checkpoint)p.second.releasing=true;
    if(callbackThread)cvar_pump();
    for(const auto& p:leases)if(p.second.token==token&&p.second.checkpoint)return L4P_ERROR;
    return L4P_OK;
}
uint32_t L4P_CALL cvar_forget_checkpoints(uint32_t token){
    if(!token)return L4P_BAD_ARGUMENT;std::lock_guard<std::recursive_mutex> lock(service().mutex);
    for(auto i=leases.begin();i!=leases.end();)if(i->second.token==token&&i->second.checkpoint)i=leases.erase(i);else ++i;
    return L4P_OK;
}
