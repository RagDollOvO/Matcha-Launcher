// GPL-3.0. SilentSi sound state machine, independently ported from Skeeto 2.2.19.
#define NOMINMAX
#include <windows.h>
#include "l4p_audio.h"
#include "definition.hpp"
#include <array>
#include <vector>
#include <algorithm>
#include <cmath>
static constexpr char kId[]="skeeto.silent-si-fix",kVersion[]="0.1.0",kTitle[]="无声特感补发提示音",kSummary[]="本地服补充特感出生和近距离提示音";
static constexpr uint32_t kScope=L4P_SOURCE_LOCAL;
static constexpr char kEvents[]="player_spawn,game_newmap,server_spawn";
#include "feature_plugin.inc"
namespace {
L4P_EntityApiV1 entities{1,sizeof(entities)};L4P_AudioApiV1 audio{1,sizeof(audio)};
struct Slot {L4P_EntityRefV1 ref{};int kind=0;bool eligible=false,pending=false,done=false,armed=true;uint32_t last=0;};
struct Pending {int user;uint32_t at;};
std::array<Slot,33> slots;std::vector<Pending> pending;
uint32_t scanAt=0,retryAt=0,testAt=0,mapEpoch=0;bool suppress=true,prepared=false,seen=false,wasActive=false;
int lastSource=0;unsigned rotation=0;
constexpr const char* alerts[]={nullptr,"player/smoker/voice/alert/smoker_alert_01.wav","player/boomer/voice/alert/male_boomer_alert_04.wav","player/hunter/voice/alert/hunter_alert_01.wav","player/spitter/voice/alert/spitter_alert_01.wav","player/jockey/voice/alert/jockey_02.wav","player/charger/voice/alert/charger_alert_01.wav"};
constexpr const char* music[]={nullptr,"music/bacteria/smokerbacteria.wav","music/bacteria/boomerbacteria.wav","music/bacteria/hunterbacteria.wav","music/bacteria/spitterbacteria.wav","music/bacteria/jockeybacteria.wav","music/bacteria/chargerbacteria.wav"};
constexpr const char* female="player/boomer/voice/alert/female_boomer_alert_04.wav";
void clear(bool existing){slots={};pending.clear();scanAt=0;testAt=0;suppress=existing;}
template<class T>bool read(const L4P_EntityRefV1& ref,const char* name,uint32_t type,T& out){return entities.read(&ref,name,type,&out)==L4P_OK;}
bool prepare(int mode){bool ok=true;for(int i=1;i<=6;++i){auto result=audio.prepare(token,mode?music[i]:alerts[i]);if(result!=L4P_OK){ok=false;if(mode)audio.prepare(token,alerts[i]);}}
    if(!mode)ok=audio.prepare(token,female)==L4P_OK&&ok;return ok;}
const char* sample(int kind,int mode,const L4P_EntityRefV1& ref){if(mode)return music[kind];if(kind==2){char model[260]{};uint32_t size=0;
    if(entities.model_name(&ref,model,sizeof(model),&size)==L4P_OK&&(strstr(model,"boomette")||strstr(model,"female_boomer")))return female;}return alerts[kind];}
uint32_t emit(const L4P_EntityRefV1& ref,const float* origin,const char* sound){L4P_AudioEmitV1 input{sizeof(input)};input.slot=rotation++&7;input.spatial=1;input.entity=ref;memcpy(input.origin,origin,12);input.volume=1;input.attenuation=.8f;input.pitch=100;input.sample=sound;int guid=-1;return audio.emit(token,&input,&guid);}
}
bool feature_create(HMODULE module){auto ge=reinterpret_cast<L4P_GetEntityApiFn>(GetProcAddress(module,"L4P_GetEntityApi"));auto ga=reinterpret_cast<L4P_GetAudioApiFn>(GetProcAddress(module,"L4P_GetAudioApi"));
    if(!ge||!ga||ge(1,&entities)||ga(1,&audio))return false;clear(true);prepared=seen=wasActive=false;retryAt=mapEpoch=0;lastSource=0;rotation=0;return true;
}
void feature_end(){audio.stop_all(token);clear(true);}
void feature_event(const json& config,const L4P_SourceFrameV1* f,const char* name,void* event){
    if(!strcmp(name,"game_newmap")||!strcmp(name,"server_spawn")){clear(false);prepared=false;retryAt=mapEpoch=0;return;}
    if(!config["active"].get<bool>())return;int user=source.event_int(event,"userid",0);if(user<=0)return;
    for(auto& p:pending)if(p.user==user){p.at=f->time_ms;return;}if(pending.size()==8)pending.erase(pending.begin());pending.push_back({user,f->time_ms});
}
void feature_tick(const json& config,const L4P_SourceFrameV1* f,bool changed){
    bool active=config["active"].get<bool>(),proximity=config["proximity"].get<bool>();int mode=config["source"]=="music"?1:0;
    if(changed){if(!seen||active!=wasActive||mode!=lastSource){audio.stop_all(token);clear(true);prepared=false;retryAt=0;
            if(seen&&active)testAt=f->time_ms+450;}seen=true;wasActive=active;lastSource=mode;}
    if(!active){clear(true);audio.stop_all(token);feature_state("已关闭");return;}
    if(!source.allowed(f,kScope)){clear(true);prepared=false;audio.stop_all(token);feature_state("等待本地服务器",L4P_ENTITY_SCOPE);return;}
    L4P_EntityRefV1 me{};if(entities.reference(f->local_player,&me)!=L4P_OK){feature_state("等待玩家实体",L4P_ENTITY_MISSING);return;}
    if(mapEpoch!=me.epoch){if(mapEpoch)clear(false);mapEpoch=me.epoch;prepared=false;retryAt=0;}
    if(!prepared&&(!retryAt||int32_t(f->time_ms-retryAt)>=0)){retryAt=f->time_ms+1000;prepared=prepare(mode);}
    if(scanAt&&uint32_t(f->time_ms-scanAt)<100)return;scanAt=f->time_ms;
    uint8_t life=1;int team=0,observer=0;float local[3]{};
    if(!read(me,"m_lifeState",L4P_FIELD_BYTE,life)||!read(me,"m_iTeamNum",L4P_FIELD_INT,team)||!read(me,"m_vecOrigin",L4P_FIELD_VECTOR,local)){feature_state("玩家状态字段缺失",L4P_ENTITY_MISSING);return;}
    entities.read(&me,"m_iObserverMode",L4P_FIELD_INT,&observer);if(life||team!=2||observer){audio.stop_all(token);feature_state("等待存活幸存者");return;}
    if(!prepared){feature_state("等待游戏音频资源",L4P_ENTITY_MISSING);return;}
    if(testAt&&int32_t(f->time_ms-testAt)>=0){testAt=0;emit(me,local,mode?music[1]:alerts[1]);}
    int attempts=0;for(auto i=pending.begin();i!=pending.end()&&attempts<2;){++attempts;L4P_EntityRefV1 ref{};auto result=entities.for_user(i->user,&ref);
        if(result==L4P_OK&&ref.index<=32){slots[ref.index]={};slots[ref.index].pending=true;i=pending.erase(i);}
        else if(uint32_t(f->time_ms-i->at)>=1500)i=pending.erase(i);else ++i;}
    bool attempted=false;uint32_t emitCode=L4P_OK;
    for(int i=1;i<=32;++i){auto& slot=slots[i];L4P_EntityRefV1 ref{};int kind=0,t=0;uint8_t dead=1,ghost=1;float origin[3]{};
        if(entities.reference(i,&ref)!=L4P_OK||!read(ref,"m_iTeamNum",L4P_FIELD_INT,t)||!read(ref,"m_lifeState",L4P_FIELD_BYTE,dead)||!read(ref,"m_zombieClass",L4P_FIELD_INT,kind)||!read(ref,"m_isGhost",L4P_FIELD_BYTE,ghost)||!read(ref,"m_vecOrigin",L4P_FIELD_VECTOR,origin)){slot={};continue;}
        bool eligible=t==3&&!dead&&!ghost&&kind>=1&&kind<=6;
        if(ref.handle!=slot.ref.handle||ref.epoch!=slot.ref.epoch||slot.kind!=kind){slot={};slot.ref=ref;slot.kind=kind;slot.pending=eligible;}
        else if(eligible&&!slot.eligible){slot.pending=true;slot.done=false;slot.armed=true;}slot.eligible=eligible;if(!eligible)continue;
        float dist=-1;if(proximity){dist=0;for(int j=0;j<3;++j){float d=origin[j]-local[j];dist+=d*d;}}
        if(suppress){slot.pending=false;slot.done=true;slot.armed=!proximity||dist>90000;continue;}
        if(proximity&&!slot.armed&&dist>=160000)slot.armed=true;if(attempted)continue;
        bool spawn=slot.pending&&!slot.done;bool close=proximity&&slot.armed&&dist<=90000&&(!slot.last||uint32_t(f->time_ms-slot.last)>=4000);
        if(!spawn&&!close)continue;if(spawn){slot.pending=false;slot.done=true;}attempted=true;emitCode=emit(ref,origin,sample(kind,mode,ref));
        if(close||(proximity&&dist<=90000))slot.last=f->time_ms;if(proximity&&dist<=90000)slot.armed=false;
    }
    suppress=false;feature_state(emitCode==L4P_OK?"正在监听出生与近距离状态":"提示音播放失败",emitCode);
}
