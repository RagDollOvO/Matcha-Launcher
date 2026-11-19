// GPL-3.0. Skeeto event-driven NoCorpse; SDK owns native fields and cleanup.
#define NOMINMAX
#include "feature.hpp"
#include "l4p_corpse.h"
#include "l4p_cvar.h"
#include "l4p_resource.h"
#include "feature_config.hpp"
#include <mutex>
#include <atomic>
#include <cstring>
#include <vector>
using nlohmann::json;namespace fs=std::filesystem;
namespace {
L4P_SourceApiV1 source{1,sizeof(source)};L4P_EntityApiV1 entity{1,sizeof(entity)};
L4P_CvarApiV1 cvar{1,sizeof(cvar)};L4P_CorpseApiV1 corpse{1,sizeof(corpse)};L4P_ResourceApiV1 resource{1,sizeof(resource)};
std::mutex mutex;std::atomic<bool> ready{false};uint32_t token=0,now=0,nextCvars=0,scanAt=0,destroyAt=0,scans=0,destroys=0,lastCode=0,scanCount=0,destroyCount=0;
bool dirty=true,commonOn=false,specialOn=false,globalPaused=false;json definition,settings,rows=json::array();fs::path configFile;
struct Track{L4P_EntityRefV1 ref;uint32_t until;bool special;};std::vector<Track> tracks;
struct Death{L4P_EntityRefV1 ref;bool special;};std::vector<Death> deaths;
bool same(const L4P_EntityRefV1& a,const L4P_EntityRefV1& b){return a.index==b.index&&a.handle==b.handle&&a.epoch==b.epoch;}
bool rag(const char* name){for(auto n:{"C_ClientRagdoll","C_ClientRagdoll2","client_ragdoll","client_ragdoll2","C_InfectedRagdoll","CInfectedRagdoll","CCSRagdoll","C_CSRagdoll"})if(!_stricmp(name,n))return true;return strstr(name,"Ragdoll")||strstr(name,"ragdoll");}
bool infectedRag(const char* name){return !_stricmp(name,"C_InfectedRagdoll")||!_stricmp(name,"CInfectedRagdoll");}
bool common(const char* name){return !_stricmp(name,"Infected")||!_stricmp(name,"C_Infected")||!_stricmp(name,"Witch")||!_stricmp(name,"C_Witch");}
bool special(const char* name){for(auto n:{"Tank","Boomer","Hunter","Smoker","Jockey","Charger","Spitter"})if(!_stricmp(name,n))return true;return false;}
bool due(uint32_t at){return !at||int32_t(now-at)>=0;}
void clear(){corpse.release(token,nullptr);tracks.clear();deaths.clear();scans=destroys=scanAt=destroyAt=0;}
void arm(){scans=3;scanAt=now;destroys=4;if(!destroyAt||int32_t(now+50-destroyAt)<0)destroyAt=now+50;}
void track(const L4P_EntityRefV1& ref,bool si){if(ref.index<=64)return;L4P_EntityInfoV1 info{sizeof(info)};if(entity.describe(&ref,&info)||(!rag(info.class_name)&&!common(info.class_name))||(si&&infectedRag(info.class_name)))return;
    for(auto& item:tracks)if(same(ref,item.ref)){item.until=now+2500;item.special=si;lastCode=corpse.hide(token,&ref);return;}
    if(tracks.size()==64){corpse.release(token,&tracks.front().ref);tracks.erase(tracks.begin());}
    tracks.push_back({ref,now+2500,si});lastCode=corpse.hide(token,&ref);scans=3;scanAt=now;
}
void L4P_CALL onEvent(void*,const L4P_SourceFrameV1* f,const char* name,void* event){if(!ready)return;std::lock_guard<std::mutex> lock(mutex);
    if(strcmp(name,"zombie_death")){clear();nextCvars=0;dirty=true;return;}
    if(!settings["active"].get<bool>()||!source.allowed(f,L4P_SOURCE_LOCAL))return;int victim=source.event_int(event,"victim",0);L4P_EntityRefV1 ref{};L4P_EntityInfoV1 info{sizeof(info)};
    if(victim<=0||victim>=2048||entity.reference(victim,&ref)||entity.describe(&ref,&info))return;
    bool si=special(info.class_name),ci=common(info.class_name);if((!si&&!ci)||(ci&&(victim<=64||!settings["common"].get<bool>()))||(si&&!settings["special"].get<bool>()))return;
    if(deaths.size()==64)deaths.erase(deaths.begin());deaths.push_back({ref,si});
}
void L4P_CALL onFrame(void*,const L4P_SourceFrameV1* f){if(!ready)return;std::lock_guard<std::mutex> lock(mutex);now=f->time_ms;
    const bool allowed=source.allowed(f,L4P_SOURCE_LOCAL)!=0,active=settings["active"].get<bool>()&&allowed;
    bool ci=active&&settings["common"].get<bool>(),si=active&&settings["special"].get<bool>();uint32_t ciCode=0,siCode=0;
    const bool allWanted=active&&settings["all"].get<bool>();
    if(ci||allWanted){ciCode=resource.claim(token,"skeeto.corpse.common");ci=ci&&ciCode==0;}else resource.release(token,"skeeto.corpse.common");
    if(si||allWanted){siCode=resource.claim(token,"skeeto.corpse.special");si=si&&siCode==0;}else resource.release(token,"skeeto.corpse.special");
    char dissolveOwner[65]{};resource.owner("skeeto.corpse.dissolve",dissolveOwner);bool pause=dissolveOwner[0]!=0;
    bool changed=dirty||commonOn!=ci||specialOn!=si||globalPaused!=pause;dirty=false;commonOn=ci;specialOn=si;globalPaused=pause;
    if(!ci&&!si){clear();lastCode=0;}
    if(changed||due(nextCvars)){
        nextCvars=now+250;rows=json::array();for(const auto& entry:definition["entries"]){const auto name=entry["name"].get<std::string>();bool on=false;
            if(name=="cl_ragdoll_maxcount")on=active&&!globalPaused&&(ci||si||(allWanted&&!ciCode&&!siCode));
            else if(name=="cl_ragdoll_maxcount_generic")on=ci;
            else if(name=="cl_ragdoll_maxcount_special"||name=="cl_ragdoll_maxcount_boss")on=si;
            else on=active&&settings["tracers"].get<bool>();auto code=on?cvar.pin(token,name.c_str(),0):cvar.release(token,name.c_str());
            rows.push_back({{"label",name},{"value",!active?(allowed?"已关闭":"等待本地服"):!on?"已关闭":code?"参数等待或冲突":"已应用"},{"code",code},{"target",0}});
        }
    }
    for(auto i=tracks.begin();i!=tracks.end();){L4P_EntityInfoV1 info{sizeof(info)};bool valid=!entity.describe(&i->ref,&info);bool isRag=valid&&rag(info.class_name);
        bool keep=valid&&!due(i->until)&&(isRag?(ci||si):(!i->special&&ci&&common(info.class_name)));
        if(keep&&isRag&&i->special&&!si&&ci)i->special=false;
        if(keep&&isRag&&!i->special&&!ci&&si){if(infectedRag(info.class_name))keep=false;else i->special=true;}
        if(!keep){corpse.release(token,&i->ref);i=tracks.erase(i);continue;}lastCode=corpse.hide(token,&i->ref);++i;
    }
    for(const auto& death:deaths){if(death.special?!si:!ci)continue;arm();if(!death.special)track(death.ref,false);}deaths.clear();
    if(scans&&due(scanAt)){
        --scans;scanAt=now+90;++scanCount;int32_t hi=0;if(!entity.highest(&hi)){int lo=std::max(65,hi-48);
            for(int idx=lo;idx<=hi&&idx<2048;++idx){L4P_EntityRefV1 ref{};L4P_EntityInfoV1 info{sizeof(info)};
                if(entity.reference(idx,&ref)||entity.describe(&ref,&info)||!rag(info.class_name))continue;
                bool isCi=infectedRag(info.class_name);if(isCi?ci:si)track(ref,!isCi);
            }
        }
    }
    if(destroys&&due(destroyAt)){--destroys;destroyAt=destroys?now+50:0;if(!globalPaused){lastCode=corpse.destroy_ragdolls(token);if(!lastCode)++destroyCount;}}
    if(ciCode||siCode)lastCode=ciCode?ciCode:siCode;
}
void L4P_CALL shutdown(){ready=false;if(token)source.unsubscribe(token);std::lock_guard<std::mutex> lock(mutex);token=0;tracks.clear();deaths.clear();}
uint32_t L4P_CALL init(const L4P_HostApiV1* host){if(!host||host->api_version!=1||host->struct_size!=sizeof(*host)||!host->plugin_directory||!host->config_json||ready)return L4P_BAD_ARGUMENT;
    try{definition=json::parse(kDefinition);json config;if(!flare_feature::validate(definition["fields"],json::parse(host->config_json),config))return L4P_BAD_ARGUMENT;
        auto dir=fs::u8path(host->plugin_directory);configFile=dir/L"config.json";auto module=GetModuleHandleW((dir.parent_path()/L"beacon.source/plugin.dll").c_str());if(!module)return L4P_ERROR;
        auto get=reinterpret_cast<L4P_GetSourceApiFn>(GetProcAddress(module,"L4P_GetSourceApi"));auto ge=reinterpret_cast<L4P_GetEntityApiFn>(GetProcAddress(module,"L4P_GetEntityApi"));auto gc=reinterpret_cast<L4P_GetCvarApiFn>(GetProcAddress(module,"L4P_GetCvarApi"));auto gp=reinterpret_cast<L4P_GetCorpseApiFn>(GetProcAddress(module,"L4P_GetCorpseApi"));auto gr=reinterpret_cast<L4P_GetResourceApiFn>(GetProcAddress(module,"L4P_GetResourceApi"));
        if(!get||!ge||!gc||!gp||!gr||get(1,&source)||ge(1,&entity)||gc(1,&cvar)||gp(1,&corpse)||gr(1,&resource))return L4P_ERROR;
        settings=config;rows=json::array();dirty=true;commonOn=specialOn=globalPaused=false;now=nextCvars=scanAt=destroyAt=scans=destroys=lastCode=scanCount=destroyCount=0;tracks.clear();deaths.clear();
        if(source.subscribe(kPluginId,L4P_SOURCE_LOCAL,"zombie_death,round_start,round_end,map_transition,mission_lost,game_newmap,server_spawn",nullptr,onFrame,onEvent,&token))return L4P_ERROR;ready=true;return L4P_OK;
    }catch(...){shutdown();return L4P_BAD_ARGUMENT;}}
uint32_t L4P_CALL invoke(const char* action,const char* params,char* out,uint32_t capacity,uint32_t* size){if(!ready||!action||!params||!out||!size)return L4P_BAD_ARGUMENT;
    try{auto args=json::parse(params);bool change=!strcmp(action,"configure");if(!args.is_object()||(!change&&(strcmp(action,"status")||!args.empty())))return L4P_BAD_ARGUMENT;std::lock_guard<std::mutex> lock(mutex);auto next=settings;
        if(change){for(const auto& p:args.items())next[p.key()]=p.value();json checked;if(!flare_feature::validate(definition["fields"],next,checked))return L4P_BAD_ARGUMENT;next=checked;}
        auto result=json{{"format","flare.report.v1"},{"title",definition["name"]},{"summary",change?"设置已保存，下一游戏帧应用":"尸体事件处理与独立开关状态"},{"settings",next},{"tracked",tracks.size()},{"scanPulses",scanCount},{"destroyPulses",destroyCount},{"code",lastCode},{"globalCleanupPaused",globalPaused},{"sections",json::array({{{"title","参数状态"},{"layout","list"},{"items",rows}},{{"title","尸体处理"},{"layout","list"},{"items",json::array({{{"label","全局布偶清理"},{"value",globalPaused?"等待尸体消散释放，类别设置保持":"按死亡事件处理"}},{{"label","追踪实体"},{"value",tracks.size()}},{{"label","布偶探测次数"},{"value",scanCount}},{{"label","布偶清理次数"},{"value",destroyCount}},{{"label","处理状态"},{"value",lastCode?"存在缺失或占用，等待下一帧":"就绪"},{"code",lastCode}}})}}})}}.dump();
        *size=uint32_t(result.size()+1);if(capacity<*size)return L4P_BUFFER_TOO_SMALL;if(change){if(!flare_feature::save(configFile,next))return L4P_ERROR;settings=next;dirty=true;}memcpy(out,result.c_str(),*size);return L4P_OK;
    }catch(...){return L4P_BAD_ARGUMENT;}}
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetPluginApi(uint32_t version,L4P_PluginApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),kPluginId,kPluginVersion,init,invoke,shutdown};return L4P_OK;
}
