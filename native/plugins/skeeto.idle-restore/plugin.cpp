// GPL-3.0. Skeeto 2.2.19 IdleFlashlight/IdleView/IdlePerson/IdleWep/BotName.
#define NOMINMAX
#include <windows.h>
#include "l4p_player.h"
#include "l4p_view.h"
#include "l4p_cvar.h"
#include "l4p_sound.h"
#include "l4p_localize.h"
#include "definition.hpp"
#include <array>
static constexpr char kId[]="skeeto.idle-restore",kVersion[]="0.1.0",kTitle[]="闲置恢复与便利",kSummary[]="恢复自己的手电、朝向、武器槽和人称，自定义八角色 BOT 显示名";
static constexpr uint32_t kScope=L4P_SOURCE_ANY;
static constexpr char kEvents[]="player_bot_replace,bot_player_replace,round_start,round_end,map_transition,mission_lost,game_newmap,server_spawn";
#define L4P_FEATURE_VALIDATE_FIELDS
#include "feature_plugin.inc"
namespace {
L4P_EntityApiV1 entities{1,sizeof(entities)};L4P_PlayerApiV1 player{1,sizeof(player)};L4P_ViewApiV1 view{1,sizeof(view)};
L4P_CvarApiV1 cvar{1,sizeof(cvar)};L4P_SoundApiV1 sound{1,sizeof(sound)};L4P_LocalizeApiV1 localize{1,sizeof(localize)};
const char* roles[]={"nick","rochelle","coach","ellis","bill","zoey","francis","louis"};
const char* keys[]={"L4D360UI_Gambler","L4D360UI_Producer","L4D360UI_Coach","L4D360UI_Mechanic","L4D360UI_NamVet","L4D360UI_TeenGirl","L4D360UI_Biker","L4D360UI_Manager"};
uint32_t localToken=0,clockNow=0,brightCode=0,controlCode=0,nameCode=0;int ownUser=0;bool filterSet=false;
std::atomic<bool> muteLive{false};std::atomic<uint32_t> muteUntil{0};json previous;
struct Flash{int want=-1,live=-1;bool armed=false,sent=false,sawIdle=false;uint32_t at=0,until=0,sampleAt=0,brightAt=0;} flash;
struct Look{bool have=false,haveLive=false,frozen=false,armed=false,wasPlaying=false,haveBot=false,haveDelta=false;unsigned writes=0;uint32_t at=0,until=0,giveUp=0;float wanted[3]{},live[3]{},bot[3]{},delta=0;} look;
struct Person{bool haveLive=false,have=false,frozen=false,armed=false;uint32_t third=0,sampleAt=0,at=0,until=0;} person;
struct Weapon{int want=0,live=0;L4P_EntityRefV1 weapon{};bool armed=false,sawIdle=false;unsigned sends=0;uint32_t at=0,until=0;} weapon;
void L4P_CALL noop(void*,const L4P_SourceFrameV1*){}
bool due(uint32_t at){return !at||int32_t(clockNow-at)>=0;}
bool clean_name(const std::string& value,std::string& result){if(value.find('\0')!=std::string::npos)return false;wchar_t wide[128]{};
    if(!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,value.c_str(),-1,wide,128))return false;size_t end=wcslen(wide),first=0;
    while(end&&(wide[end-1]==L' '||wide[end-1]==0x3000))--end;while(first<end&&(wide[first]==L' '||wide[first]==0x3000))++first;
    if(end-first>23)return false;for(size_t i=first;i<end;++i)if(wide[i]<32||wide[i]==127)return false;wide[end]=0;char out[96]{};
    if(!WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,wide+first,-1,out,sizeof(out),nullptr,nullptr))return false;result=out;return true;
}
bool own(const L4P_SourceFrameV1* f,L4P_EntityRefV1& ref,bool playing){L4P_EntityInfoV1 info{sizeof(info)};int team=0,observer=0;uint8_t life=1;
    if(f->local_user<=0||entities.reference(f->local_player,&ref)||entities.describe(&ref,&info)||info.is_bot||info.user_id!=f->local_user||
       entities.read(&ref,"m_iTeamNum",L4P_FIELD_INT,&team)||team!=2||entities.read(&ref,"m_lifeState",L4P_FIELD_BYTE,&life)||life)return false;
    if(ownUser>0&&info.user_id!=ownUser)return false;
    return !playing||(!entities.read(&ref,"m_iObserverMode",L4P_FIELD_INT,&observer)&&!observer);
}
bool observing(const L4P_SourceFrameV1* f){L4P_EntityRefV1 ref{};int observer=0;return !entities.reference(f->local_player,&ref)&&!entities.read(&ref,"m_iObserverMode",L4P_FIELD_INT,&observer)&&observer!=0;}
int light(const L4P_SourceFrameV1* f,bool playing){L4P_EntityRefV1 ref{};int flags=0;return own(f,ref,playing)&&!entities.read(&ref,"m_fEffects",L4P_FIELD_INT,&flags)?((flags&4)?1:0):-1;}
void bright_release(){cvar.release(token,"r_flashlightbrightness");cvar.release(localToken,"r_flashlightbrightness");flash.brightAt=0;brightCode=0;}
void bright_hold(){if(!due(flash.brightAt))return;flash.brightAt=clockNow+500;
    brightCode=cvar.pin(token,"r_flashlightbrightness",0);if(brightCode==L4P_CVAR_SCOPE)brightCode=cvar.pin(localToken,"r_flashlightbrightness",0);}
