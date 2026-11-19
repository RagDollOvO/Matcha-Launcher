// GPL-3.0. Skeeto 2.2.19 HoldSemiAutoReloadTick / HoldSemiPumpReloadActionReady.
#define NOMINMAX
#include <windows.h>
#include "l4p_input.h"
#include "l4p_weapon.h"
#include "weapons.hpp"
#include "definition.hpp"
static constexpr char kId[]="skeeto.auto-reload",kVersion[]="0.1.0",kTitle[]="霰弹枪自动换弹",kSummary[]="单喷与连喷分别启停，沿用当前换弹键";
static constexpr uint32_t kScope=L4P_SOURCE_LOCAL;static constexpr char kEvents[]="game_newmap,server_spawn";
#include "feature_plugin.inc"
namespace {
L4P_InputApiV1 input{1,sizeof(input)};L4P_WeaponApiV1 weapons{1,sizeof(weapons)};L4P_EntityApiV1 entities{1,sizeof(entities)};
uint32_t nextAt=0,downAt=0,jitter=0x2545F491u;bool down=false,reset=true;uint32_t lastCode=0;
void release(){auto result=input.release(token);if(!result)down=false;lastCode=result;}
bool active_weapon(const L4P_SourceFrameV1* frame,L4P_EntityRefV1& player,L4P_EntityRefV1& weapon,int& kind){
    int team=0;unsigned char life=1;uint32_t handle=0;
    if(entities.reference(frame->local_player,&player)||entities.read(&player,"m_iTeamNum",L4P_FIELD_INT,&team)||team!=2||entities.read(&player,"m_lifeState",L4P_FIELD_BYTE,&life)||life||entities.read(&player,"m_hActiveWeapon",L4P_FIELD_INT,&handle)||entities.from_handle(handle,&weapon))return false;
    L4P_EntityInfoV1 info{sizeof(info)};if(entities.describe(&weapon,&info))return false;kind=flare_weapon::TeamHudWepKind(info.class_name);return true;
}
bool pump_ready(const L4P_EntityRefV1& player,const L4P_EntityRefV1& weapon){
    for(const char* command:{"+attack","+attack2"}){L4P_BindingV1 key{sizeof(key)};if(input.binding(command,&key)||key.held)return false;}
    float now=0,fire=0,shove=0;if(entities.client_time(&now)||now<=0||entities.read(&weapon,"m_flNextPrimaryAttack",L4P_FIELD_FLOAT,&fire)||fire>now)return false;
    if(!entities.read(&player,"m_flNextShoveTime",L4P_FIELD_FLOAT,&shove)&&shove>now&&shove-now<8)return false;return true;
}
}
bool feature_create(HMODULE module){auto i=reinterpret_cast<L4P_GetInputApiFn>(GetProcAddress(module,"L4P_GetInputApi"));auto w=reinterpret_cast<L4P_GetWeaponApiFn>(GetProcAddress(module,"L4P_GetWeaponApi"));auto e=reinterpret_cast<L4P_GetEntityApiFn>(GetProcAddress(module,"L4P_GetEntityApi"));
    reset=true;down=false;nextAt=0;jitter=0x2545F491u;return i&&w&&e&&!i(1,&input)&&!w(1,&weapons)&&!e(1,&entities);}
void feature_end(){release();nextAt=0;reset=true;}
void feature_event(const json&,const L4P_SourceFrameV1*,const char*,void*){reset=true;}
void feature_tick(const json& config,const L4P_SourceFrameV1* frame,bool changed){
    const uint32_t now=frame->time_ms;bool active=config["active"].get<bool>()&&(config["pump"].get<bool>()||config["auto"].get<bool>());
    L4P_InputStateV1 state{sizeof(state)};
    if(!active||!source.allowed(frame,kScope)||input.snapshot(&state)||!state.foreground||state.game_ui){release();nextAt=now+200;
        feature_state(!active?"已关闭":!source.allowed(frame,kScope)?"等待本地服":"等待游戏前台与菜单关闭",lastCode);return;}
    if(changed||reset){release();nextAt=now+200;reset=false;}
    if(down){if(uint32_t(now-downAt)>=24)release();return;}
    if(nextAt&&int32_t(now-nextAt)<0)return;
    using namespace flare_weapon;L4P_EntityRefV1 me{},weapon{};int kind=TW_None;
    if(!active_weapon(frame,me,weapon,kind)){nextAt=now+200;feature_state("等待存活生还者手持霰弹枪");return;}
    bool pump=kind==TW_Pump||kind==TW_Chrome;bool selected=(pump&&config["pump"].get<bool>())||((kind==TW_Auto||kind==TW_Spas)&&config["auto"].get<bool>());
    if(!selected){nextAt=now+200;feature_state("等待所选霰弹枪");return;}
    int clip=0,capacity=pump?8:10;unsigned char reload=0;bool nativeCapacity=weapons.clip_capacity(token,&weapon,&capacity)==L4P_OK;
    if(entities.read(&weapon,"m_bInReload",L4P_FIELD_BYTE,&reload)||reload||entities.read(&weapon,"m_iClip1",L4P_FIELD_INT,&clip)||clip<0||clip>=capacity||(pump&&!pump_ready(me,weapon))){nextAt=now+200;feature_state("等待换弹时机");return;}
    lastCode=input.press(token,"+reload");if(lastCode){nextAt=now+(lastCode==L4P_INPUT_HELD?200:500);feature_state(lastCode==L4P_INPUT_HELD?"玩家正在按住换弹键":lastCode==L4P_INPUT_MISSING?"请先在游戏中绑定换弹键":"换弹输入暂不可用",lastCode);return;}
    down=true;downAt=now;jitter^=jitter<<13;jitter^=jitter>>17;jitter^=jitter<<5;nextAt=now+200+jitter%101;
    feature_state(nativeCapacity?"按当前弹匣容量自动换弹":"自动换弹 · 使用原版弹匣容量");
}
