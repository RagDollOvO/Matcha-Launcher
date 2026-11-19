// GPL-3.0. Skeeto 2.2.19 HoldSemiWeaponState / ClientUxHoldSemiPump.
#define NOMINMAX
#include <windows.h>
#include "l4p_input.h"
#include "l4p_entity.h"
#include "weapons.hpp"
#include "definition.hpp"
static constexpr char kId[]="skeeto.auto-semiauto",kVersion[]="0.1.0",kTitle[]="半自动武器按住连发",kSummary[]="物理按住左键，按所选节奏连点半自动武器";
static constexpr uint32_t kScope=L4P_SOURCE_LOCAL;static constexpr char kEvents[]="game_newmap,server_spawn";
#include "feature_plugin.inc"
namespace {
L4P_InputApiV2 input{{2,sizeof(input)}};L4P_EntityApiV1 entities{1,sizeof(entities)};
constexpr uint32_t bases[]={50,90,130,160,200,250},spans[]={10,20,40,40,60,50};
uint32_t checkedAt=0,upAt=0,lastPress=0,nextAt=0,retryAt=0,jitter=0x2545F491u;bool up=false,reset=true,eligible=false;
L4P_EntityRefV1 previous{};
void abort_pulse(){input.base.release(token);up=false;}
bool hunt_model(const L4P_EntityRefV1& ref){char model[260]{};uint32_t size=0;if(entities.model_name(&ref,model,sizeof(model),&size))return false;
    using flare_weapon::TeamHudCnIHas;return TeamHudCnIHas(model,"huntingrifle")||TeamHudCnIHas(model,"hunting_rifle")||TeamHudCnIHas(model,"sniper_hunting")||TeamHudCnIHas(model,"mini14")||TeamHudCnIHas(model,"w_sniper_mini");}
bool name_allowed(const char* name){char low[128]{};for(size_t i=0;name[i]&&i<sizeof(low)-1;++i)low[i]=char(tolower(static_cast<unsigned char>(name[i])));
    return strstr(low,"magnum")||strstr(low,"hunting")||strstr(low,"hunt_rifle")||strstr(low,"military")||strstr(low,"pistol");}
bool weapon_allowed(const L4P_EntityRefV1& me,const L4P_EntityRefV1& weapon){
    L4P_EntityInfoV1 info{sizeof(info)};if(entities.describe(&weapon,&info))return false;using namespace flare_weapon;int kind=TeamHudWepKind(info.class_name);
    if(kind==TW_M16||kind==TW_None){if(hunt_model(weapon))kind=TW_Hunt;else{uint32_t handle=0;L4P_EntityRefV1 view{};if(!entities.read(&me,"m_hViewModel[0]",L4P_FIELD_INT,&handle)&&!entities.from_handle(handle,&view)&&hunt_model(view))kind=TW_Hunt;}}
    if(kind==TW_Pistol||kind==TW_Magnum||(kind>=TW_Pump&&kind<=TW_Spas)||(kind>=TW_Hunt&&kind<=TW_GL))return true;
    if(kind!=TW_None)return false;if(name_allowed(info.class_name)||TeamHudIsHuntRifle(info.class_name))return true;
    char model[260]{};uint32_t size=0;return !entities.model_name(&weapon,model,sizeof(model),&size)&&name_allowed(model);
}
bool refresh_weapon(const L4P_SourceFrameV1* frame){
    L4P_EntityRefV1 me{},weapon{};int team=0;unsigned char life=1;uint32_t handle=0;
    if(entities.reference(frame->local_player,&me)||entities.read(&me,"m_iTeamNum",L4P_FIELD_INT,&team)||team!=2||entities.read(&me,"m_lifeState",L4P_FIELD_BYTE,&life)||life||entities.read(&me,"m_hActiveWeapon",L4P_FIELD_INT,&handle)||entities.from_handle(handle,&weapon)){previous={};eligible=false;return false;}
    if(!checkedAt||weapon.handle!=previous.handle||weapon.epoch!=previous.epoch||uint32_t(frame->time_ms-checkedAt)>=60){checkedAt=frame->time_ms;previous=weapon;eligible=weapon_allowed(me,weapon);}return eligible;
}
}
bool feature_create(HMODULE module){auto i=reinterpret_cast<L4P_GetInputApiFn>(GetProcAddress(module,"L4P_GetInputApi"));auto e=reinterpret_cast<L4P_GetEntityApiFn>(GetProcAddress(module,"L4P_GetEntityApi"));
    checkedAt=upAt=lastPress=nextAt=retryAt=0;up=false;reset=true;previous={};jitter=0x2545F491u;return i&&e&&!i(2,&input.base)&&!e(1,&entities);}
void feature_end(){input.watch_mouse(token,0);up=false;previous={};}
void feature_event(const json&,const L4P_SourceFrameV1*,const char*,void*){reset=true;}
void feature_tick(const json& config,const L4P_SourceFrameV1* frame,bool changed){
    const uint32_t now=frame->time_ms;const bool active=config["active"].get<bool>();
    if(!active||!source.allowed(frame,kScope)){input.watch_mouse(token,0);up=false;checkedAt=0;feature_state(active?"等待本地服":"已关闭");return;}
    if(changed||reset){abort_pulse();checkedAt=0;nextAt=0;retryAt=0;reset=false;}
    auto code=input.watch_mouse(token,1);L4P_MouseStateV1 mouse{sizeof(mouse)};L4P_InputStateV1 state{sizeof(state)};
    if(code||input.mouse_state(token,&mouse)||input.base.snapshot(&state)){abort_pulse();feature_state("输入接口暂不可用",code?code:L4P_INPUT_MISSING);return;}
    if(mouse.hook_state!=2){abort_pulse();feature_state(mouse.hook_state==3?"物理鼠标监听暂不可用，等待重试":"等待物理鼠标监听",mouse.last_error);return;}
    if(!state.foreground||state.game_ui){abort_pulse();feature_state("等待游戏前台与菜单关闭");return;}
    if(!refresh_weapon(frame)){abort_pulse();feature_state("等待存活生还者手持半自动武器");return;}
    if(!mouse.physical_down){abort_pulse();feature_state("按住鼠标左键连发");return;}
    if(retryAt&&int32_t(now-retryAt)<0)return;
    const auto rate=config["rate"].get<unsigned>();const auto base=bases[rate];
    if(up&&mouse.phase!=1)up=false;
    if(up){if(uint32_t(now-upAt)<16||uint32_t(now-lastPress)<base)return;code=input.mouse_edge(token,1);
        if(!code){up=false;lastPress=now;jitter^=jitter<<13;jitter^=jitter>>17;jitter^=jitter<<5;nextAt=now+base+jitter%(spans[rate]+1);feature_state("按住连发中");}
    }else{if((nextAt&&int32_t(now-nextAt)<0)||uint32_t(now-lastPress)<base)return;code=input.mouse_edge(token,0);if(!code){up=true;upAt=now;}}
    if(code){abort_pulse();retryAt=now+200;feature_state(code==L4P_INPUT_CONFLICT?"鼠标左键由其他模组占用":"连发输入暂不可用",code);}
}