void mute_arm(uint32_t ms){auto until=clockNow+ms,old=muteUntil.load();if(!old||int32_t(until-old)>0)muteUntil.store(until);}
float L4P_CALL filter(void*,const char* sample,float volume){auto until=muteUntil.load();if(!muteLive.load()&&(!until||int32_t(GetTickCount()-until)>=0))return volume;
    if(!sample)return volume;constexpr char needle[]="flashlight";for(auto p=sample;*p;++p){unsigned n=0;while(needle[n]&&p[n]&&(p[n]>='A'&&p[n]<='Z'?p[n]+32:p[n])==needle[n])++n;if(!needle[n])return 0;}return volume;
}
void flash_reset(bool tail=false){bright_release();flash={};muteLive=false;if(tail)mute_arm(400);else muteUntil=0;}
void reset(){flash_reset();look={};person={};weapon={};ownUser=0;controlCode=0;}
void flash_arm(){flash.armed=true;flash.at=clockNow+150;flash.until=clockNow+4000;flash.sent=false;mute_arm(4500);}
void flash_tick(const L4P_SourceFrameV1* f){
    if(!flash.armed){if(flash.want<0){if(due(flash.sampleAt)){flash.sampleAt=clockNow+200;int live=light(f,true);if(live>=0)flash.live=live;}return;}
        if(flash.want==0)bright_hold();int on=light(f,true);if(on<0){flash.sawIdle=true;return;}
        if(flash.want!=0)bright_release();if(flash.sawIdle)flash_arm();if(!flash.armed)return;}
    if(flash.want==0)bright_hold();if(!due(flash.at))return;int on=light(f,true);
    if(on<0){flash.at=clockNow+100;if(due(flash.until))flash_reset(true);return;}
    if(on==flash.want){flash_reset(true);return;}if(due(flash.until)){flash_reset(true);return;}
    flash.at=clockNow+100;if(flash.sent)return;controlCode=player.action(token,L4P_PLAYER_FLASHLIGHT);if(!controlCode){flash.sent=true;mute_arm(800);}
}
bool angles(float out[3]){L4P_ViewV1 v{sizeof(v)};if(view.snapshot(&v)||!v.angles_valid||v.angles[0]<=-90||v.angles[0]>=90)return false;std::copy(v.angles,v.angles+3,out);return true;}
float delta(const float a[3],const float b[3]){float yaw=std::remainder(a[1]-b[1],360.f);return std::max(std::abs(a[0]-b[0]),std::abs(yaw));}
void look_snapshot(){if(look.haveLive){std::copy(look.live,look.live+3,look.wanted);look.have=true;}}
void look_finish(){look.have=look.frozen=look.armed=look.haveBot=look.haveDelta=look.wasPlaying=false;look.writes=0;}
void look_tick(const L4P_SourceFrameV1* f){L4P_EntityRefV1 ref{};bool playing=own(f,ref,true);
    if(!look.armed){if(!look.frozen){if(playing&&look.wasPlaying&&angles(look.live))look.haveLive=true;look.wasPlaying=playing;}
        if(look.have&&observing(f))look.haveBot=angles(look.bot);return;}
    if(!look.have)look_snapshot();if(!look.have||!playing){if(due(look.giveUp))look_finish();return;}
    if(!look.writes){if(!due(look.at))return;controlCode=player.set_angles(token,look.wanted);if(!controlCode){look.writes=1;look.haveDelta=false;}else if(due(look.giveUp))look_finish();return;}
    if(due(look.until)){look_finish();return;}float current[3]{};if(!angles(current))return;float d=delta(current,look.wanted);
    if(look.haveDelta){float inc=d-look.delta;if(inc>.4f&&inc<18){look_finish();return;}}look.delta=d;look.haveDelta=true;if(d<=1)return;
    float bot=look.haveBot?delta(current,look.bot):999.f;if(bot<=8&&d>=20&&look.writes<2){controlCode=player.set_angles(token,look.wanted);if(!controlCode){++look.writes;look.haveDelta=false;}}
    else if(bot>8)look_finish();
}
void person_tick(){if(!due(person.sampleAt))return;person.sampleAt=clockNow+100;if(person.frozen&&!person.armed)return;
    if(person.armed&&due(person.until)){person={};return;}uint32_t third=0;auto result=player.camera_mode(token,&third);if(result){controlCode=result;return;}
    if(person.armed){if(!due(person.at))return;controlCode=third!=person.third?player.set_camera_mode(token,person.third):L4P_OK;if(!controlCode)person.armed=person.frozen=person.have=false;}
    else {person.third=third;person.haveLive=true;}
}
int slot_from_class(const char* cn){auto has=[&](const char* s){return strstr(cn,s)!=nullptr;};
    for(auto s:{"Molotov","PipeBomb","Pipebomb","VomitJar","Vomitjar","Bile"})if(has(s))return 3;
    for(auto s:{"FirstAid","Defibrillator","Defib","UpgradePack","Incendiary","AmmoPack","Explosive"})if(has(s))return 4;
    for(auto s:{"PainPills","Adrenaline"})if(has(s))return 5;
    for(auto s:{"Pistol","Magnum","Melee","melee","Chainsaw"})if(has(s))return 2;
    for(auto s:{"Rifle","SMG","Smg","smg","Shotgun","Sniper","Hunting","Launcher","M60","AK47","Scout","AWP","MP5","SG552","Military","Chrome","Pump","Spas","AutoShot","TerrorGun","SubMachine"})if(has(s))return 1;return 0;
}
int active_slot(const L4P_EntityRefV1& ref){uint32_t handle=0;L4P_EntityRefV1 w{};L4P_EntityInfoV1 info{sizeof(info)};
    if(entities.read(&ref,"m_hActiveWeapon",L4P_FIELD_INT,&handle)||!handle||handle==0xffffffff||entities.from_handle(handle,&w))return 0;
    if(w.handle==weapon.weapon.handle&&w.epoch==weapon.weapon.epoch&&weapon.live>0)return weapon.live;
    if(entities.describe(&w,&info))return 0;int slot=slot_from_class(info.class_name);weapon.weapon=w;weapon.live=slot;return slot;
}
int own_slot(const L4P_SourceFrameV1* f,bool playing){L4P_EntityRefV1 ref{};return own(f,ref,playing)?active_slot(ref):0;}
void weapon_finish(){weapon.want=0;weapon.armed=weapon.sawIdle=false;weapon.sends=0;}
void weapon_arm(){weapon.armed=true;weapon.sends=0;weapon.at=clockNow+100;weapon.until=clockNow+2000;}
void weapon_tick(const L4P_SourceFrameV1* f){L4P_EntityRefV1 ref{};bool playing=own(f,ref,true);
    if(!weapon.armed){if(playing){if(!weapon.want)active_slot(ref);if(weapon.want&&weapon.sawIdle)weapon_arm();}else weapon.sawIdle=true;if(!weapon.armed)return;}
    if(!due(weapon.at))return;weapon.at=clockNow+100;if(due(weapon.until)){weapon_finish();return;}
    if(!playing)return;uint8_t incap=0;entities.read(&ref,"m_isIncapacitated",L4P_FIELD_BYTE,&incap);if(incap&&weapon.want!=2)return;
    int have=own_slot(f,true);if(have==weapon.want||weapon.sends>=2||weapon.want<1||weapon.want>5){weapon_finish();return;}
    controlCode=player.action(token,uint32_t(weapon.want));if(!controlCode)++weapon.sends;
}
void names(const json& c){nameCode=0;for(int i=0;i<8;++i){std::string value;clean_name(c[std::string("name-")+roles[i]].get<std::string>(),value);
        if(!c["bot-names"].get<bool>()||value.empty())localize.clear(token,keys[i]);else {auto rc=localize.set(token,keys[i],value.c_str());if(rc)nameCode=rc;}}
}
}
bool feature_validate(const json& c){std::string clean;for(auto role:roles)if(!clean_name(c[std::string("name-")+role].get<std::string>(),clean))return false;return true;}
bool feature_create(HMODULE module){auto e=reinterpret_cast<L4P_GetEntityApiFn>(GetProcAddress(module,"L4P_GetEntityApi"));auto p=reinterpret_cast<L4P_GetPlayerApiFn>(GetProcAddress(module,"L4P_GetPlayerApi"));auto v=reinterpret_cast<L4P_GetViewApiFn>(GetProcAddress(module,"L4P_GetViewApi"));
    auto c=reinterpret_cast<L4P_GetCvarApiFn>(GetProcAddress(module,"L4P_GetCvarApi"));auto s=reinterpret_cast<L4P_GetSoundApiFn>(GetProcAddress(module,"L4P_GetSoundApi"));auto l=reinterpret_cast<L4P_GetLocalizeApiFn>(GetProcAddress(module,"L4P_GetLocalizeApi"));
    return e&&p&&v&&c&&s&&l&&!e(1,&entities)&&!p(1,&player)&&!v(1,&view)&&!c(1,&cvar)&&!s(1,&sound)&&!l(1,&localize)&&!source.subscribe("skeeto.idle-restore.local",L4P_SOURCE_LOCAL,"",nullptr,noop,nullptr,&localToken);
}
void feature_tick(const json& c,const L4P_SourceFrameV1* f,bool changed){clockNow=f->time_ms;
    if(!c["active"].get<bool>()){reset();sound.clear_filter(token);filterSet=false;localize.clear(token,nullptr);feature_state("已停用，原生名称与手电亮度已交还");previous=c;return;}
    names(c);if(!source.allowed(f,kScope)){reset();sound.clear_filter(token);filterSet=false;feature_state(nameCode?"BOT 名称接口等待就绪":"等待对局；BOT 名称保持独立设置",nameCode);previous=c;return;}
    if(changed&&!previous.is_null()){if(c["flashlight"]!=previous["flashlight"])flash_reset();if(c["look"]!=previous["look"])look={};if(c["person"]!=previous["person"])person={};if(c["weapon"]!=previous["weapon"])weapon={};}
    L4P_EntityRefV1 ref{};if(!ownUser&&own(f,ref,true))ownUser=f->local_user;controlCode=0;
    if(c["flashlight"].get<bool>()){if(!filterSet)filterSet=sound.set_filter(token,nullptr,filter)==L4P_OK;flash_tick(f);muteLive=flash.want>=0||flash.armed;}
    else {flash_reset();if(filterSet){sound.clear_filter(token);filterSet=false;}}
    if(c["look"].get<bool>())look_tick(f);if(c["person"].get<bool>())person_tick();if(c["weapon"].get<bool>())weapon_tick(f);
    uint32_t cameraState=0;player.camera_status(&cameraState);L4P_SoundStatusV1 soundState{sizeof(soundState)};if(filterSet)sound.status(&soundState);
    uint32_t error=nameCode?nameCode:brightCode?brightCode:controlCode;
    if(c["person"].get<bool>()&&cameraState>=2){error=L4P_ENTITY_MISSING;feature_state(cameraState==3?"人称接口发生原生错误，已停用该接口；其他恢复继续":"当前客户端的人称接口待适配；其他恢复继续",error);}
    else if(brightCode==L4P_CVAR_SCOPE)feature_state("普通恢复已接入；受限手电亮度压暗在本地服生效",brightCode);
    else if(nameCode)feature_state("BOT 名称接口等待或存在其他占用",nameCode);
    else if(filterSet&&soundState.state>=3)feature_state("恢复已接入；手电提示音入口待适配",L4P_ENTITY_MISSING);
    else feature_state(error?"等待自己的人物、菜单关闭或可用接口":(flash.armed||look.armed||person.armed||weapon.armed)?"正在恢复闲置前状态":"已启用，等待闲置切换",error);previous=c;
}
void feature_event(const json& c,const L4P_SourceFrameV1* f,const char* name,void* event){if(!c["active"].get<bool>())return;clockNow=f->time_ms;
    if(strcmp(name,"player_bot_replace")&&strcmp(name,"bot_player_replace")){reset();return;}
    int uid=ownUser>0?ownUser:f->local_user;int human=source.event_int(event,"player",0),bot=source.event_int(event,"bot",0);if(uid<=0||(human!=uid&&bot!=uid))return;
    bool takeover=name[0]=='b';if(!ownUser)ownUser=human>0?human:uid;
    if(c["flashlight"].get<bool>()){if(!takeover){flash.want=flash.live>=0?flash.live:light(f,false);flash.live=-1;flash.armed=flash.sent=flash.sawIdle=false;flash.at=flash.until=0;}
        else if(flash.want>=0)flash_arm();muteLive=flash.want>=0||flash.armed;}
    if(c["look"].get<bool>()){if(!takeover){look_snapshot();look.frozen=true;look.haveBot=look.armed=false;}else{if(!look.have)look_snapshot();look.frozen=look.armed=true;look.at=clockNow+100;look.giveUp=clockNow+2000;look.until=clockNow+650;look.writes=0;look.haveDelta=false;}}
    if(c["person"].get<bool>()){person.frozen=true;if(!takeover){person.have=person.haveLive;person.armed=false;}else{if(!person.have)person.have=person.haveLive;person.armed=person.have;person.at=clockNow+100;person.until=clockNow+2000;}}
    if(c["weapon"].get<bool>()){if(!takeover){weapon.want=weapon.live>0?weapon.live:own_slot(f,false);weapon.armed=weapon.sawIdle=false;weapon.sends=0;}else if(weapon.want>0)weapon_arm();}
}
void feature_end(){reset();sound.clear_filter(token);filterSet=false;localize.clear(token,nullptr);if(localToken){source.unsubscribe(localToken);localToken=0;}previous=json();}
