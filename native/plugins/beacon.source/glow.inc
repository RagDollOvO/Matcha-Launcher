// GPL-3.0. Skeeto 2.2.19 SurvivorGetGlowColor / CampaignOutline ownership.
using GlowColourFn=void(__thiscall*)(void*,float*,float*,float*,float*);
using GlowTypeFn=void(__thiscall*)(void*,int);
using GlowProxyFn=void(__cdecl*)(const void*,void*,void*);
struct GlowIdentity {L4P_EntityRefV1 ref{};void* object=nullptr;const uint32_t* serial=nullptr;};
struct GlowColourLease {GlowIdentity entity;uint32_t token=0;int colour=-1,hook=-1;bool alpha=false,allowed=false,releasing=false;};
struct GlowOutlineLease {GlowIdentity entity;uint32_t token=0;int glowOffset=-1,typeOffset=-1,before[4]{},written[4]{};bool releasing=false;};
struct GlowColourHook {void** slot=nullptr;std::atomic<void*> original{nullptr};bool foreign=false;};
struct GlowService {
    std::mutex colourMutex;std::map<void*,GlowColourLease> colours;GlowColourHook hooks[16];
    std::map<uint32_t,GlowOutlineLease> outlines;std::atomic<DWORD> thread{0};uint32_t epoch=0,outlineState=0,conflicts=0,failures=0;
    GlowTypeFn setType=nullptr;GlowProxyFn setColour=nullptr;
};
GlowService& glow(){static auto* g=new GlowService;return *g;}
bool glow_write(void* to,const void* from,size_t size){SIZE_T done=0;return writable(to,size)&&WriteProcessMemory(GetCurrentProcess(),to,from,size,&done)&&done==size;}
bool glow_serial(const GlowIdentity& e){uint32_t serial=0;return entity_copy(&serial,e.serial,4)&&serial==e.ref.handle;}
bool glow_live(const GlowIdentity& e){using Get=void*(__thiscall*)(void*,int);auto get=method<Get>(entity_service().list,3);return glow_serial(e)&&get&&get(entity_service().list,int(e.ref.index))==e.object;}
bool glow_identity(EntityRecord& record,const L4P_EntityRefV1& ref,GlowIdentity& out){using Handle=const uint32_t*(__thiscall*)(void*);auto get=method<Handle>(record.entity,2);if(!get)return false;
    GlowIdentity value{ref,record.entity,get(record.entity)};if(!glow_serial(value))return false;out=value;return true;}
