// Source 1 game-thread service. Interface slots are documented in SOURCE.md.
#define NOMINMAX
#include <windows.h>
#include "l4p_source.h"
#include "l4p_cvar.h"
#include "l4p_sound.h"
#include "l4p_effects.h"
#include "l4p_audio.h"
#include "l4p_resource.h"
#include "l4p_draw.h"
#include "l4p_view.h"
#include "l4p_addons.h"
#include "l4p_model.h"
#include "l4p_file.h"
#include "l4p_glow.h"
#include "l4p_input.h"
#include "l4p_weapon.h"
#include "l4p_player.h"
#include "l4p_localize.h"
#include "l4p_corpse.h"
#include "l4p_viewmodel.h"
#include "l4p_dissolve.h"
#include "l4p_particle.h"
#include "l4p_feedback.h"
#include "viewmodel_profile.hpp"
#include "MinHook.h"
#include <nlohmann/json.hpp>
#include <atomic>
#include <mutex>
#include <map>
#include <set>
#include <vector>
#include <memory>
#include <string>
#include <cstring>
#include <algorithm>
#include <cmath>
#include <array>
#include <utility>
#include <tuple>
#include <filesystem>
using nlohmann::json;
namespace {
bool readable(const void* p,size_t n) {
    if(!p || !n || uintptr_t(p)+n<uintptr_t(p)) return false;
    MEMORY_BASIC_INFORMATION m{};
    return VirtualQuery(p,&m,sizeof m) && m.State==MEM_COMMIT && !(m.Protect&(PAGE_NOACCESS|PAGE_GUARD)) &&
        uintptr_t(p)+n<=uintptr_t(m.BaseAddress)+m.RegionSize;
}
bool executable(const void* p) {
    MEMORY_BASIC_INFORMATION m{}; if(!VirtualQuery(p,&m,sizeof m) || m.State!=MEM_COMMIT || (m.Protect&PAGE_GUARD)) return false;
    return (m.Protect & (PAGE_EXECUTE|PAGE_EXECUTE_READ|PAGE_EXECUTE_READWRITE|PAGE_EXECUTE_WRITECOPY))!=0;
}
void* slot(void* object,size_t index) {
    if(!readable(object,sizeof(void*))) return nullptr;
    auto v=*static_cast<void***>(object); if(!readable(v,(index+1)*sizeof(void*))) return nullptr;
    return executable(v[index]) ? v[index] : nullptr;
}
template<class T> T method(void* object,size_t index) {return reinterpret_cast<T>(slot(object,index));}
void* iface(const wchar_t* library,const char* name) {
    auto m=GetModuleHandleW(library); if(!m) return nullptr;
    auto fn=reinterpret_cast<void*(__cdecl*)(const char*,int*)>(GetProcAddress(m,"CreateInterface"));
    return fn?fn(name,nullptr):nullptr;
}
template<size_t N> void copy(char (&out)[N],const char* text) {
    out[0]=0; if(!text) return;
    MEMORY_BASIC_INFORMATION m{};
    if(!VirtualQuery(text,&m,sizeof m)||m.State!=MEM_COMMIT||(m.Protect&(PAGE_NOACCESS|PAGE_GUARD)))return;
    const size_t available=std::min<size_t>(N-1,uintptr_t(m.BaseAddress)+m.RegionSize-uintptr_t(text));
    auto end=static_cast<const char*>(std::memchr(text,0,available));
    if(!end)return;const size_t count=size_t(end-text);std::memcpy(out,text,count);out[count]=0;
}
struct Sub {
    std::string id; uint32_t scope,token; std::set<std::string> events;
    void* context; L4P_SourceFrameFn frame; L4P_SourceEventFn event; bool active=true;
};
struct Service {
    std::recursive_mutex mutex;
    std::map<uint32_t,std::shared_ptr<Sub>> subs;
    uint32_t next=1; L4P_SourceFrameV1 frame{sizeof(L4P_SourceFrameV1)};
    std::atomic<bool> running{false}; HANDLE stop=nullptr,worker=nullptr;
    void* engine=nullptr; void* events=nullptr; void* cvar=nullptr;
    void** paintSlot=nullptr; std::atomic<void*> original{nullptr};
    bool listenersDirty=true; std::set<std::string> registered;
    std::filesystem::path packageRoot;
};
// Resident with the Runtime: an in-flight hook or engine-owned listener may retain
// a callback during process teardown. shutdown turns those callbacks into no-ops.
Service& service(){static Service* s=new Service; return *s;}
thread_local bool callbackThread=false, inPaint=false,paintCallback=false;
uint32_t L4P_CALL allowed(const L4P_SourceFrameV1* f,uint32_t scope) {
    if(!f || f->struct_size!=sizeof(*f) || !f->in_game || f->loading || !f->connected) return 0;
    if(scope==L4P_SOURCE_ANY) return 1;
    if(scope==L4P_SOURCE_LOCAL) return f->local_server;
    if(scope==L4P_SOURCE_COOP) return f->mode[0] && !f->versus;
    return 0;
}
void capture() {
    auto& s=service(); auto& f=s.frame; ++f.sequence; f.time_ms=GetTickCount(); f.game_thread=GetCurrentThreadId();
    using Bool=bool(__thiscall*)(void*); using Int=int(__thiscall*)(void*); using Ptr=void*(__thiscall*)(void*);
    auto connected=method<Bool>(s.engine,27), game=method<Bool>(s.engine,26), loading=method<Bool>(s.engine,28);
    f.connected=connected && connected(s.engine);f.in_game=game && game(s.engine); f.loading=loading && loading(s.engine);
    f.local_player=0; f.local_user=0;f.local_server=0;f.versus=1;f.mode[0]=0;
    if(!f.connected) {f.map[0]=0;return;}
    auto local=method<Int>(s.engine,12); if(local) f.local_player=local(s.engine);
    struct PlayerInfo {char pad[8];char name[32];int userid;char tail[0x150];} info{};
    using Info=bool(__thiscall*)(void*,int,void*); auto player=method<Info>(s.engine,8);
    if(player && f.local_player>0 && player(s.engine,f.local_player,&info)) f.local_user=info.userid;
    auto channel=method<Ptr>(s.engine,74);
    if(channel) {auto nc=channel(s.engine);auto loopback=method<Bool>(nc,6); f.local_server=loopback && loopback(nc);}
    if(!s.cvar) s.cvar=iface(L"vstdlib.dll","VEngineCvar007");
    using Find=void*(__thiscall*)(void*,const char*); auto find=method<Find>(s.cvar,12);
    if(find) {
        auto var=static_cast<unsigned char*>(find(s.cvar,"mp_gamemode"));
        // L4D2 ConVar parent +0x1c, current string +0x24 (upstream ReadMpGamemode).
        if(readable(var,0x28)) {auto parent=*reinterpret_cast<unsigned char**>(var+0x1c);
            if(readable(parent,0x28)) copy(f.mode,*reinterpret_cast<char**>(parent+0x24));}
    }
    const std::string mode=f.mode;
    // Unknown mutations stay gated until an explicit family resolver is supplied.
    f.versus=mode!="coop" && mode!="realism" && mode!="survival";
}
int32_t L4P_CALL event_int(void* e,const char* k,int32_t fallback) {
    if(!callbackThread || !k) return fallback;
    using Fn=int(__thiscall*)(void*,const char*,int); auto fn=method<Fn>(e,6);return fn?fn(e,k,fallback):fallback;
}
float L4P_CALL event_float(void* e,const char* k,float fallback) {
    if(!callbackThread || !k) return fallback;
    using Fn=float(__thiscall*)(void*,const char*,float);auto fn=method<Fn>(e,8);return fn?fn(e,k,fallback):fallback;
}
uint32_t L4P_CALL event_text(void* event,const char* key,char* output,uint32_t capacity,uint32_t* size){
    if(!callbackThread||!event||!key||!output||!size)return L4P_BAD_ARGUMENT;
    using Get=const char*(__thiscall*)(void*,const char*,const char*);auto get=method<Get>(event,9);if(!get)return L4P_ERROR;
    char value[1024]{};copy(value,get(event,key,""));*size=uint32_t(strlen(value)+1);if(capacity<*size)return L4P_BUFFER_TOO_SMALL;memcpy(output,value,*size);return L4P_OK;
}
#include "scan.inc"
#include "cvars.inc"
#include "entities.inc"
#include "effects.inc"
bool diss_target_owned(const L4P_EntityRefV1&);
#include "corpses.inc"
#include "audio.inc"
#include "resources.inc"
#include "drawing.inc"
#include "view.inc"
#include "player.inc"
#include "localize.inc"
#include "addons.inc"
#include "models.inc"
#include "dissolve.inc"
#include "viewmodels.inc"
#include "viewmodel_mirror.inc"
#include "files.inc"
#include "particles.inc"
#include "feedback.inc"
#include "glow.inc"
#include "input.inc"
#include "weapons.inc"
#include "sound.inc"
void __fastcall event_callback(void*,void*,void* event) {
    auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);if(!s.running) return;
    // Native events are synchronous game-thread notifications. Refresh connection
    // context here as well, so a server switch cannot reuse the previous scope.
    const bool previous=callbackThread; callbackThread=true; capture();cvar_pump();
    using Name=const char*(__thiscall*)(void*);auto fn=method<Name>(event,1);char name[80]{};if(fn)copy(name,fn(event));
    if(!std::strcmp(name,"game_newmap") || !std::strcmp(name,"server_spawn")) {
        entity_epoch();corpse_epoch();diss_epoch();models_epoch();vm_epoch();glow_epoch();effects_epoch();audio_epoch();
        using Text=const char*(__thiscall*)(void*,const char*,const char*);auto text=method<Text>(event,9);
        if(text) copy(s.frame.map,text(event,"mapname",""));
    }
    entity_frame();if(dissolve().entityEpoch!=entity_service().epoch)diss_epoch();
    if(!std::strcmp(name,"player_spawn")){diss_spawn(event);health_spawn(event);}
    models_scope_pump();vm_pump();glow_pump();input_pump();corpse_pump();diss_pump();
    std::vector<std::shared_ptr<Sub>> list;for(auto& p:s.subs)list.push_back(p.second);
    for(auto& p:list) if(p->active && p->event && p->events.count(name) && allowed(&s.frame,p->scope)) {
        try{p->event(p->context,&s.frame,name,event);}catch(...){p->active=false;particle_remove(p->token);feedback_remove(p->token);sound_remove(p->token);addons_remove(p->token);models_remove(p->token);vm_remove(p->token);diss_remove(p->token);glow_remove(p->token);input_remove(p->token);localize_remove(p->token);}
    }
    if(!std::strcmp(name,"game_newmap") || !std::strcmp(name,"server_spawn"))s.listenersDirty=true;
    callbackThread=previous;
}
// Explicit MSVC IGameEventListener2 ABI; a MinGW C++ class adds another destructor
// slot. Construct the three-slot native listener directly instead.
void* __fastcall event_destructor(void* self,void*,unsigned int){return self;}
int __fastcall event_debug(void*,void*){return 42;}
void* listenerVtable[]={reinterpret_cast<void*>(&event_destructor),reinterpret_cast<void*>(&event_callback),reinterpret_cast<void*>(&event_debug)};
struct Listener {void** vtable;} listener{listenerVtable};
void listeners() {
    auto& s=service(); if(!s.events)s.events=iface(L"engine.dll","GAMEEVENTSMANAGER002");
    if(!s.events || !s.listenersDirty)return;
    using Remove=void(__thiscall*)(void*,void*);using Add=bool(__thiscall*)(void*,void*,const char*,bool);
    auto remove=method<Remove>(s.events,5);auto add=method<Add>(s.events,3);if(!remove||!add)return;
    remove(s.events,&listener);s.registered.clear();s.listenersDirty=false;
    std::set<std::string> names={"server_spawn","game_newmap","player_spawn"};
    for(auto& p:s.subs)for(auto& n:p.second->events)names.insert(n);
    for(auto& n:names) if(add(s.events,&listener,n.c_str(),false))s.registered.insert(n);
}
void __fastcall paint(void* self,void*,int mode) {
    auto& s=service();using Paint=void(__thiscall*)(void*,int);
    auto original=reinterpret_cast<Paint>(s.original.load(std::memory_order_acquire));
    if(inPaint){if(original)original(self,mode);return;}
    inPaint=true;if(original)original(self,mode);
    {std::lock_guard<std::recursive_mutex> lock(s.mutex);
    if(s.running) {
        callbackThread=true;paintCallback=true;paintMode=mode;capture();entity_frame();files_pump();health_pump();overlay_pump();models_scope_pump();vm_pump();glow_pump();input_pump();corpse_pump();diss_pump();models_pump();cvar_pump();effects_pump();audio_pump();resource_pump();localize_pump();listeners();
        std::vector<std::shared_ptr<Sub>> list;for(auto& p:s.subs)list.push_back(p.second);
        for(auto& p:list)if(p->active&&p->frame){try{p->frame(p->context,&s.frame);}catch(...){p->active=false;particle_remove(p->token);feedback_remove(p->token);sound_remove(p->token);addons_remove(p->token);models_remove(p->token);vm_remove(p->token);diss_remove(p->token);glow_remove(p->token);input_remove(p->token);localize_remove(p->token);}}
        health_pump();overlay_pump();addons_pump();draw_finish();paintCallback=false;callbackThread=false;
    }else {callbackThread=true;paintCallback=true;files_pump();health_pump();overlay_pump();models_scope_pump();vm_pump();glow_pump();input_pump();corpse_pump();diss_pump();cvar_pump();effects_pump();audio_pump();resource_pump();localize_pump();addons_pump();paintCallback=false;callbackThread=false;}}
    sound_pump();inPaint=false;
}
DWORD WINAPI connect(void*) {
    auto& s=service();
    while(WaitForSingleObject(s.stop,100)==WAIT_TIMEOUT){
        std::lock_guard<std::recursive_mutex> lock(s.mutex);if(!s.running)break;
        if(s.paintSlot)break;
        auto engine=iface(L"engine.dll","VEngineClient013");auto vgui=iface(L"engine.dll","VEngineVGui001");
        auto old=slot(vgui,14);if(!engine || !old)continue;
        auto location=&(*static_cast<void***>(vgui))[14];DWORD protection=0;
        if(!VirtualProtect(location,sizeof(void*),PAGE_READWRITE,&protection))continue;
        s.engine=engine;s.original.store(old,std::memory_order_release);
        auto prior=InterlockedCompareExchangePointer(location,reinterpret_cast<void*>(&paint),old);
        DWORD ignored=0;VirtualProtect(location,sizeof(void*),protection,&ignored);
        if(prior==old)s.paintSlot=location;else{s.original=nullptr;s.engine=nullptr;}
    } return 0;
}
uint32_t L4P_CALL subscribe(const char* id,uint32_t scope,const char* names,void* context,L4P_SourceFrameFn frame,L4P_SourceEventFn event,uint32_t* token){
    auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);
    if(!s.running || !id || !*id || strlen(id)>64 || scope>2 || !names || strlen(names)>2048 || !token || (!frame&&!event) || s.subs.size()>=128)return L4P_BAD_ARGUMENT;
    for(auto& p:s.subs)if(p.second->id==id)return L4P_BAD_ARGUMENT;
    auto sub=std::make_shared<Sub>();sub->id=id;sub->scope=scope;sub->token=s.next++;sub->context=context;sub->frame=frame;sub->event=event;
    std::string namesText=names;size_t start=0;
    while(start<namesText.size()) {size_t end=namesText.find(',',start);auto name=namesText.substr(start,end-start);
        if(name.empty()||name.size()>79||name.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789_")!=std::string::npos)return L4P_BAD_ARGUMENT;
        sub->events.insert(name);if(sub->events.size()>32)return L4P_BAD_ARGUMENT;if(end==std::string::npos)break;start=end+1;}
    s.subs[sub->token]=sub;s.listenersDirty=true;*token=sub->token;return L4P_OK;
}
uint32_t L4P_CALL unsubscribe(uint32_t token){auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);auto it=s.subs.find(token);if(it==s.subs.end())return L4P_BAD_ARGUMENT;it->second->active=false;particle_remove(token);feedback_remove(token);sound_remove(token);addons_remove(token);models_remove(token);vm_remove(token);diss_remove(token);glow_remove(token);input_remove(token);localize_remove(token);effects_unsubscribe(token);s.subs.erase(it);s.listenersDirty=true;return L4P_OK;}
uint32_t L4P_CALL snapshot(L4P_SourceFrameV1* out){if(!out||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);*out=s.frame;return L4P_OK;}
uint32_t L4P_CALL command(const char* text){
    if(!callbackThread || !text || !*text || strlen(text)>1024)return L4P_BAD_ARGUMENT;
    auto& s=service();using Fn=void(__thiscall*)(void*,const char*);auto fn=method<Fn>(s.engine,7);
    if(!s.running || !fn)return L4P_ERROR;fn(s.engine,text);return L4P_OK;
}
uint32_t L4P_CALL exec_cfg(const char* relative) {
    if(!callbackThread || !relative)return L4P_BAD_ARGUMENT;
    std::string file=relative;
    if(file.size()<5 || file.size()>160 || file.substr(file.size()-4)!=".cfg" || file.front()=='/' || file.find("..")!=std::string::npos || file.find("//")!=std::string::npos || file.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-/.")!=std::string::npos)return L4P_BAD_ARGUMENT;
    auto& s=service();using Fn=void(__thiscall*)(void*,const char*);auto fn=method<Fn>(s.engine,107);
    if(!s.running || !fn || !s.frame.in_game || s.frame.loading)return L4P_ERROR;
    const auto text="exec "+file;fn(s.engine,text.c_str());return L4P_OK;
}
void L4P_CALL shutdown(){auto& s=service();s.running=false;particle_shutdown();if(s.stop)SetEvent(s.stop);if(s.worker){WaitForSingleObject(s.worker,INFINITE);CloseHandle(s.worker);s.worker=nullptr;}if(s.stop){CloseHandle(s.stop);s.stop=nullptr;}std::lock_guard<std::recursive_mutex> lock(s.mutex);for(auto& p:s.subs)p.second->active=false;particle_remove(0);feedback_remove(0);sound_clear();addons_clear();models_remove(0);vm_remove(0);diss_remove(0);glow_remove(0);input_remove(0);localize_remove(0);s.subs.clear();s.frame={sizeof(L4P_SourceFrameV1)};s.listenersDirty=true;}
uint32_t L4P_CALL init(const L4P_HostApiV1* host){
    auto& s=service();if(!host || host->api_version!=1 || host->struct_size!=sizeof(*host) || !host->log || !host->config_json || s.running)return L4P_BAD_ARGUMENT;
    try{auto config=json::parse(host->config_json);if(!config.is_object()||!config.empty())return L4P_BAD_ARGUMENT;}catch(...){return L4P_BAD_ARGUMENT;}
    s.packageRoot.clear();if(host->plugin_directory&&*host->plugin_directory){try{s.packageRoot=std::filesystem::absolute(std::filesystem::u8path(host->plugin_directory)).lexically_normal().parent_path();}catch(...){}}
    HMODULE pin=nullptr;if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&init),&pin))return L4P_ERROR;
    s.stop=CreateEventW(nullptr,TRUE,FALSE,nullptr);if(!s.stop)return L4P_ERROR;s.running=true;s.worker=CreateThread(nullptr,0,connect,nullptr,0,nullptr);if(!s.worker){shutdown();return L4P_ERROR;}
    host->log(host->context,L4P_LOG_INFO,"Source callback service initialized; awaiting VEngineVGui001 Paint");return L4P_OK;
}
uint32_t L4P_CALL invoke(const char* action,const char* args,char* out,uint32_t cap,uint32_t* size){
    auto& s=service();if(!s.running||!action||strcmp(action,"status")||!args||!out||!size)return L4P_BAD_ARGUMENT;
    try{auto params=json::parse(args);if(!params.is_object()||!params.empty())return L4P_BAD_ARGUMENT;
        std::lock_guard<std::recursive_mutex> lock(s.mutex);json ids=json::array();for(auto& p:s.subs)ids.push_back({{"id",p.second->id},{"active",p.second->active}});
        auto body=json{{"hookConnected",s.paintSlot!=nullptr},{"frames",s.frame.sequence},{"gameThread",s.frame.game_thread},{"inGame",bool(s.frame.in_game)},{"localServer",bool(s.frame.local_server)},{"mode",s.frame.mode},{"subscribers",ids},{"events",s.registered}}.dump();
        *size=uint32_t(body.size()+1);if(cap<*size)return L4P_BUFFER_TOO_SMALL;memcpy(out,body.c_str(),*size);return L4P_OK;
    }catch(...){return L4P_ERROR;}
}
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetSourceApi(uint32_t version,L4P_SourceApiV1* out){
    if(version==2){auto v2=reinterpret_cast<L4P_SourceApiV2*>(out);if(!v2||out->api_version!=2||out->struct_size!=sizeof(*v2))return L4P_BAD_ARGUMENT;
        *v2={{2,sizeof(*v2),subscribe,unsubscribe,snapshot,allowed,event_int,event_float,command,exec_cfg},event_text};return L4P_OK;}
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),subscribe,unsubscribe,snapshot,allowed,event_int,event_float,command,exec_cfg};return L4P_OK;
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetCvarApi(uint32_t version,L4P_CvarApiV1* out){
    if(version==4){auto v4=reinterpret_cast<L4P_CvarApiV4*>(out);
        if(!v4||out->api_version!=4||out->struct_size!=sizeof(*v4))return L4P_BAD_ARGUMENT;
        *v4={{{4,sizeof(*v4),cvar_pin,cvar_release,cvar_read,cvar_pin_locked},cvar_pin_relative},cvar_checkpoint,cvar_restore_checkpoints,cvar_forget_checkpoints};return L4P_OK;}
    if(version==3){auto v3=reinterpret_cast<L4P_CvarApiV3*>(out);
        if(!v3||v3->base.api_version!=3||v3->base.struct_size!=sizeof(*v3))return L4P_BAD_ARGUMENT;
        *v3={{3,sizeof(*v3),cvar_pin,cvar_release,cvar_read,cvar_pin_locked},cvar_pin_relative};return L4P_OK;}
    if(version==2){auto v2=reinterpret_cast<L4P_CvarApiV2*>(out);
        if(!v2||v2->api_version!=2||v2->struct_size!=sizeof(*v2))return L4P_BAD_ARGUMENT;
        *v2={2,sizeof(*v2),cvar_pin,cvar_release,cvar_read,cvar_pin_locked};return L4P_OK;}
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),cvar_pin,cvar_release,cvar_read};return L4P_OK;
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetPluginApi(uint32_t version,L4P_PluginApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),"beacon.source","0.4.0",init,invoke,shutdown};return L4P_OK;
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetSoundApi(uint32_t version,L4P_SoundApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),sound_filter,sound_release,sound_status};return L4P_OK;
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetEntityApi(uint32_t version,L4P_EntityApiV1* out){
    if(version==3){auto v3=reinterpret_cast<L4P_EntityApiV3*>(out);if(!v3||out->api_version!=3||out->struct_size!=sizeof(*v3))return L4P_BAD_ARGUMENT;
        *v3={{{3,sizeof(*v3),entity_reference,entity_describe,entity_read,entity_highest,entity_handle,entity_time,entity_eye,entity_user,entity_model},entity_read_index,entity_player},entity_move_type};return L4P_OK;}
    if(version==2){auto v2=reinterpret_cast<L4P_EntityApiV2*>(out);if(!v2||out->api_version!=2||out->struct_size!=sizeof(*v2))return L4P_BAD_ARGUMENT;
        *v2={{2,sizeof(*v2),entity_reference,entity_describe,entity_read,entity_highest,entity_handle,entity_time,entity_eye,entity_user,entity_model},entity_read_index,entity_player};return L4P_OK;}
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),entity_reference,entity_describe,entity_read,entity_highest,entity_handle,entity_time,entity_eye,entity_user,entity_model};return L4P_OK;
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetEffectsApi(uint32_t version,L4P_EffectsApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),effects_trace,effects_light,effects_drop};return L4P_OK;
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetAudioApi(uint32_t version,L4P_AudioApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),audio_prepare,audio_emit,audio_stop};return L4P_OK;
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetResourceApi(uint32_t version,L4P_ResourceApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),resource_claim,resource_release,resource_owner};return L4P_OK;
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetDrawApi(uint32_t version,L4P_DrawApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),draw_screen,draw_project,draw_rect,draw_line,draw_font,draw_measure,draw_text,draw_texture_file,draw_texture,draw_status};return L4P_OK;
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetViewApi(uint32_t version,L4P_ViewApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),view_snapshot};return L4P_OK;
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetAddonApi(uint32_t version,L4P_AddonApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),addons_filter,addons_release,addons_status};return L4P_OK;
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetModelApi(uint32_t version,L4P_ModelApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),model_scale,model_release,model_status};return L4P_OK;
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetFileApi(uint32_t version,L4P_FileApiV1* out){
    if(version==3){auto v3=reinterpret_cast<L4P_FileApiV3*>(out);if(!v3||out->api_version!=3||out->struct_size!=sizeof(*v3))return L4P_BAD_ARGUMENT;
        *v3={{{3,sizeof(*v3),file_open,file_read,file_close,file_find_open,file_find_next,file_find_close},file_mount_assets,file_unmount_assets},file_path_revision};return L4P_OK;}
    if(version==2){auto v2=reinterpret_cast<L4P_FileApiV2*>(out);if(!v2||out->api_version!=2||out->struct_size!=sizeof(*v2))return L4P_BAD_ARGUMENT;
        *v2={{2,sizeof(*v2),file_open,file_read,file_close,file_find_open,file_find_next,file_find_close},file_mount_assets,file_unmount_assets};return L4P_OK;}
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),file_open,file_read,file_close,file_find_open,file_find_next,file_find_close};return L4P_OK;
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetParticleApi(uint32_t version,L4P_ParticleApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),particle_boot,particle_release,particle_precache,particle_exists,particle_dispatch,particle_status};return L4P_OK;
}

extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetGlowApi(uint32_t version,L4P_GlowApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),glow_colour,glow_outline,glow_release,glow_status};return L4P_OK;
}

extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetInputApi(uint32_t version,L4P_InputApiV1* out){
    if(version==2){if(!out||out->api_version!=2||out->struct_size!=sizeof(L4P_InputApiV2))return L4P_BAD_ARGUMENT;
        *reinterpret_cast<L4P_InputApiV2*>(out)={{2,sizeof(L4P_InputApiV2),input_snapshot,input_binding,input_press,input_release},input_watch_mouse,input_mouse_state,input_mouse_edge};return L4P_OK;}
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),input_snapshot,input_binding,input_press,input_release};return L4P_OK;
}

extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetWeaponApi(uint32_t version,L4P_WeaponApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),weapon_capacity,weapon_status};return L4P_OK;
}

extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetPlayerApi(uint32_t version,L4P_PlayerApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),player_angles,player_camera_read,player_camera_write,player_action,player_camera_status};return L4P_OK;
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetLocalizeApi(uint32_t version,L4P_LocalizeApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),localize_set,localize_clear,localize_status,localize_read};return L4P_OK;
}

extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetCorpseApi(uint32_t version,L4P_CorpseApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),corpse_hide,corpse_release,corpse_destroy};return L4P_OK;
}

extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetViewmodelApi(uint32_t version,L4P_ViewmodelApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),vm_snapshot,vm_set,vm_release,vm_status};return L4P_OK;
}

extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetDissolveApi(uint32_t version,L4P_DissolveApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),diss_life,diss_start,diss_busy,diss_release,diss_clean,diss_status};return L4P_OK;
}

extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetFeedbackApi(uint32_t version,L4P_FeedbackApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),feedback_watch,feedback_next,feedback_overlay,feedback_release,feedback_addon_loading};return L4P_OK;
}
