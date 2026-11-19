// GPL-3.0. Skeeto 2.2.19 ClientUx* cues and cosmetic ScriptExtras.
#define NOMINMAX
#include <windows.h>
#include "l4p_audio.h"
#include "l4p_weapon.h"
#include "l4p_draw.h"
#include "l4p_view.h"
#include "l4p_cvar.h"
#include "l4p_file.h"
#include "l4p_effects.h"
#include "l4p_resource.h"
#include "weapons.hpp"
#include "definition.hpp"
#include <array>
static constexpr char kId[]="skeeto.script-cues",kVersion[]="0.1.0",kTitle[]="屏幕与音效提示",kSummary[]="生命淡出、射击与换弹声音、爬梯脚步和房间混响";
static constexpr uint32_t kScope=L4P_SOURCE_ANY;
static constexpr char kEvents[]="game_newmap,server_spawn,round_start,weapon_reload,pills_used,adrenaline_used,bot_player_replace,player_bot_replace";
#include "feature_plugin.inc"
namespace {
L4P_EntityApiV3 entity{{{3,sizeof(entity)}}};auto& entities=entity.base.base;
L4P_AudioApiV1 audio{1,sizeof(audio)};L4P_WeaponApiV1 weapons{1,sizeof(weapons)};L4P_CvarApiV1 cvar{1,sizeof(cvar)};
L4P_DrawApiV1 draw{1,sizeof(draw)};L4P_ViewApiV1 view{1,sizeof(view)};L4P_FileApiV2 files{{2,sizeof(files)}};
L4P_EffectsApiV1 effects{1,sizeof(effects)};L4P_ResourceApiV1 resource{1,sizeof(resource)};
uint32_t localToken=0,healthAt=0,clipAt=0,cueAt=0,ladderAt=0,cvarAt=0,roomAt=0;unsigned rotation=0,step=0;
bool running=false,armed39=true,armed72=true,hadHealth=false,wasIncap=false,reloadSuppress=false,clipsOn=false,reverb=false;
L4P_EntityRefV1 lastWeapon{};int lastClip=-1,roomCell[3]{},roomBand=1;json previous;
uint32_t audioCode=0,mountCode=0,rollCode=0,scorchCode=0,reverbCode=0;std::string failedSample;
struct Fade{int kind=0;uint32_t start=0,duration=0;uint8_t alpha=0;};Fade fade;
struct Delayed{int kind=0;uint32_t at=0;std::string path;};std::array<Delayed,12> delayed;size_t delayedCount=0;
void L4P_CALL noop(void*,const L4P_SourceFrameV1*){}
void reset_samples(){healthAt=clipAt=cueAt=ladderAt=roomAt=0;lastWeapon={};lastClip=-1;reloadSuppress=false;clipsOn=false;fade={};delayedCount=0;hadHealth=wasIncap=false;armed39=armed72=true;}
void release(){audio.stop_all(token);files.unmount_assets(token);cvar.release(token,nullptr);cvar.release(localToken,nullptr);resource.release(token,nullptr);reverb=false;reset_samples();running=false;}
void emit(const char* sample,float volume=1.f){if(volume<=0)return;L4P_AudioEmitV1 sound{sizeof(sound)};sound.slot=rotation++&7;sound.sample=sample;sound.volume=volume;sound.pitch=100;int32_t guid=-1;
    audioCode=audio.emit(token,&sound,&guid);failedSample=audioCode?sample:"";
}
void cue(const char* sample,uint32_t now){if(cueAt&&uint32_t(now-cueAt)<30)return;cueAt=now;emit(sample);}
void queue(int kind,std::string sample,uint32_t delay,uint32_t now){if(delayedCount<delayed.size())delayed[delayedCount++]={kind,now+delay,std::move(sample)};}
void delayed_pump(const json& c,uint32_t now){size_t write=0;for(size_t i=0;i<delayedCount;++i){auto& d=delayed[i];if(!(d.kind==1?c["shell"].get<bool>():c["magazine"].get<bool>()))continue;
        if(int32_t(now-d.at)>=0)emit(d.path.c_str(),d.kind==1?c["shell-volume"].get<int>()/100.f:1.f);else{if(write!=i)delayed[write]=std::move(d);++write;}}delayedCount=write;}
bool local_player(const L4P_SourceFrameV1* f,L4P_EntityRefV1& me){int team=0,observer=0;uint8_t life=1;
    if(entities.reference(f->local_player,&me)||entities.read(&me,"m_iTeamNum",L4P_FIELD_INT,&team)||team!=2||entities.read(&me,"m_lifeState",L4P_FIELD_BYTE,&life)||life)return false;
    return entities.read(&me,"m_iObserverMode",L4P_FIELD_INT,&observer)!=L4P_OK||observer==0;
}
bool hunt_model(const L4P_EntityRefV1& ref){char model[260]{};uint32_t size=0;if(entities.model_name(&ref,model,sizeof(model),&size))return false;
    using flare_weapon::TeamHudCnIHas;return TeamHudCnIHas(model,"huntingrifle")||TeamHudCnIHas(model,"hunting_rifle")||TeamHudCnIHas(model,"sniper_hunting")||TeamHudCnIHas(model,"mini14")||TeamHudCnIHas(model,"w_sniper_mini");}
bool weapon(const L4P_EntityRefV1& me,L4P_EntityRefV1& wep,int& kind,bool exclude=false){uint32_t h=0;L4P_EntityInfoV1 info{sizeof(info)};
    if(entities.read(&me,"m_hActiveWeapon",L4P_FIELD_INT,&h)||entities.from_handle(h,&wep)||entities.describe(&wep,&info))return false;
    using namespace flare_weapon;const char* cn=info.class_name;
    if(exclude&&(TeamHudCnIHas(cn,"minigun")||TeamHudCnIHas(cn,"mounted")||TeamHudCnIHas(cn,"chainsaw")||TeamHudCnIHas(cn,"grenade_launcher")||TeamHudCnIHas(cn,"GrenadeLauncher")))return false;
    kind=TeamHudWepKind(cn);if(kind==TW_M16||kind==TW_None){if(hunt_model(wep))kind=TW_Hunt;else{L4P_EntityRefV1 vm{};if(!entities.read(&me,"m_hViewModel[0]",L4P_FIELD_INT,&h)&&!entities.from_handle(h,&vm)&&hunt_model(vm))kind=TW_Hunt;}}
    return kind>=TW_Pistol&&kind<=TW_GL&&kind!=TW_Melee&&kind!=TW_Saw;
}
void health(const L4P_SourceFrameV1* f,const L4P_EntityRefV1& me){const auto now=f->time_ms;if(healthAt&&uint32_t(now-healthAt)<50)return;healthAt=now;
    int hp=0,cap=100,temp=0;float buffer=0,start=0,time=0,rate=.27f;uint8_t incap=0;
    if(entities.read(&me,"m_iHealth",L4P_FIELD_INT,&hp))return;int max=0;if(!entities.read(&me,"m_iMaxHealth",L4P_FIELD_INT,&max)&&max>0&&max<=1000)cap=max;
    if(!entities.read(&me,"m_healthBuffer",L4P_FIELD_FLOAT,&buffer)&&buffer>0&&buffer<200){
        entities.read(&me,"m_healthBufferTime",L4P_FIELD_FLOAT,&start);float v=0;if(!cvar.read("pain_pills_decay_rate",&v)&&v>0&&v<10)rate=v;
        entities.client_time(&time);if(start>0&&time>start)buffer-= (time-start)*rate;temp=int(std::max(0.f,buffer)+.5f);}
    entities.read(&me,"m_isIncapacitated",L4P_FIELD_BYTE,&incap);if(hp<=0&&temp<=0&&!incap)return;
    if(hadHealth&&wasIncap&&!incap)armed39=false;hadHealth=true;wasIncap=incap!=0;
    const int64_t total=int64_t(hp)+temp;bool trigger=false;
    if(incap){if(total>72)armed72=true;if(total<=72&&armed72){armed72=false;trigger=true;}}
    else{const auto pct=total*100/cap;if(pct>41)armed39=true;if(pct<=39&&armed39){armed39=false;trigger=true;}}
    if(trigger)fade={1,now,1000,96};
}
void paint_fade(const json& c,uint32_t now){if(!fade.kind)return;if((fade.kind==1&&!c["low-health"].get<bool>())||(fade.kind==2&&!c["heal"].get<bool>())||uint32_t(now-fade.start)>=fade.duration){fade={};return;}
    L4P_ViewV1 state{sizeof(state)};if(view.snapshot(&state)||state.game_ui||!(state.paint_mode&L4P_PAINT_GAME))return;
    int w=0,h=0;if(draw.screen(token,&w,&h)||w<1||h<1)return;auto a=uint8_t(uint64_t(fade.alpha)*(fade.duration-uint32_t(now-fade.start))/fade.duration);
    if(a)draw.rect(token,0,0,w,h,{uint8_t(fade.kind==1?255:0),uint8_t(fade.kind==2?255:0),0,a},1);
}
int room(const L4P_EntityRefV1& me,uint32_t now){float eye[3]{};if(entities.eye(&me,eye))return -1;int cell[3];for(int i=0;i<3;++i)cell[i]=int(eye[i]/256.f);
    if(roomAt&&uint32_t(now-roomAt)<2000&&std::equal(cell,cell+3,roomCell))return roomBand;
    constexpr float dirs[9][3]={{0,0,1},{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{.57735f,.57735f,.57735f},{-.57735f,.57735f,.57735f},{.57735f,-.57735f,.57735f},{-.57735f,-.57735f,.57735f}};
    float distances[9];for(int i=0;i<9;++i){float end[3];for(int j=0;j<3;++j)end[j]=eye[j]+dirs[i][j]*2000;L4P_TraceV1 hit{sizeof(hit)};distances[i]=effects.trace(token,eye,end,0x0200400Bu,0,&me,&hit)?2000.f:hit.fraction*2000;}
    std::sort(distances,distances+9);float average=0;for(int i=2;i<=6;++i)average+=distances[i];average/=5;
    roomBand=average<100?0:average<300?1:average<500?2:3;std::copy(cell,cell+3,roomCell);roomAt=now;return roomBand;
}
bool paused(){char owner[65]{};return !resource.owner("skeeto.hud.pause-sampling",owner)&&owner[0];}
void on_shot(const json& c,const L4P_EntityRefV1& me,const L4P_EntityRefV1& wep,int kind,int clip,uint32_t now){using namespace flare_weapon;
    if(c["empty"].get<bool>()&&clip==0)cue(kind==TW_Pistol||kind==TW_Magnum?"emsc/dryfire_pistol.mp3":kind>=TW_Smg&&kind<=TW_Mp5?"emsc/dryfire_smg.mp3":"emsc/dryfire_rifle.mp3",now);
    else if(c["low-ammo"].get<bool>()&&clip>0){int capacity=TeamHudGunMaxClipKind(kind);weapons.clip_capacity(localToken,&wep,&capacity);uint8_t dual=0;if(kind==TW_Pistol&&!entities.read(&wep,"m_hasDualWeapons",L4P_FIELD_BYTE,&dual)&&dual)capacity*=2;
        if(capacity>0&&clip<=std::max(3,(capacity*20+99)/100))cue("lasc/click.mp3",now);}
    if(c["shell"].get<bool>()){int shell=1;uint32_t delay=400;if(kind==TW_Pistol||kind==TW_Magnum||(kind>=TW_Smg&&kind<=TW_Mp5))shell=0;
        if(kind>=TW_Pump&&kind<=TW_Spas){shell=2;if(kind==TW_Pump||kind==TW_Chrome)delay=750;}if(kind==TW_Scout||kind==TW_Awp)delay=1000;
        const char* stems[]={"pistol_shell","shell","shotgun_shell"};queue(1,std::string("sis/")+stems[shell]+std::to_string((now/17)%5+1)+".mp3",delay,now);}
    if(reverb&&!paused()){int band=room(me,now);if(band>=0)emit((std::string("skeeto/reverb/room")+std::to_string(band+1)+".wav").c_str(),.85f);}
}
void clips(const json& c,const L4P_SourceFrameV1* f,const L4P_EntityRefV1& me){auto now=f->time_ms;if(clipAt){auto elapsed=uint32_t(now-clipAt);if(elapsed<8)return;if(elapsed>250){lastWeapon={};lastClip=-1;reloadSuppress=false;}}clipAt=now;
    L4P_EntityRefV1 wep{};int kind=0,clip=-1;if(!weapon(me,wep,kind,true)||entities.read(&wep,"m_iClip1",L4P_FIELD_INT,&clip)||clip<0){lastWeapon={};lastClip=-1;return;}
    if(lastWeapon.handle!=wep.handle||lastWeapon.epoch!=wep.epoch){lastWeapon=wep;lastClip=clip;reloadSuppress=false;return;}
    uint8_t reload=0;entities.read(&wep,"m_bInReload",L4P_FIELD_BYTE,&reload);bool shotgun=kind>=flare_weapon::TW_Pump&&kind<=flare_weapon::TW_Spas;
    if(reload&&!shotgun)reloadSuppress=true;
    if(lastClip>=0&&clip<lastClip){int drop=lastClip-clip;bool reloadLike=drop>1||(!shotgun&&(reload||reloadSuppress));if(!reloadLike&&drop==1)on_shot(c,me,wep,kind,clip,now);else if(drop>1||reload)reloadSuppress=true;}
    if(reloadSuppress&&(clip>lastClip||(!reload&&clip>0&&lastClip<=0)))reloadSuppress=false;lastClip=clip;
}
void magazine(const L4P_SourceFrameV1* f){L4P_EntityRefV1 me{},wep{};int kind=0;if(!local_player(f,me)||!weapon(me,wep,kind))return;using namespace flare_weapon;
    struct Spec{int kind;const char* path;int count;uint32_t delay;};constexpr Spec specs[]={
        {TW_Pistol,"handguns/generic_mag",8,500},{TW_Magnum,"handguns/deagle_mag",5,500},{TW_Smg,"sub_machineguns/uzi_mag",5,500},{TW_SmgS,"sub_machineguns/mac_mag",5,540},{TW_Mp5,"sub_machineguns/mp5_mag",5,1300},
        {TW_Ak,"assault_rifles/ak_mag",5,500},{TW_M16,"assault_rifles/m16_mag",5,500},{TW_Scar,"assault_rifles/scar_mag",5,600},{TW_Sg,"assault_rifles/sg552_mag",5,500},
        {TW_Hunt,"sniper_rifles/mini14_mag",5,1000},{TW_Mil,"sniper_rifles/g3sg_mag",5,1400},{TW_Scout,"sniper_rifles/scout_mag",5,700},{TW_Awp,"sniper_rifles/awp_mag",5,800},{TW_GL,"grenade_launcher/m79_shell",4,800},{TW_M60,"light_machinegun/m60_box",5,900}};
    for(auto& s:specs)if(s.kind==kind){queue(2,std::string("weapons/spent_mags/")+s.path+std::to_string((f->time_ms/17)%s.count+1)+".wav",s.delay,f->time_ms);break;}
}
void ladder(const L4P_EntityRefV1& me,uint32_t now){if(ladderAt&&int32_t(now-ladderAt)<0)return;ladderAt=now+500;uint8_t movement=0;float velocity[3]{};
    if(entity.move_type(&me,&movement)||movement!=9||entities.read(&me,"m_vecVelocity[0]",L4P_FIELD_VECTOR,velocity))return;
    if(velocity[0]*velocity[0]+velocity[1]*velocity[1]+velocity[2]*velocity[2]<=25)return;emit((std::string("player/footsteps/survivor/run/ladder")+std::to_string(step++%4+1)+".wav").c_str());
}
uint32_t pin(const char* name,bool wanted,float value){if(!wanted){cvar.release(token,name);cvar.release(localToken,name);return 0;}auto code=cvar.pin(token,name,value);return code==L4P_CVAR_SCOPE?cvar.pin(localToken,name,value):code;}
void reverb_lease(bool wanted){reverb=false;reverbCode=0;if(!wanted){resource.release(token,"skeeto.gun-reverb");return;}char owner[65]{};
    auto code=resource.owner("skeeto.audio-processing",owner);if(code||(*owner&&strcmp(owner,"skeeto.gunshot-feel"))){reverbCode=code?code:L4P_CVAR_CONFLICT;resource.release(token,"skeeto.gun-reverb");return;}
    reverbCode=resource.claim(token,"skeeto.gun-reverb");reverb=!reverbCode;
}
}
bool feature_create(HMODULE module){
    auto e=reinterpret_cast<L4P_GetEntityApiFn>(GetProcAddress(module,"L4P_GetEntityApi"));auto a=reinterpret_cast<L4P_GetAudioApiFn>(GetProcAddress(module,"L4P_GetAudioApi"));auto w=reinterpret_cast<L4P_GetWeaponApiFn>(GetProcAddress(module,"L4P_GetWeaponApi"));
    auto d=reinterpret_cast<L4P_GetDrawApiFn>(GetProcAddress(module,"L4P_GetDrawApi"));auto v=reinterpret_cast<L4P_GetViewApiFn>(GetProcAddress(module,"L4P_GetViewApi"));auto c=reinterpret_cast<L4P_GetCvarApiFn>(GetProcAddress(module,"L4P_GetCvarApi"));
    auto f=reinterpret_cast<L4P_GetFileApiFn>(GetProcAddress(module,"L4P_GetFileApi"));auto x=reinterpret_cast<L4P_GetEffectsApiFn>(GetProcAddress(module,"L4P_GetEffectsApi"));auto r=reinterpret_cast<L4P_GetResourceApiFn>(GetProcAddress(module,"L4P_GetResourceApi"));
    if(!e||!a||!w||!d||!v||!c||!f||!x||!r||e(3,&entities)||a(1,&audio)||w(1,&weapons)||d(1,&draw)||v(1,&view)||c(1,&cvar)||f(2,&files.base)||x(1,&effects)||r(1,&resource))return false;
    reset_samples();previous=json();running=false;rotation=step=cvarAt=0;audioCode=mountCode=rollCode=scorchCode=reverbCode=0;failedSample.clear();return !source.subscribe("skeeto.script-cues.local",L4P_SOURCE_LOCAL,"",nullptr,noop,nullptr,&localToken);
}
void feature_end(){release();if(localToken){source.unsubscribe(localToken);localToken=0;}}
void feature_event(const json& c,const L4P_SourceFrameV1* f,const char* name,void* event){
    if(!strcmp(name,"game_newmap")||!strcmp(name,"server_spawn")||!strcmp(name,"round_start")){reset_samples();audio.stop_all(token);return;}
    if(!c["active"].get<bool>())return;
    if(!strcmp(name,"bot_player_replace")||!strcmp(name,"player_bot_replace")){if(f->local_user>0&&(source.event_int(event,"player",0)==f->local_user||source.event_int(event,"bot",0)==f->local_user)){fade={};hadHealth=false;}return;}
    const int uid=source.event_int(event,"userid",0);if(f->local_user>0&&uid>0&&uid!=f->local_user)return;
    if(!strcmp(name,"weapon_reload")){if(c["magazine"].get<bool>())magazine(f);return;}
    if(c["heal"].get<bool>())fade={2,f->time_ms,500,35};
}
void feature_tick(const json& c,const L4P_SourceFrameV1* f,bool changed){
    if(!c["active"].get<bool>()||!source.allowed(f,kScope)){if(running)release();feature_state(c["active"].get<bool>()?"等待对局":"已关闭");previous=c;return;}running=true;
    if(changed){audioCode=0;failedSample.clear();if(previous.is_null()||previous["low-health"]!=c["low-health"]){healthAt=0;armed39=armed72=true;hadHealth=false;if(fade.kind==1)fade={};}previous=c;}
    bool needAssets=c["empty"].get<bool>()||c["low-ammo"].get<bool>()||c["shell"].get<bool>()||c["magazine"].get<bool>()||c["reverb"].get<bool>();
    if(needAssets)mountCode=files.mount_assets(token);else{files.unmount_assets(token);mountCode=0;}
    reverb_lease(c["reverb"].get<bool>());
    if(changed||!cvarAt||int32_t(f->time_ms-cvarAt)>=0){rollCode=pin("survivor_incapacitated_roll",c["incap-roll"].get<bool>(),-38);scorchCode=pin("inferno_scorch_decals",c["scorch"].get<bool>(),1);cvarAt=f->time_ms+250;}
    delayed_pump(c,f->time_ms);L4P_EntityRefV1 me{};bool alive=local_player(f,me);
    if(alive&&c["low-health"].get<bool>())health(f,me);
    bool wantClips=c["empty"].get<bool>()||c["low-ammo"].get<bool>()||c["shell"].get<bool>()||reverb;
    if(wantClips!=clipsOn||!alive){clipAt=0;lastWeapon={};lastClip=-1;reloadSuppress=false;}clipsOn=wantClips;
    if(wantClips&&alive)clips(c,f,me);if(alive&&c["ladder"].get<bool>()&&!paused())ladder(me,f->time_ms);
    paint_fade(c,f->time_ms);
    if(mountCode)feature_state("提示素材目录暂不可用",mountCode);
    else if(audioCode)feature_state((std::string("声音暂不可用：")+failedSample).c_str(),audioCode);
    else if(reverbCode)feature_state("房间混响等待音频处理控制权",reverbCode);
    else if(rollCode||scorchCode)feature_state("部分视觉参数等待允许环境或游戏参数",rollCode?rollCode:scorchCode);
    else feature_state("按所选功能提示生命、射击与环境状态");
}
