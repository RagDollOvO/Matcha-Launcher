// GPL-3.0. GunFeel and local clip detector from Skeeto 2.2.19.
#define NOMINMAX
#include <windows.h>
#include "l4p_audio.h"
#include "l4p_sound.h"
#include "l4p_resource.h"
#include "definition.hpp"
#include "classifier.hpp"
#include "weapons.hpp"
#include <array>
#include <atomic>
static constexpr char kId[]="skeeto.gunshot-feel",kVersion[]="0.1.0",kTitle[]="枪声听感增强",kSummary[]="保留原版开火声，叠加可调音高和强度的枪声";
static constexpr uint32_t kScope=L4P_SOURCE_ANY;
static constexpr char kEvents[]="game_newmap,server_spawn";
#include "feature_plugin.inc"
namespace {
L4P_EntityApiV1 entities{1,sizeof(entities)};L4P_AudioApiV1 audio{1,sizeof(audio)};
L4P_SoundApiV1 sound{1,sizeof(sound)};L4P_ResourceApiV1 resource{1,sizeof(resource)};
std::array<std::atomic<char>,160> noted{};std::atomic<uint32_t> noteSeq{0},noteAt{0};
bool listening=false,reloadSuppress=false;uint32_t sampleAt=0,waitSince=0,waitUntil=0,tailAt=0;L4P_EntityRefV1 lastWeapon{};int lastClip=-1;
char tail[160]{};float tailVolume=0;unsigned rotation=0;uint32_t emittedCode=L4P_OK;
constexpr char audioGroup[]="skeeto.audio-processing";
constexpr char fallback[]="weapons/rifle/gunfire/rifle_fire_1.wav";
float L4P_CALL note(void*,const char* name,float volume){
    auto clean=NormalizeSoundSample(name);if(!*clean||SoundPathStartsWith(clean,"skeeto/")||ClassifySoundVolumeSample(clean)!=SoundVolumeGroup::Gunfire)return volume;
    const auto seq=noteSeq.load(std::memory_order_relaxed);noteSeq.store(seq+1,std::memory_order_release);
    size_t i=0;for(;i+1<noted.size()&&clean[i];++i)noted[i].store(SoundPathLower(clean[i]),std::memory_order_relaxed);noted[i].store(0,std::memory_order_relaxed);
    noteAt.store(GetTickCount(),std::memory_order_relaxed);noteSeq.store(seq+2,std::memory_order_release);return volume;
}
bool copy_note(char (&out)[160],uint32_t& at){
    for(int attempt=0;attempt<2;++attempt){auto first=noteSeq.load(std::memory_order_acquire);if(first&1)continue;
        at=noteAt.load(std::memory_order_relaxed);for(size_t i=0;i<noted.size();++i)out[i]=noted[i].load(std::memory_order_relaxed);out[159]=0;
        auto last=noteSeq.load(std::memory_order_acquire);if(first==last&&out[0]&&at)return true;}out[0]=0;return false;
}
void reset(){sampleAt=waitSince=waitUntil=tailAt=0;lastWeapon={};lastClip=-1;reloadSuppress=false;tail[0]=0;noteAt=0;}
void stop(){if(listening){sound.clear_filter(token);listening=false;}audio.stop_all(token);reset();resource.release(token,nullptr);}
void emit(const char* sample,float volume,int pitch){
    L4P_AudioEmitV1 input{sizeof(input)};input.slot=rotation++&7;input.sample=sample;input.volume=volume;input.pitch=pitch;int guid=-1;emittedCode=audio.emit(token,&input,&guid);
}
void layer(const json& config,const char* sample,uint32_t now){
    int preset=config["preset"].get<int>();static const int pitch[]={168,45,78,210};float gain=config["gain"].get<int>()/100.f;
    char reverbOwner[65]{};if(resource.owner("skeeto.gun-reverb",reverbOwner)==L4P_OK&&reverbOwner[0])gain*=.75f;
    emit(sample,gain,pitch[preset]);if(preset==2){strncpy(tail,sample,159);tail[159]=0;tailVolume=gain*.55f;tailAt=now+90;}
}
void shot(const json& config,uint32_t now){char name[160]{};uint32_t at=0;
    if(copy_note(name,at)&&int32_t(now-at)>=0&&uint32_t(now-at)<=120){waitUntil=0;layer(config,name,now);}else{waitSince=now;waitUntil=now+120;}
}
void pump(const json& config,uint32_t now){
    if(tailAt&&int32_t(now-tailAt)>=0){tailAt=0;if(tail[0]&&tailVolume>0)emit(tail,tailVolume,58);tail[0]=0;}
    if(!waitUntil)return;char name[160]{};uint32_t at=0;
    if(copy_note(name,at)&&int32_t(at-waitSince)>=0&&int32_t(now-at)>=0&&uint32_t(now-at)<=120){waitUntil=0;layer(config,name,now);}
    else if(int32_t(now-waitUntil)>=0){waitUntil=0;layer(config,fallback,now);}
}
bool hunt_model(const L4P_EntityRefV1& ref){char model[260]{};uint32_t size=0;if(entities.model_name(&ref,model,sizeof(model),&size)!=L4P_OK)return false;
    using flare_weapon::TeamHudCnIHas;return TeamHudCnIHas(model,"huntingrifle")||TeamHudCnIHas(model,"hunting_rifle")||TeamHudCnIHas(model,"sniper_hunting")||TeamHudCnIHas(model,"mini14")||TeamHudCnIHas(model,"w_sniper_mini");}
}
bool feature_create(HMODULE module){
    auto ge=reinterpret_cast<L4P_GetEntityApiFn>(GetProcAddress(module,"L4P_GetEntityApi"));auto ga=reinterpret_cast<L4P_GetAudioApiFn>(GetProcAddress(module,"L4P_GetAudioApi"));
    auto gs=reinterpret_cast<L4P_GetSoundApiFn>(GetProcAddress(module,"L4P_GetSoundApi"));auto gr=reinterpret_cast<L4P_GetResourceApiFn>(GetProcAddress(module,"L4P_GetResourceApi"));
    if(!ge||!ga||!gs||!gr||ge(1,&entities)||ga(1,&audio)||gs(1,&sound)||gr(1,&resource))return false;reset();listening=false;rotation=0;return true;
}
void feature_end(){stop();}
void feature_event(const json&,const L4P_SourceFrameV1*,const char*,void*){reset();}
void feature_tick(const json& config,const L4P_SourceFrameV1* f,bool changed){
    if(changed){audio.stop_all(token);reset();}
    if(!config["active"].get<bool>()||config["gain"].get<int>()==0){stop();feature_state("已关闭");return;}
    if(!source.allowed(f,kScope)){stop();feature_state("等待进入对局",L4P_ENTITY_SCOPE);return;}
    auto result=resource.claim(token,audioGroup);if(result!=L4P_OK){stop();feature_state("听声辨位正在管理声音处理，关闭后可接续",result);return;}
    if(!listening){result=sound.set_filter(token,nullptr,note);if(result!=L4P_OK){feature_state("等待声音入口",result);return;}listening=true;}
    emittedCode=L4P_OK;pump(config,f->time_ms);
    if(sampleAt){uint32_t elapsed=f->time_ms-sampleAt;if(elapsed<8)return;if(elapsed>250){lastWeapon={};lastClip=-1;reloadSuppress=false;}}sampleAt=f->time_ms;
    L4P_EntityRefV1 me{},weapon{};uint32_t handle=0;
    if(entities.reference(f->local_player,&me)!=L4P_OK||entities.read(&me,"m_hActiveWeapon",L4P_FIELD_INT,&handle)!=L4P_OK||entities.from_handle(handle,&weapon)!=L4P_OK){lastWeapon={};lastClip=-1;feature_state("等待持枪状态");return;}
    L4P_EntityInfoV1 info{sizeof(info)};if(entities.describe(&weapon,&info)!=L4P_OK)return;const char* cn=info.class_name;
    if(strstr(cn,"minigun")||strstr(cn,"Minigun")||strstr(cn,"mounted")||strstr(cn,"chainsaw")||strstr(cn,"Chainsaw")||strstr(cn,"grenade_launcher")||strstr(cn,"GrenadeLauncher")){lastWeapon={};lastClip=-1;return;}
    using namespace flare_weapon;int kind=TeamHudWepKind(cn);
    if(kind==TW_M16||kind==TW_None){if(hunt_model(weapon))kind=TW_Hunt;else{uint32_t viewHandle=0;L4P_EntityRefV1 view{};if(entities.read(&me,"m_hViewModel[0]",L4P_FIELD_INT,&viewHandle)==L4P_OK&&entities.from_handle(viewHandle,&view)==L4P_OK&&hunt_model(view))kind=TW_Hunt;}}
    if(kind<TW_Pistol||kind>TW_GL){lastWeapon={};lastClip=-1;return;}
    int clip=-1;if(entities.read(&weapon,"m_iClip1",L4P_FIELD_INT,&clip)!=L4P_OK||clip<0||clip>255){lastWeapon={};lastClip=-1;return;}
    if(lastWeapon.handle!=weapon.handle||lastWeapon.epoch!=weapon.epoch){lastWeapon=weapon;lastClip=clip;reloadSuppress=false;return;}
    uint8_t reloading=0;entities.read(&weapon,"m_bInReload",L4P_FIELD_BYTE,&reloading);bool shotgun=kind==TW_Pump||kind==TW_Chrome||kind==TW_Auto||kind==TW_Spas;
    if(reloading&&!shotgun)reloadSuppress=true;
    if(lastClip>=0&&clip<lastClip){int drop=lastClip-clip;bool reloadLike=drop>1||(!shotgun&&(reloading||reloadSuppress));
        if(!reloadLike&&drop==1)shot(config,f->time_ms);else if(drop>1||reloading)reloadSuppress=true;}
    if(reloadSuppress&&clip>lastClip)reloadSuppress=false;if(reloadSuppress&&!reloading&&clip>0&&lastClip<=0)reloadSuppress=false;lastClip=clip;
    L4P_SoundStatusV1 status{sizeof(status)};sound.status(&status);
    feature_state(emittedCode!=L4P_OK?"叠层播放失败":status.state>=3?"声音路径识别不可用，采用原作后备枪声":"正在监听本地开火",emittedCode!=L4P_OK?emittedCode:L4P_OK);
}