void glow_colour_call(size_t index,void* self,float* r,float* g,float* b,float* a){
    auto& state=glow();auto original=reinterpret_cast<GlowColourFn>(state.hooks[index].original.load(std::memory_order_acquire));if(!original)return;
    original(self,r,g,b,a);if(GetCurrentThreadId()!=state.thread.load()||!r||!g||!b||!a)return;
    std::lock_guard<std::mutex> lock(state.colourMutex);auto i=state.colours.find(self);if(i==state.colours.end())return;auto& l=i->second;
    if(l.hook!=int(index)||!l.allowed||l.releasing||state.hooks[index].foreign||!glow_serial(l.entity))return;
    if(l.colour>=0){*r=float(l.colour&255)/255;*g=float((l.colour>>8)&255)/255;*b=float((l.colour>>16)&255)/255;}if(l.alpha)*a=1;
}
template<size_t I> void __fastcall glow_colour_thunk(void* self,void*,float* r,float* g,float* b,float* a){glow_colour_call(I,self,r,g,b,a);}
template<size_t... I> auto glow_thunks(std::index_sequence<I...>){return std::array<void*,sizeof...(I)>{reinterpret_cast<void*>(&glow_colour_thunk<I>)...};}
const auto glowThunks=glow_thunks(std::make_index_sequence<16>{});
void glow_detach(){auto& g=glow();std::array<bool,16> used{};for(auto& p:g.colours)if(p.second.allowed&&!p.second.releasing)used[p.second.hook]=true;
    for(size_t i=0;i<16;++i){auto& h=g.hooks[i];if(!h.slot||h.foreign)continue;void* current=nullptr;
        if(!entity_copy(&current,h.slot,4)||(current!=glowThunks[i]&&current!=h.original.load())){h.foreign=true;++g.conflicts;continue;}
        if(!used[i]&&current==glowThunks[i]&&!cvar_swap(h.slot,current,h.original.load())){h.foreign=true;++g.conflicts;}}
}
int glow_attach(void* object){auto& g=glow();void** vt=nullptr;void* current=nullptr;if(!entity_copy(&vt,object,4)||!entity_copy(&current,vt+239,4)||!executable(current))return -1;
    size_t index=16;for(size_t i=0;i<16;++i)if(g.hooks[i].slot==vt+239){index=i;break;}
    if(index<16){auto& h=g.hooks[index];if(h.foreign)return -2;if(current==glowThunks[index])return int(index);if(current!=h.original.load()){h.foreign=true;++g.conflicts;return -2;}}
    else{for(size_t i=0;i<16;++i)if(!g.hooks[i].slot){index=i;break;}if(index==16)return -1;for(auto thunk:glowThunks)if(current==thunk)return -2;
        g.hooks[index].slot=vt+239;g.hooks[index].original=current;}
    if(!cvar_swap(vt+239,current,glowThunks[index]))return -2;return int(index);
}
bool glow_resolve(){auto& g=glow();if(g.outlineState)return g.outlineState==1;if(!GetModuleHandleW(L"client.dll"))return false;g.outlineState=2;
    const int colour[]={0x55,0x8b,0xec,0x8b,0x45,0x08,0x8b,0x48,0x04,0x8b,0x45,0x0c,0x8b,0x55,0x10,0xf3,0x0f,0x10,0x05,-1,-1,-1,-1,0x89,0x0a,0x0f,0xb6,0x48,0x10};
    const int type[]={0x55,0x8b,0xec,0x53,0x8b,0x5d,0x08,0x56,0x57,0x8b,0xf9,0x39,0x5f,0x04,0x8d,0x77,0x04,0x74,0x0d,0x8b,0x46,0xfc,0x8b,0x10,0x8d,0x4e,0xfc,0x56,0xff,0xd2};uint32_t count=0;
    g.setColour=reinterpret_cast<GlowProxyFn>(find_unique(L"client.dll",colour,std::size(colour),count));g.setType=reinterpret_cast<GlowTypeFn>(find_unique(L"client.dll",type,std::size(type),count));
    if(g.setColour&&g.setType)g.outlineState=1;return g.outlineState==1;
}
bool glow_fields(EntityRecord& r,GlowOutlineLease& l){auto root=entity_field(r,"m_Glow"),type=entity_field(r,"m_iGlowType"),range=entity_field(r,"m_nGlowRange"),min=entity_field(r,"m_nGlowRangeMin"),colour=entity_field(r,"m_glowColorOverride");
    if(root.offset<0||root.offset>0xffe0||type.offset!=root.offset+4||range.offset!=type.offset+4||min.offset!=type.offset+8||colour.offset!=type.offset+12||type.type!=0||range.type!=0||min.type!=0||colour.type!=0)return false;
    l.glowOffset=root.offset;l.typeOffset=type.offset;return true;
}
void glow_write_colour(GlowOutlineLease& l,int value){int data[7]{};data[1]=value;glow().setColour(&data,static_cast<unsigned char*>(l.entity.object)+l.glowOffset,static_cast<unsigned char*>(l.entity.object)+l.typeOffset+12);}
void glow_write_type(GlowOutlineLease& l,int value){glow().setType(static_cast<unsigned char*>(l.entity.object)+l.glowOffset,value);}
bool glow_read(GlowOutlineLease& l,int (&out)[4]){return entity_copy(out,static_cast<unsigned char*>(l.entity.object)+l.typeOffset,sizeof(out));}
bool glow_restore(GlowOutlineLease& l){if(!glow_live(l.entity))return true;int current[4]{};if(!glow_read(l,current))return false;bool ok=true;
    for(int i=1;i<3;++i)if(current[i]==l.written[i]&&!glow_write(static_cast<unsigned char*>(l.entity.object)+l.typeOffset+i*4,&l.before[i],4))ok=false;
    if(current[3]==l.written[3])glow_write_colour(l,l.before[3]);if(current[0]==l.written[0])glow_write_type(l,l.before[0]);return ok;
}
void glow_remove(uint32_t token){auto& g=glow();{std::lock_guard<std::mutex> lock(g.colourMutex);for(auto& p:g.colours)if(!token||p.second.token==token){p.second.releasing=true;p.second.allowed=false;}}
    for(auto& p:g.outlines)if(!token||p.second.token==token)p.second.releasing=true;
}
void glow_epoch(){auto& g=glow();{std::lock_guard<std::mutex> lock(g.colourMutex);g.colours.clear();glow_detach();}g.outlines.clear();g.epoch=entity_service().epoch;}
void glow_pump(){auto& g=glow();g.thread=service().frame.game_thread;
    {std::lock_guard<std::mutex> lock(g.colourMutex);for(auto i=g.colours.begin();i!=g.colours.end();){auto& l=i->second;bool scope=effects_scope(l.token)==L4P_OK&&strcmp(service().frame.mode,"realism");
        if(l.alpha&&!service().frame.local_server)scope=false;l.allowed=scope;
        if(l.releasing||!scope||!glow_live(l.entity)){i=g.colours.erase(i);continue;}++i;}glow_detach();}
    bool tearingDown=service().frame.loading||!service().frame.in_game;
    if(!service().running){using State=bool(__thiscall*)(void*);auto game=method<State>(service().engine,26),loading=method<State>(service().engine,28);tearingDown=!game||!loading||!game(service().engine)||loading(service().engine);}
    // CGlowProperty's manager is dismantled during loading. Follow upstream:
    // discard old ownership there instead of calling native setters in teardown.
    if(tearingDown){g.outlines.clear();return;}
    for(auto i=g.outlines.begin();i!=g.outlines.end();){auto& l=i->second;if(l.releasing||effects_scope(l.token)!=L4P_OK||!service().frame.local_server){if(glow_restore(l)){i=g.outlines.erase(i);continue;}++g.failures;}
        else if(!glow_live(l.entity)){i=g.outlines.erase(i);continue;}++i;}
}
uint32_t L4P_CALL glow_release(uint32_t token,const L4P_EntityRefV1* ref){if(ref&&(ref->index<1||ref->index>=2048))return L4P_BAD_ARGUMENT;auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);auto& g=glow();
    auto match=[&](auto& l){return l.token==token&&(!ref||(l.entity.ref.index==ref->index&&l.entity.ref.handle==ref->handle&&l.entity.ref.epoch==ref->epoch));};
    {std::lock_guard<std::mutex> colourLock(g.colourMutex);for(auto& p:g.colours)if(match(p.second)){p.second.allowed=false;p.second.releasing=true;}}
    for(auto& p:g.outlines)if(match(p.second))p.second.releasing=true;if(paintCallback)glow_pump();return L4P_OK;
}
uint32_t L4P_CALL glow_colour(uint32_t token,const L4P_EntityRefV1* ref,int32_t colour,uint32_t alpha){
    if(!paintCallback||!ref||ref->index>32||colour< -1||colour>0xffffff||alpha>1)return L4P_BAD_ARGUMENT;auto sub=service().subs.find(token);
    if(sub==service().subs.end()||effects_scope(token)!=L4P_OK||!strcmp(service().frame.mode,"realism")||(alpha&&(sub->second->scope!=L4P_SOURCE_LOCAL||!service().frame.local_server)))return L4P_ENTITY_SCOPE;
    if(colour<0&&!alpha)return glow_release(token,ref);EntityRecord* r=nullptr;auto result=entity_resolve(ref,r);if(result)return result;
    L4P_EntityInfoV1 info{sizeof(info)};int team=0;if(entity_describe(ref,&info)||strcmp(info.class_name,"CTerrorPlayer")||entity_read(ref,"m_iTeamNum",L4P_FIELD_INT,&team)||team!=2)return L4P_ENTITY_MISSING;
    GlowIdentity identity{};if(!glow_identity(*r,*ref,identity))return L4P_ENTITY_STALE;auto& g=glow();std::lock_guard<std::mutex> lock(g.colourMutex);auto i=g.colours.find(r->entity);
    if(i!=g.colours.end()&&(!glow_serial(i->second.entity)||i->second.entity.ref.epoch!=ref->epoch)){g.colours.erase(i);i=g.colours.end();}
    if(i!=g.colours.end()&&i->second.token!=token)return L4P_GLOW_CONFLICT;
    int hook=glow_attach(r->entity);if(hook<0)return hook==-2?L4P_GLOW_CONFLICT:L4P_ENTITY_MISSING;
    g.colours[r->entity]={identity,token,colour,hook,alpha!=0,true,false};return L4P_OK;
}
uint32_t L4P_CALL glow_outline(uint32_t token,const L4P_EntityRefV1* ref,uint32_t colour,int32_t range){
    if(!paintCallback||!ref||colour>0xffffff||range<1||range>32767)return L4P_BAD_ARGUMENT;auto sub=service().subs.find(token);
    if(sub==service().subs.end()||sub->second->scope!=L4P_SOURCE_LOCAL||effects_scope(token)!=L4P_OK||!service().frame.local_server)return L4P_ENTITY_SCOPE;
    EntityRecord* r=nullptr;auto result=entity_resolve(ref,r);if(result)return result;if(!glow_resolve())return L4P_ENTITY_MISSING;auto& g=glow();auto i=g.outlines.find(ref->index);
    if(i!=g.outlines.end()&&(!glow_live(i->second.entity)||i->second.entity.ref.epoch!=ref->epoch)){g.outlines.erase(i);i=g.outlines.end();}
    if(i!=g.outlines.end()&&i->second.token!=token)return L4P_GLOW_CONFLICT;
    if(i==g.outlines.end()){
        if(g.outlines.size()>=256)return L4P_ERROR;GlowOutlineLease next{};next.token=token;
        if(!glow_identity(*r,*ref,next.entity)||!glow_fields(*r,next)||!glow_read(next,next.before))return L4P_ENTITY_MISSING;
        if(next.before[0]!=0)return L4P_GLOW_CONFLICT;memcpy(next.written,next.before,sizeof(next.before));i=g.outlines.emplace(ref->index,next).first;
    }
    auto& l=i->second;int current[4]{};if(!glow_read(l,current))return L4P_ENTITY_MISSING;
    // Network-cleared type+colour are the native baseline; a foreign active pair
    // relinquishes ownership without overwriting that pair during restoration.
    const bool ours=current[0]==l.written[0]||current[3]==l.written[3],released=current[0]==l.before[0]&&current[3]==l.before[3];
    if(!ours&&!released){l.releasing=true;if(glow_restore(l))g.outlines.erase(i);else ++g.failures;++g.conflicts;return L4P_GLOW_CONFLICT;}
    l.releasing=false;const int target[]={3,range,0,int(colour)};
    for(int n=1;n<3;++n){if(!glow_write(static_cast<unsigned char*>(l.entity.object)+l.typeOffset+n*4,target+n,4)){l.releasing=true;if(glow_restore(l))g.outlines.erase(i);else ++g.failures;return L4P_ERROR;}l.written[n]=target[n];}
    if(current[3]!=target[3])glow_write_colour(l,target[3]);l.written[3]=target[3];if(current[0]!=3)glow_write_type(l,3);l.written[0]=3;
    int written[4]{};if(!glow_read(l,written)||memcmp(written,target,sizeof(target))){l.releasing=true;if(glow_restore(l))g.outlines.erase(i);else ++g.failures;return L4P_ERROR;}return L4P_OK;
}
uint32_t L4P_CALL glow_status(L4P_GlowStatusV1* out){if(!out||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;auto& s=service();std::lock_guard<std::recursive_mutex> sourceLock(s.mutex);auto& g=glow();std::lock_guard<std::mutex> lock(g.colourMutex);
    L4P_GlowStatusV1 result{sizeof(result),uint32_t(g.colours.size()),uint32_t(g.outlines.size()),0,g.outlineState,g.conflicts,g.failures};
    for(size_t i=0;i<16;++i)if(g.hooks[i].slot&&readable(g.hooks[i].slot,4)&&*g.hooks[i].slot==glowThunks[i])++result.hooks;*out=result;return L4P_OK;
}
