// GPL-3.0. Skeeto 2.2.19 survivor/state glow styling and laser-sight outline.
#define NOMINMAX
#include <windows.h>
#include "l4p_glow.h"
#include "l4p_cvar.h"
#include "l4p_resource.h"
#include "survivor_identity.hpp"
#include "definition.hpp"
#include <map>
#include <array>
static constexpr char kId[]="skeeto.team-glow-style",kVersion[]="0.1.0",kTitle[]="队友描边配色",kSummary[]="八角色、五组状态颜色与描边渲染";
static constexpr uint32_t kScope=L4P_SOURCE_ANY;
static constexpr char kEvents[]="game_newmap,server_spawn,round_start,round_end,map_transition,mission_lost,finale_vehicle_leaving,finale_win,bot_player_replace,player_bot_replace";
#define L4P_FEATURE_CUSTOM_ACTIONS
#define L4P_FEATURE_VALIDATE_FIELDS
#include "feature_plugin.inc"
namespace {
L4P_GlowApiV1 glow{1,sizeof(glow)};L4P_EntityApiV1 entities{1,sizeof(entities)};
L4P_CvarApiV3 cvars{{3,sizeof(cvars)}};L4P_ResourceApiV1 resources{1,sizeof(resources)};
uint32_t localToken=0,cvarOwner=0,nextColour=0,nextLaser=0,lastColourCode=0,lastLaserCode=0;
bool quiet=false,previousLocal=false,previousRealism=false,reset=false;int cursor=33;
skeeto_survivor::Identity identity;
struct Owned {L4P_EntityRefV1 ref{};uint32_t owner=0;};std::map<uint32_t,Owned> colours;std::map<uint32_t,L4P_EntityRefV1> lasers;
const char* roles[]={"nick","rochelle","coach","ellis","bill","zoey","francis","louis"};
const char* states[]={"infected-vomit","item","survivor-vomit","item-far","critical"};
const char* prefixes[]={"cl_glow_infected_vomit_","cl_glow_item_","cl_glow_survivor_vomit_","cl_glow_item_far_","cl_glow_survivor_health_crit_"};
constexpr int presets[]={RGB(185,230,255),RGB(180,92,255),RGB(255,201,40),RGB(36,224,163),RGB(111,175,69),RGB(240,79,100),RGB(255,122,34),RGB(57,169,255)};
constexpr int palette[]={RGB(255,64,72),RGB(255,128,32),RGB(255,214,48),RGB(72,220,112),RGB(48,220,220),RGB(72,144,255),RGB(176,88,255),RGB(255,88,176),RGB(245,245,245)};
const char* paletteNames[]={"红","橙","黄","绿","青","蓝","紫","粉","白"};
bool same(const L4P_EntityRefV1& a,const L4P_EntityRefV1& b){return a.index==b.index&&a.handle==b.handle&&a.epoch==b.epoch;}
int custom(const std::string& text){if(text.size()!=7||text[0]!='#'||text.find_first_not_of("0123456789abcdefABCDEF",1)!=std::string::npos)return -1;
    unsigned rgb=std::stoul(text.substr(1),nullptr,16);return int(((rgb&255)<<16)|(rgb&0xff00)|((rgb>>16)&255));}
int selected(const json& config,const char* key,int preset=-1){const auto value=config[key].get<std::string>();
    if(value=="原版")return -1;if(value=="角色预设")return preset;if(value=="自定义")return custom(config[std::string(key)+"-rgb"].get<std::string>());
    for(int i=0;i<9;++i)if(value==paletteNames[i])return palette[i];return -1;}
void clear_colours(){for(const auto& p:colours)glow.release(p.second.owner,&p.second.ref);colours.clear();nextColour=0;lastColourCode=0;}
void clear_lasers(){for(const auto& p:lasers)glow.release(localToken,&p.second);lasers.clear();nextLaser=0;cursor=33;lastLaserCode=0;}
bool occupied(const char* name){char owner[65]{};return resources.owner(name,owner)==0&&*owner;}
void L4P_CALL local_frame(void*,const L4P_SourceFrameV1*){}
void apply_colours(const json& config,const L4P_SourceFrameV1* frame,bool local,bool forced,const std::array<int,8>& chosen){
    if(!forced&&nextColour&&int32_t(frame->time_ms-nextColour)<0)return;nextColour=frame->time_ms+250;lastColourCode=0;
    bool alpha=local&&config["always"].get<bool>();uint32_t owner=alpha?localToken:token;std::map<uint32_t,Owned> next;
    for(const auto& p:identity.gather(entities,frame->map)){
        if(p.info.ref.index==uint32_t(frame->local_player)||p.dead||(chosen[p.role]<0&&!alpha))continue;
        auto old=colours.find(p.info.ref.index);if(old!=colours.end()&&(old->second.owner!=owner||!same(old->second.ref,p.info.ref)))glow.release(old->second.owner,&old->second.ref);
        auto result=glow.survivor_colour(owner,&p.info.ref,chosen[p.role],alpha?1:0);
        if(result==0)next.emplace(p.info.ref.index,Owned{p.info.ref,owner});else lastColourCode=result;
    }
    for(const auto& p:colours)if(!next.count(p.first))glow.release(p.second.owner,&p.second.ref);colours=std::move(next);
}
bool laser_target(const L4P_EntityRefV1& ref){L4P_EntityInfoV1 info{sizeof(info)};int effects=0;uint32_t owner=0;char model[260]{};uint32_t size=0;
    if(entities.describe(&ref,&info)||strcmp(info.class_name,"CBaseUpgradeItem")||entities.read(&ref,"m_fEffects",L4P_FIELD_INT,&effects)||(effects&32)||entities.read(&ref,"m_hOwnerEntity",L4P_FIELD_INT,&owner)||(owner&&owner!=~0u)||entities.model_name(&ref,model,sizeof(model),&size))return false;
    for(auto& c:model)if(c=='\\')c='/';return !_stricmp(model,"models/w_models/weapons/w_laser_sights.mdl");
}
bool laser_allowed(const L4P_SourceFrameV1* frame){if(quiet||occupied("skeeto.hud.pause-sampling")||occupied("skeeto.hud.hide-world"))return false;
    L4P_EntityRefV1 local{};int team=0;unsigned char life=1;return entities.reference(frame->local_player,&local)==0&&entities.read(&local,"m_iTeamNum",L4P_FIELD_INT,&team)==0&&team==2&&entities.read(&local,"m_lifeState",L4P_FIELD_BYTE,&life)==0&&!life;
}
void apply_lasers(const L4P_SourceFrameV1* frame,bool forced){
    if(!forced&&nextLaser&&int32_t(frame->time_ms-nextLaser)<0)return;nextLaser=frame->time_ms+200;lastLaserCode=0;
    for(auto i=lasers.begin();i!=lasers.end();){
        L4P_EntityRefV1 current{};uint32_t result=0;
        if(entities.reference(int(i->first),&current)||!same(current,i->second)||!laser_target(current))result=L4P_ENTITY_MISSING;
        else result=glow.outline(localToken,&current,RGB(255,70,70),32767);
        if(result){glow.release(localToken,&i->second);i=lasers.erase(i);}else ++i;
    }
    int high=0;if(entities.highest(&high)||high<33)return;high=std::min(high,2047);
    // Bounded round-robin discovery; occupied native outlines keep their owner.
    for(int n=0;n<std::min(128,high-32)&&lasers.size()<8;++n){if(cursor>high)cursor=33;const int index=cursor++;if(lasers.count(index))continue;
        L4P_EntityRefV1 ref{};if(entities.reference(index,&ref)||!laser_target(ref))continue;auto result=glow.outline(localToken,&ref,RGB(255,70,70),32767);
        if(result==0)lasers.emplace(index,ref);else if(result!=L4P_GLOW_CONFLICT)lastLaserCode=result;
    }
}
uint32_t apply_cvars(const json& config,bool wanted,bool realism,bool local){uint32_t owner=local?localToken:token,result=0;
    if(cvarOwner&&cvarOwner!=owner)cvars.base.release(cvarOwner,nullptr);cvarOwner=owner;
    const char* renderKeys[]={"brightness","blur"};const char* renderVars[]={"cl_glow_brightness","cl_glow_blur_scale"};
    for(int i=0;i<2;++i){int pct=config[renderKeys[i]].get<int>();uint32_t code=0;
        if(wanted&&!realism&&pct!=100)code=cvars.pin_relative(owner,renderVars[i],float(pct)/100);else cvars.base.release(owner,renderVars[i]);if(code)result=code;}
    for(int i=0;i<5;++i){int rgb=selected(config,states[i]);for(int channel=0;channel<3;++channel){std::string name=prefixes[i];name+="rgb"[channel];
        if(rgb<0)cvars.base.release(owner,name.c_str());else {auto code=cvars.base.pin(owner,name.c_str(),float((rgb>>(8*channel))&255)/255);if(code)result=code;}}}
    return result;
}
}
bool feature_validate(const json& config){for(auto key:roles)if(custom(config[std::string(key)+"-rgb"].get<std::string>())<0)return false;
    for(auto key:states)if(custom(config[std::string(key)+"-rgb"].get<std::string>())<0)return false;return true;}
