// GPL-3.0. Skeeto ClientUxDissolve, independently scheduled through Flare SDK.
#define NOMINMAX
#include "l4p_dissolve.h"
#include "l4p_effects.h"
#include "l4p_resource.h"
#include "feature_config.hpp"
#include "definition.hpp"
#include <atomic>
#include <mutex>
#include <vector>
#include <cstring>
using nlohmann::json;namespace fs=std::filesystem;
namespace {
constexpr char kId[]="skeeto.corpse-dissolve";
L4P_SourceApiV1 source{1,sizeof(source)};L4P_EntityApiV1 entity{1,sizeof(entity)};
L4P_DissolveApiV1 dissolve{1,sizeof(dissolve)};L4P_EffectsApiV1 effects{1,sizeof(effects)};L4P_ResourceApiV1 resource{1,sizeof(resource)};
std::mutex mutex;std::atomic<bool> ready{false};json fields,settings;fs::path configFile;
uint32_t token=0,now=0,tickAt=0,tickN=0,windowAt=0,windowN=0,lastCommon=0,nextClean=0,nextTrace=0;
uint32_t code=0,commonCode=0,specialCode=0,created=0,cleaned=0,traceCount=0,scanCount=0;
bool commonOn=false,specialOn=false,haveImpact=false;int impactUser=0;float impact[3]{};
L4P_DissolveStatusV1 status{sizeof(status)};
struct Pending {int kind=0;L4P_EntityRefV1 ref{};int user=0;uint32_t life=0,born=0,next=0,tries=0;float origin[3]{};bool haveOrigin=false;};
struct Hurt {L4P_EntityRefV1 ref{};uint32_t at=0;float origin[3]{};bool haveOrigin=false;};
struct Candidate {L4P_EntityRefV1 ref{};float origin[3]{};};
std::vector<Pending> pending;std::vector<Hurt> hurts;
bool same(const L4P_EntityRefV1& a,const L4P_EntityRefV1& b){return a.index==b.index&&a.handle==b.handle&&a.epoch==b.epoch;}
bool due(uint32_t at){return !at||int32_t(now-at)>=0;}
bool common(const char* n){return !_stricmp(n,"Infected")||!_stricmp(n,"C_Infected");}
bool witch(const char* n){return !_stricmp(n,"Witch")||!_stricmp(n,"C_Witch");}
bool special(const char* n){for(auto v:{"Tank","Boomer","Hunter","Smoker","Jockey","Charger","Spitter"})if(!_stricmp(n,v))return true;return false;}
bool rag(const char* n){return (strstr(n,"Ragdoll")||strstr(n,"ragdoll"))&&!common(n)&&!witch(n);}
bool origin(const L4P_EntityRefV1& ref,float out[3]){return !entity.read(&ref,"m_vecOrigin",L4P_FIELD_VECTOR,out)&&std::isfinite(out[0])&&std::isfinite(out[1])&&std::isfinite(out[2]);}
float distance(const float a[3],const float b[3]){float sum=0;for(int i=0;i<3;++i){float d=a[i]-b[i];sum+=d*d;}return sum;}
bool busy(const L4P_EntityRefV1& ref){uint32_t value=1;return dissolve.busy(&ref,&value)||value;}
bool describe(const L4P_EntityRefV1& ref,L4P_EntityInfoV1& info){return !entity.describe(&ref,&info);}
void clear(){dissolve.release(token,L4P_DISSOLVE_ALL);pending.clear();hurts.clear();haveImpact=false;tickAt=tickN=windowAt=windowN=lastCommon=nextTrace=0;}
void enqueue(int kind,const L4P_EntityRefV1& ref,const L4P_EntityInfoV1& info){
    if(pending.size()>=16)return;Pending p{};p.kind=kind;p.ref=ref;
    if(kind==1){int team=0;p.user=info.user_id;if(p.user<=0||entity.read(&ref,"m_iTeamNum",L4P_FIELD_INT,&team)||team!=3||dissolve.player_life(p.user,&p.life))return;}
    for(const auto& old:pending)if(old.kind==kind&&same(old.ref,ref)&&(kind!=1||(old.user==p.user&&old.life==p.life)))return;
    p.haveOrigin=origin(ref,p.origin);p.born=now;p.next=now+(kind==1?32:kind==2?16:50);pending.push_back(p);
}
void L4P_CALL onEvent(void*,const L4P_SourceFrameV1* f,const char* name,void* event){if(!ready)return;std::lock_guard<std::mutex> lock(mutex);now=f->time_ms;
    if(strcmp(name,"zombie_death")&&strcmp(name,"bullet_impact")){clear();nextClean=0;return;}
    if(!settings["active"].get<bool>()||!source.allowed(f,L4P_SOURCE_ANY))return;
    if(!strcmp(name,"bullet_impact")){
        if(!commonOn||!settings["common"].get<bool>()||haveImpact||f->local_user<=0||source.event_int(event,"userid",0)!=f->local_user)return;
        impact[0]=source.event_float(event,"x",0);impact[1]=source.event_float(event,"y",0);impact[2]=source.event_float(event,"z",0);
        haveImpact=std::isfinite(impact[0])&&std::isfinite(impact[1])&&std::isfinite(impact[2]);impactUser=f->local_user;return;
    }
    int victim=source.event_int(event,"victim",0),attacker=source.event_int(event,"attacker",0);L4P_EntityRefV1 ref{};L4P_EntityInfoV1 info{sizeof(info)};
    if(victim<=0||victim>=2048||entity.reference(victim,&ref)||!describe(ref,info))return;
    const bool local=f->local_player>0&&attacker==f->local_player;
    if(commonOn&&settings["common"].get<bool>()){
        if(witch(info.class_name))enqueue(3,ref,info);
        else if(common(info.class_name)&&local&&victim>64)enqueue(2,ref,info);
    }
    if(specialOn&&settings["special"].get<bool>()&&local&&special(info.class_name))enqueue(1,ref,info);
}
void trace(const L4P_SourceFrameV1* f){
    hurts.erase(std::remove_if(hurts.begin(),hurts.end(),[](const auto& h){return int32_t(now-h.at)>900;}),hurts.end());
    if(!haveImpact||!due(nextTrace))return;haveImpact=false;nextTrace=now+40;
    if(impactUser!=f->local_user)return;L4P_EntityRefV1 local{};float eye[3]{};
    if(entity.reference(f->local_player,&local)||entity.eye(&local,eye))return;
    float end[3]{},length=std::sqrt(distance(eye,impact));if(!std::isfinite(length)||length<.001f)return;
    for(int i=0;i<3;++i)end[i]=impact[i]+(impact[i]-eye[i])/length*2.f;
    L4P_TraceV1 hit{sizeof(hit)};++traceCount;if(effects.trace(token,eye,end,L4P_TRACE_SHOT,0,&local,&hit)||hit.hit.index<=64)return;
    L4P_EntityInfoV1 info{sizeof(info)};if(!describe(hit.hit,info)||!common(info.class_name))return;
    for(auto& h:hurts)if(h.ref.index==hit.hit.index){bool fresh=same(h.ref,hit.hit)&&int32_t(now-h.at)<70;h.ref=hit.hit;h.at=now;if(!fresh)h.haveOrigin=origin(h.ref,h.origin);return;}
    if(hurts.size()==12)hurts.erase(hurts.begin());Hurt h{};h.ref=hit.hit;h.at=now;h.haveOrigin=origin(h.ref,h.origin);hurts.push_back(h);
}
L4P_EntityRefV1 hurtNear(const float at[3]){L4P_EntityRefV1 best{};float bestD=160.f*160.f;uint32_t bestAt=0;
    for(auto& h:hurts){if(int32_t(now-h.at)>700)continue;L4P_EntityInfoV1 info{sizeof(info)};if(!describe(h.ref,info)||!common(info.class_name))continue;
        float point[3];bool have=origin(h.ref,point);if(!have&&h.haveOrigin){memcpy(point,h.origin,sizeof(point));have=true;}if(!have)continue;
        float d=distance(point,at);if(d>bestD)continue;if(!best.index||d<bestD-1.f||(d<=bestD&&int32_t(h.at-bestAt)>=0)){best=h.ref;bestD=d;bestAt=h.at;}}
    return best;
}
std::vector<Candidate> candidates(int count,size_t cap){std::vector<Candidate> result;int32_t hi=0;if(entity.highest(&hi))return result;hi=std::min(2047,hi);++scanCount;
    for(int idx=hi;idx>=65&&count--&&result.size()<cap;--idx){Candidate c{};L4P_EntityInfoV1 info{sizeof(info)};
        if(entity.reference(idx,&c.ref)||!describe(c.ref,info)||!rag(info.class_name)||busy(c.ref)||!origin(c.ref,c.origin))continue;result.push_back(c);}
    return result;
}
L4P_EntityRefV1 nearest(const std::vector<Candidate>& choices,const Pending& p,float max){L4P_EntityRefV1 best{};if(!p.haveOrigin)return best;float limit=max*max;
    for(const auto& c:choices){float d=distance(c.origin,p.origin);if(d<=limit&&!busy(c.ref)){best=c.ref;limit=d;}}return best;
}
bool glued(const L4P_EntityRefV1& ref,const Pending& p){L4P_EntityInfoV1 info{sizeof(info)};float point[3];return ref.index>64&&describe(ref,info)&&common(info.class_name)&&origin(ref,point)&&distance(point,p.origin)<=96.f*96.f&&!busy(ref);}
void pump(){if(pending.empty())return;if(now!=tickAt){tickAt=now;tickN=0;}if(int32_t(now-windowAt)>100){windowAt=now;windowN=0;}
    dissolve.status(0,&status);if(status.backend>=2){pending.clear();code=L4P_ENTITY_MISSING;return;}
    std::vector<Candidate> tail;for(const auto& p:pending)if(p.kind!=2&&due(p.next)){tail=candidates(65,16);break;}
    std::vector<Pending> keep;
    for(size_t n=0;n<pending.size();++n){auto p=pending[n];const uint32_t lifetime=p.kind==1?700:p.kind==2?900:1200,limit=p.kind==1?10:p.kind==2?8:20;
        if(int32_t(now-p.born)>int32_t(lifetime)||p.tries>=limit||(p.kind==1?!specialOn:!commonOn))continue;
        if(!due(p.next)){keep.push_back(p);continue;}
        if(p.kind==2){if(!p.haveOrigin)continue;
            if(status.common_active>=3||status.active>=6||tickN>=1||windowN>=1||(lastCommon&&int32_t(now-lastCommon)<175)){
                p.next=now+40;if(lastCommon&&int32_t(lastCommon+175-p.next)>0)p.next=lastCommon+175;keep.push_back(p);continue;}}
        L4P_EntityRefV1 chosen{};L4P_EntityInfoV1 info{sizeof(info)};
        if(p.kind==1){uint32_t life=0;int team=0;
            if(dissolve.player_life(p.user,&life)||life!=p.life||!describe(p.ref,info)||info.user_id!=p.user)continue;
            bool haveTeam=!entity.read(&p.ref,"m_iTeamNum",L4P_FIELD_INT,&team);if(haveTeam&&team==2)continue;
            if(haveTeam&&team==3){uint8_t alive=1;int hp=0;
                if(!entity.read(&p.ref,"m_lifeState",L4P_FIELD_BYTE,&alive)&&!entity.read(&p.ref,"m_iHealth",L4P_FIELD_INT,&hp)&&alive==0&&hp>0&&int32_t(now-p.born)>150)continue;
                if(!p.haveOrigin)p.haveOrigin=origin(p.ref,p.origin);if(!busy(p.ref))chosen=p.ref;}
            if(!chosen.index)chosen=nearest(tail,p,192);
        }else if(p.kind==2){
            if(glued(p.ref,p))chosen=p.ref;
            else {auto h=hurtNear(p.origin);if(glued(h,p))chosen=h;}
            if(!chosen.index)chosen=nearest(candidates(192,192),p,128);
            if(!chosen.index){if(p.tries<4){++p.tries;p.next=now+40;keep.push_back(p);}continue;}
        }else {
            if(describe(p.ref,info)&&witch(info.class_name)&&!busy(p.ref)){chosen=p.ref;if(!p.haveOrigin)p.haveOrigin=origin(p.ref,p.origin);}
            if(!chosen.index)chosen=nearest(tail,p,128);
        }
        if(chosen.index){if(status.active>=6||tickN>=1||windowN>=1){keep.push_back(p);continue;}
            L4P_DissolveRequestV1 request{sizeof(request),chosen,p.kind==1?L4P_DISSOLVE_SPECIAL:L4P_DISSOLVE_COMMON,settings["type"].get<uint32_t>(),settings["duration-ms"].get<uint32_t>(),p.user,p.life};
            code=dissolve.start(token,&request);
            if(!code){++tickN;++windowN;++created;++status.active;
                if(p.kind==2){lastCommon=now;++status.common_active;
                    for(size_t j=n+1;j<pending.size();++j){auto& other=pending[j];if(other.kind==2&&(same(other.ref,chosen)||(p.haveOrigin&&other.haveOrigin&&distance(p.origin,other.origin)<=64.f*64.f)))other.tries=99;}}
                continue;}
            if(p.kind==2)continue;
        }
        ++p.tries;p.next=now+80;if(p.tries<limit)keep.push_back(p);
    }pending.swap(keep);
}
void L4P_CALL onFrame(void*,const L4P_SourceFrameV1* f){if(!ready)return;std::lock_guard<std::mutex> lock(mutex);now=f->time_ms;
    bool active=settings["active"].get<bool>()&&source.allowed(f,L4P_SOURCE_ANY),ci=active&&settings["common"].get<bool>(),si=active&&settings["special"].get<bool>();
    commonCode=specialCode=0;
    if(ci){commonCode=resource.claim(token,"skeeto.corpse.common");ci=commonCode==0;}
    if(si){specialCode=resource.claim(token,"skeeto.corpse.special");si=specialCode==0;}
    if(!ci)dissolve.release(token,L4P_DISSOLVE_COMMON);if(!si)dissolve.release(token,L4P_DISSOLVE_SPECIAL);commonOn=ci;specialOn=si;
    dissolve.status(token,&status);
    if(!ci&&!status.common_retained)resource.release(token,"skeeto.corpse.common");
    if(!si&&!status.special_retained)resource.release(token,"skeeto.corpse.special");
    if(ci||si||status.retained)resource.claim(token,"skeeto.corpse.dissolve");else resource.release(token,"skeeto.corpse.dissolve");
    if(!ci){hurts.clear();haveImpact=false;nextTrace=0;}
    if(!ci&&!si){clear();code=0;}else {if(ci)trace(f);pump();}
    // Original compatibility cleanup is independent of either dissolve category.
    if(active&&settings["ragdoll-cleanup"].get<bool>()){if(due(nextClean)){nextClean=now+200;code=dissolve.destroy_ragdolls(token);if(!code)++cleaned;}}else nextClean=0;
    if(commonCode||specialCode)code=commonCode?commonCode:specialCode;dissolve.status(token,&status);
}
void L4P_CALL shutdown(){ready=false;if(token)source.unsubscribe(token);std::lock_guard<std::mutex> lock(mutex);token=0;pending.clear();hurts.clear();}
uint32_t L4P_CALL init(const L4P_HostApiV1* host){if(!host||host->api_version!=1||host->struct_size!=sizeof(*host)||!host->plugin_directory||!host->config_json||ready)return L4P_BAD_ARGUMENT;
    try{fields=json::parse(kFields);json config;if(!flare_feature::validate(fields,json::parse(host->config_json),config))return L4P_BAD_ARGUMENT;
        auto dir=fs::u8path(host->plugin_directory);configFile=dir/L"config.json";auto module=GetModuleHandleW((dir.parent_path()/L"beacon.source/plugin.dll").c_str());if(!module)return L4P_ERROR;
        auto gs=reinterpret_cast<L4P_GetSourceApiFn>(GetProcAddress(module,"L4P_GetSourceApi"));auto ge=reinterpret_cast<L4P_GetEntityApiFn>(GetProcAddress(module,"L4P_GetEntityApi"));
        auto gd=reinterpret_cast<L4P_GetDissolveApiFn>(GetProcAddress(module,"L4P_GetDissolveApi"));auto gf=reinterpret_cast<L4P_GetEffectsApiFn>(GetProcAddress(module,"L4P_GetEffectsApi"));auto gr=reinterpret_cast<L4P_GetResourceApiFn>(GetProcAddress(module,"L4P_GetResourceApi"));
        if(!gs||!ge||!gd||!gf||!gr||gs(1,&source)||ge(1,&entity)||gd(1,&dissolve)||gf(1,&effects)||gr(1,&resource))return L4P_ERROR;
        settings=config;pending.clear();hurts.clear();commonOn=specialOn=haveImpact=false;now=tickAt=tickN=windowAt=windowN=lastCommon=nextClean=nextTrace=code=commonCode=specialCode=created=cleaned=traceCount=scanCount=0;status={sizeof(status)};
        if(source.subscribe(kId,L4P_SOURCE_ANY,"zombie_death,bullet_impact,round_start,round_end,map_transition,mission_lost,game_newmap,server_spawn",nullptr,onFrame,onEvent,&token))return L4P_ERROR;ready=true;return L4P_OK;
    }catch(...){shutdown();return L4P_BAD_ARGUMENT;}}
uint32_t L4P_CALL invoke(const char* action,const char* params,char* out,uint32_t capacity,uint32_t* size){if(!ready||!action||!params||!out||!size)return L4P_BAD_ARGUMENT;
    try{auto args=json::parse(params);bool change=!strcmp(action,"configure");if(!args.is_object()||(!change&&(strcmp(action,"status")||!args.empty())))return L4P_BAD_ARGUMENT;std::lock_guard<std::mutex> lock(mutex);auto next=settings;
        if(change){for(const auto& p:args.items())next[p.key()]=p.value();json checked;if(!flare_feature::validate(fields,next,checked))return L4P_BAD_ARGUMENT;next=checked;}
        const char* backend[]={"等待首次效果","原生服务就绪","当前游戏版本接口待适配","原生调用故障，已停止创建"};
        auto report=json{{"format","flare.report.v1"},{"title","尸体消散"},{"summary",change?"设置已保存，下一游戏帧应用":"死亡事件驱动的原生消散效果"},{"settings",next},{"code",code},{"pending",pending.size()},{"created",created},{"cleaned",cleaned},{"traces",traceCount},{"scans",scanCount},
            {"sections",json::array({{{"title","运行状态"},{"layout","list"},{"items",json::array({{{"label","原生接口"},{"value",backend[std::min(status.backend,3u)]}},{{"label","普通感染者 / Witch"},{"value",commonOn?"已启用":commonCode?"类别被占用":"已关闭"},{"code",commonCode}},{{"label","特感 / Tank"},{"value",specialOn?"已启用":specialCode?"类别被占用":"已关闭"},{"code",specialCode}},{{"label","进行中的效果"},{"value",status.active}},{{"label","待处理死亡事件"},{"value",pending.size()}},{{"label","保留恢复点"},{"value",status.retained}},{{"label","原生失败次数"},{"value",status.failures}}})}}})}}.dump();
        *size=uint32_t(report.size()+1);if(capacity<*size)return L4P_BUFFER_TOO_SMALL;if(change){if(!flare_feature::save(configFile,next))return L4P_ERROR;settings=next;}memcpy(out,report.c_str(),*size);return L4P_OK;
    }catch(...){return L4P_BAD_ARGUMENT;}}
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetPluginApi(uint32_t version,L4P_PluginApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),kId,"0.1.0",init,invoke,shutdown};return L4P_OK;
}