bool feature_create(HMODULE module){
    auto g=reinterpret_cast<L4P_GetGlowApiFn>(GetProcAddress(module,"L4P_GetGlowApi"));auto e=reinterpret_cast<L4P_GetEntityApiFn>(GetProcAddress(module,"L4P_GetEntityApi"));
    auto c=reinterpret_cast<L4P_GetCvarApiFn>(GetProcAddress(module,"L4P_GetCvarApi"));auto r=reinterpret_cast<L4P_GetResourceApiFn>(GetProcAddress(module,"L4P_GetResourceApi"));
    if(!g||!e||!c||!r||g(1,&glow)||e(1,&entities)||c(3,reinterpret_cast<L4P_CvarApiV1*>(&cvars))||r(1,&resources))return false;
    identity.clear();quiet=false;reset=true;previousLocal=false;previousRealism=false;
    return source.subscribe("skeeto.team-glow-style.local",L4P_SOURCE_LOCAL,"",nullptr,local_frame,nullptr,&localToken)==0;
}
void feature_end(){if(localToken){source.unsubscribe(localToken);localToken=0;}colours.clear();lasers.clear();cvarOwner=0;nextColour=nextLaser=0;identity.clear();}
void feature_event(const json&,const L4P_SourceFrameV1*,const char* name,void*){
    nextColour=nextLaser=0;
    if(!strcmp(name,"game_newmap")||!strcmp(name,"server_spawn")||!strcmp(name,"round_start")){quiet=false;identity.clear();reset=true;}
    else if(strcmp(name,"bot_player_replace")&&strcmp(name,"player_bot_replace"))quiet=true;
}
void feature_tick(const json& config,const L4P_SourceFrameV1* frame,bool changed){
    if(!config["active"].get<bool>()||!source.allowed(frame,kScope)){
        clear_colours();clear_lasers();if(cvarOwner)cvars.base.release(cvarOwner,nullptr);cvarOwner=0;reset=true;
        if(!frame->in_game||frame->loading){quiet=false;identity.clear();}
        feature_state(config["active"].get<bool>()?"等待游戏就绪":"已关闭，恢复原描边");return;
    }
    bool local=source.allowed(frame,L4P_SOURCE_LOCAL)!=0,realism=!_stricmp(frame->mode,"realism");
    changed=changed||reset||local!=previousLocal||realism!=previousRealism;previousLocal=local;previousRealism=realism;
    if(reset){clear_colours();clear_lasers();reset=false;}
    std::array<int,8> chosen{};bool wanted=local&&config["always"].get<bool>();for(int i=0;i<8;++i){chosen[i]=selected(config,roles[i],presets[i]);wanted=wanted||chosen[i]>=0;}
    if(wanted&&!realism)apply_colours(config,frame,local,changed,chosen);else clear_colours();
    const uint32_t code=apply_cvars(config,wanted,realism,local);
    bool laser=config["laser"].get<bool>();if(laser&&local&&laser_allowed(frame))apply_lasers(frame,changed);else clear_lasers();
    uint32_t failure=code?code:lastColourCode?lastColourCode:lastLaserCode;
    std::string state=std::to_string(colours.size())+" 名队友已配色 · "+std::to_string(lasers.size())+" 处激光红点描边";
    if(realism)state+=" · 写实模式保留原生队友描边";
    if(!local&&(laser||config["always"].get<bool>()))state+=" · 常亮 / 激光描边等待本地服";
    if(failure)state+=" · 部分接口或参数暂不可用";feature_state(state.c_str(),failure);
}
uint32_t feature_custom_invoke(const char* action,const char* parameters,char* out,uint32_t capacity,uint32_t* size){
    try{if(json::parse(parameters)!=json::object())return L4P_BAD_ARGUMENT;json update=json::object();
        if(!strcmp(action,"role-presets")||!strcmp(action,"reset-roles")){for(auto key:roles)update[key]=!strcmp(action,"role-presets")?"角色预设":"原版";}
        else if(!strcmp(action,"reset-states")){for(auto key:states)update[key]="原版";}
        else if(!strcmp(action,"reset-render"))update={{"brightness",100},{"blur",100},{"always",false}};
        else return L4P_BAD_ARGUMENT;auto text=update.dump();return feature_invoke("configure",text.c_str(),out,capacity,size);
    }catch(...){return L4P_BAD_ARGUMENT;}
}
