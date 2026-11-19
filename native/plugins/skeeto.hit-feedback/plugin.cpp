// GPL-3.0. Skeeto 2.2.19 feedback, independently owned through the Flare SDK.
#define NOMINMAX
#include "l4p_feedback.h"
#include "l4p_particle.h"
#include "l4p_audio.h"
#include "l4p_effects.h"
#include "l4p_view.h"
#include "l4p_resource.h"
#include "style_catalog.hpp"
#include "feature_config.hpp"
#include "definition.hpp"
#include <atomic>
#include <mutex>
#include <array>
#include <set>
#include <deque>
using nlohmann::json;namespace fs=std::filesystem;
namespace {
constexpr char kId[]="skeeto.hit-feedback";
L4P_SourceApiV2 source2{{2,sizeof(source2)}};auto& source=source2.base;
L4P_EntityApiV1 entity{1,sizeof(entity)};L4P_FeedbackApiV1 feedback{1,sizeof(feedback)};L4P_ParticleApiV1 particles{1,sizeof(particles)};
L4P_FileApiV3 files{{{3,sizeof(files)}}};L4P_AudioApiV1 audio{1,sizeof(audio)};L4P_EffectsApiV1 effects{1,sizeof(effects)};
L4P_ViewApiV1 view{1,sizeof(view)};L4P_ResourceApiV1 resource{1,sizeof(resource)};
std::recursive_mutex mutex;std::atomic<bool> ready{false};json settings,fields;fs::path configFile;std::string gameDir;
uint32_t token=0,now=0,armedAt=0,lastFx=0,suppressCi=0,ciPending=0,traceAt=0,catalogAt=0,meleeUntil=0,meleeKillAt=0;
uint32_t splatDue=0,splatCooldown=0,overlayUntil=0,overlayStart=0,overlayStep=0;int meleeKillUser=0,ciStreak=0,siStreak=0,overlayIndex=0;
uint32_t ciStreakAt=0,siStreakAt=0,code=0,played=0;unsigned audioSlot=0;bool running=false,paused=false,mouseBefore=false,haveImpact=false,tracePending=false,recovery=false,reloadCatalog=false,warm=true,bootPlatform=false,bootHeld=false;
uint32_t bootLimit=32;L4P_EntityRefV1 lastWeapon{};int weaponKind=0;float impact[3]{},tracePoint[3]{};int checkpointTank=-1,checkpointWitch=-1,mountState=-1;
std::deque<uint32_t> gunTimes;std::array<uint32_t,65> airAt{},chargeUntil{};
struct Witch{L4P_EntityRefV1 ref{};float pos[3]{};bool have=false;};std::array<Witch,8> witches{};size_t witchCursor=0;L4P_EntityRefV1 witchTarget{},tankTarget{};
std::vector<std::string> overlays;
struct Job{DlcFx fx{};bool kill=false,throttle=false,special=false;uint32_t duration=110;float pos[3]{};std::string name;};std::vector<Job> jobs;
struct Friendly{int user,attacker,damage;uint32_t at;};std::vector<Friendly> friendly;
bool opt(const char* key){return settings[key].get<bool>();}
int integer(const char* key){return settings[key].get<int>();}
bool elapsed(uint32_t at){return !at||int32_t(now-at)>=0;}
bool same(const L4P_EntityRefV1& a,const L4P_EntityRefV1& b){return a.handle==b.handle&&a.epoch==b.epoch&&a.index==b.index;}
bool ref(int index,L4P_EntityRefV1& out){return index>0&&index<2048&&!entity.reference(index,&out);}
int value(const L4P_EntityRefV1& r,const char* field,int fallback=0){int v=fallback;entity.read(&r,field,L4P_FIELD_INT,&v);return v;}
int byte(const L4P_EntityRefV1& r,const char* field,int fallback=0){uint8_t v=uint8_t(fallback);entity.read(&r,field,L4P_FIELD_BYTE,&v);return v;}
bool position(const L4P_EntityRefV1& r,float out[3]){return !entity.read(&r,"m_vecOrigin",L4P_FIELD_VECTOR,out);}
bool local(const L4P_SourceFrameV1* f,L4P_EntityRefV1& me){return ref(f->local_player,me)&&value(me,"m_iTeamNum")==2&&!byte(me,"m_lifeState",1)&&!value(me,"m_iObserverMode");}
std::string text(void* event,const char* key){char out[256]{};uint32_t size=0;source2.event_text(event,key,out,sizeof(out),&size);return out;}
int number(void* event,const char* key){return source.event_int(event,key,0);}
bool attacker(void* event,const L4P_SourceFrameV1* f){int uid=number(event,"attacker"),idx=number(event,"attackerentid");if(uid>0&&uid==f->local_user)return true;
    L4P_EntityRefV1 r{};return (idx>0&&idx==f->local_player)||(uid>0&&!entity.for_user(uid,&r)&&int(r.index)==f->local_player);}
int weapon(const L4P_EntityRefV1& me){uint32_t handle=uint32_t(value(me,"m_hActiveWeapon"));L4P_EntityRefV1 r{};if(entity.from_handle(handle,&r))return 0;
    if(!same(r,lastWeapon)){lastWeapon=r;meleeUntil=0;L4P_EntityInfoV1 info{sizeof(info)};entity.describe(&r,&info);weaponKind=strstr(info.class_name,"Chainsaw")?2:strstr(info.class_name,"Melee")?1:0;}return weaponKind;}
bool melee_name(const std::string& w){if(w.find("melee")!=w.npos||w.find("Melee")!=w.npos)return true;
    for(auto name:{"chainsaw","weapon_chainsaw","katana","fireaxe","machete","crowbar","cricket_bat","baseball_bat","electric_guitar","frying_pan","golfclub","pitchfork","shovel","tonfa","knife","riotshield","guitar","pan","bat"})if(!_stricmp(w.c_str(),name))return true;return false;}
bool melee_event(void* event,const L4P_SourceFrameV1* f){int uid=number(event,"attacker");if(!uid)uid=number(event,"userid");if(meleeKillAt&&uint32_t(now-meleeKillAt)<250&&uid==meleeKillUser)return true;
    auto w=text(event,"weapon");if(!w.empty())return melee_name(w);L4P_EntityRefV1 me{};return local(f,me)&&weapon(me);}
bool channel(const char* c){return DlcGetSelected(c)[0]!=0;}
void sound(const char* path,float volume=1){L4P_AudioEmitV1 request{sizeof(request)};request.slot=audioSlot++%8;request.sample=path;request.volume=volume;request.pitch=100;int32_t guid=-1;auto result=audio.emit(token,&request,&guid);if(result)code=result;}
void clear_overlay(){if(overlayUntil)feedback.overlay(token,"");overlayUntil=overlayStart=overlayStep=0;overlayIndex=0;overlays.clear();}
void overlay(const DlcFx& fx,uint32_t duration){if(!opt("icon")||(!fx.overlay[0]&&!fx.overlaySequenceCount))return;
    overlays.clear();overlayIndex=0;overlayStart=now;overlayStep=0;const char* first=fx.overlay;
    if(fx.overlaySequenceCount){int count=std::min(fx.overlaySequenceCount,int(kDlcMaxOverlaySequence));for(int i=0;i<count;++i)overlays.emplace_back(fx.overlaySequence[i]);first=overlays.front().c_str();
        overlayStep=std::min(5000u/uint32_t(count),std::clamp(fx.overlayStepMs>0?uint32_t(fx.overlayStepMs):40u,16u,1000u));}
    if(!*first){overlays.clear();return;}auto result=feedback.overlay(token,first);if(result){code=result;return;}
    duration=fx.overlayMs>0?uint32_t(fx.overlayMs):duration;duration=std::max(duration,overlayStep*uint32_t(overlays.size()));overlayUntil=now+std::clamp(duration,40u,5000u);
}
void particle(const char* name,const float pos[3],bool world){if(!*name)return;auto result=particles.dispatch(token,name,pos,world);if(result)code=result;}
void play(const Job& job,bool media=true){if(job.throttle&&uint32_t(now-lastFx)<70)return;if(!job.special&&!opt("sound")&&!opt("icon"))return;
    const auto& fx=job.fx;if(!job.special)lastFx=now;
    if(media)overlay(fx,job.duration);
    if(job.special){if(!job.name.empty())particle(job.name.c_str(),job.pos,true);for(int i=0;i<fx.particleExtraCount;++i)particle(fx.particleExtra[i],job.pos,true);}
    else if(opt("icon")){particle(fx.particle,job.pos,fx.worldSpace);for(int i=0;i<fx.particleExtraCount;++i)particle(fx.particleExtra[i],job.pos,fx.worldSpace);}
    char sample[96]{};if(media&&opt("sound")&&DlcPickSound(&fx,sample,sizeof(sample)))sound(sample,integer("volume")/100.f);++played;
}
void queue(const DlcFx& fx,const float pos[3],bool kill,bool throttle,uint32_t duration){if(!fx.used||jobs.size()>=24)return;Job job{};job.fx=fx;std::copy(pos,pos+3,job.pos);job.kill=kill;job.throttle=throttle;job.duration=duration;jobs.push_back(std::move(job));}
void special(const char* name,const float pos[3]){if(!opt("special-kill")||jobs.size()>=24)return;Job j{};j.special=true;j.duration=260;j.name=name;std::copy(pos,pos+3,j.pos);
    if(DlcResolveNamed("fx",name,&j.fx))j.name=j.fx.particle;jobs.push_back(std::move(j));}
void blood(){if(!opt("blood-splat")||!opt("sound")||!elapsed(splatDue)||!elapsed(splatCooldown))return;splatDue=now+200+(now&127);splatCooldown=now+250;}
void streak(const char* c,int& count,uint32_t& at){int window=std::stoi(settings["streak-window"].get<std::string>());if(!window){if(count<1000000)++count;at=0;return;}
    const auto* style=DlcFindStyle(DlcGetSelected(c));int max=0;if(style&&style->streakEnabled){int limit=style->streakWrap>0?std::min(10,style->streakWrap):10;for(int i=limit;i>=1;--i)if(style->streakSlot[i]){max=i;break;}}
    if(!max){count=0;at=0;return;}count=at&&uint32_t(now-at)<uint32_t(window*1000)?std::min(count+1,max):1;at=now;
}
void common_fx(bool hit,bool hs,bool melee,const float pos[3],bool boss=false){if(!channel("ci")||(!opt("sound")&&!opt("icon"))||(hit&&!boss&&integer("hit-mode")!=2))return;
    if(hit&&uint32_t(now-lastFx)<70)return;if(!hit)streak("ci",ciStreak,ciStreakAt);blood();DlcFx fx{};
    if(DlcResolve("ci",hit?"hit":"kill",hs,melee&&!hit&&!hs,hit?0:ciStreak,&fx))queue(fx,pos,!hit,hit,hit?110:240);
}
void si_fx(bool hit,bool hs,bool melee,const float pos[3]){if(!channel("si")||(hit&&!integer("hit-mode"))||(!opt("sound")&&!opt("icon")))return;
    if(hit&&uint32_t(now-lastFx)<70)return;blood();if(!hit)streak("si",siStreak,siStreakAt);
    DlcFx si{},ci{},out{};bool hasSi=(opt("si-visual")||opt("si-sound"))&&DlcResolve("si",hit?"hit":"kill",hs,melee,hit?0:siStreak,&si);
    bool hasCi=(!opt("si-visual")||!opt("si-sound"))&&channel("ci")&&DlcResolve("ci",hit?"hit":"kill",hs,melee&&!hs,0,&ci);
    const DlcFx* visual=opt("si-visual")?(hasSi?&si:nullptr):(hasCi?&ci:nullptr);const DlcFx* snd=opt("si-sound")?(hasSi?&si:nullptr):(hasCi?&ci:nullptr);
    if(visual)out=*visual;bool hasVisual=out.overlay[0]||out.overlaySequenceCount||out.particle[0]||out.particleExtraCount;if(!hasVisual&&snd)out.priority=snd->priority;
    out.sound[0]=0;out.soundExtraCount=0;if(snd){memcpy(out.sound,snd->sound,sizeof(out.sound));memcpy(out.soundExtra,snd->soundExtra,sizeof(out.soundExtra));out.soundExtraCount=snd->soundExtraCount;}
    out.used=hasVisual||out.sound[0]||out.soundExtraCount;if(out.used)queue(out,pos,!hit,hit,hit?110:240);
}
bool leap(const L4P_EntityRefV1& r){uint32_t h=uint32_t(value(r,"m_customAbility"));L4P_EntityRefV1 a{};return (!entity.from_handle(h,&a)&&byte(a,"m_isLunging"))||byte(r,"m_isAttemptingToPounce");}
bool airborne(const L4P_EntityRefV1& r,bool jockey){if(!r.index||r.index>64)return false;bool recent=airAt[r.index]&&uint32_t(now-airAt[r.index])<=250;int flags=value(r,"m_fFlags",-1);
    if(jockey)return (flags>=0&&!(flags&1))||recent;if(byte(r,"m_lifeState",1))return leap(r)||recent;if(flags<0)return recent;return !(flags&1)&&(leap(r)||recent);
}
void remember_witch(const L4P_EntityRefV1& r){Witch* target=nullptr;for(auto& w:witches)if(same(w.ref,r)){target=&w;break;}if(!target)target=&witches[witchCursor++%8];target->ref=r;target->have=position(r,target->pos);}
void reset(){jobs.clear();friendly.clear();gunTimes.clear();tracePending=false;ciPending=0;haveImpact=false;meleeUntil=lastFx=suppressCi=splatDue=splatCooldown=0;
    ciStreak=siStreak=0;ciStreakAt=siStreakAt=0;checkpointTank=checkpointWitch=-1;tankTarget=witchTarget={};lastWeapon={};mouseBefore=false;airAt.fill(0);chargeUntil.fill(0);witches={};armedAt=now+4000;warm=true;
}
void L4P_CALL on_event(void*,const L4P_SourceFrameV1* f,const char* name,void* event){if(!ready)return;std::lock_guard<std::recursive_mutex> lock(mutex);now=f->time_ms;
    if(!strcmp(name,"game_newmap")||!strcmp(name,"server_spawn")||!strcmp(name,"round_start")){reset();return;}if(!opt("active")||paused||!source.allowed(f,0))return;
    if(!strcmp(name,"melee_kill")){meleeKillAt=now;meleeKillUser=number(event,"userid");return;}
    if(!strcmp(name,"charger_charge_start")||!strcmp(name,"charger_charge_end")){L4P_EntityRefV1 r{};int uid=number(event,"userid");if(!uid)uid=number(event,"attacker");if(!entity.for_user(uid,&r)&&r.index<=64)chargeUntil[r.index]=now+(!strcmp(name,"charger_charge_start")?8000:450);return;}
    if(!strcmp(name,"witch_spawn")){L4P_EntityRefV1 r{};if(ref(number(event,"witchid"),r))remember_witch(r);return;}
    if(!strcmp(name,"bullet_impact")){if(f->local_user<=0||number(event,"userid")!=f->local_user)return;
        for(int i=0;i<3;++i)impact[i]=source.event_float(event,i==0?"x":i==1?"y":"z",0);haveImpact=true;
        if(gunTimes.empty()||uint32_t(now-gunTimes.back())>=5){gunTimes.push_back(now);while(gunTimes.size()>64)gunTimes.pop_front();}
        if(integer("hit-mode")==2&&elapsed(armedAt)&&elapsed(suppressCi)&&!ciPending&&!tracePending){std::copy(impact,impact+3,tracePoint);tracePending=true;}return;}
    if(!strcmp(name,"player_hurt_concise")){if(opt("friendly-fire")&&friendly.size()<64){int user=number(event,"userid"),damage=number(event,"dmg_health");if(user>0&&damage>0)friendly.push_back({user,number(event,"attackerentid"),damage,now});}return;}
    if(!strcmp(name,"tongue_pull_stopped")){if(number(event,"release_type")==4&&number(event,"userid")==number(event,"victim")&&number(event,"userid")==f->local_user){L4P_EntityRefV1 r{};float pos[3]{};if(!entity.for_user(number(event,"smoker"),&r)&&position(r,pos)){pos[2]+=64;special("tongue_cut",pos);}}return;}
    if(!strcmp(name,"witch_killed")){if(number(event,"userid")!=f->local_user)return;L4P_EntityRefV1 r{};float pos[3]{};bool have=ref(number(event,"witchid"),r)&&position(r,pos);
        if(!have)for(auto& w:witches)if(int(w.ref.index)==number(event,"witchid")&&w.have){std::copy(w.pos,w.pos+3,pos);have=true;break;}
        if(have){pos[2]+=40;special(melee_event(event,f)?"melee_crown":number(event,"oneshot")?"perfect_crown":"crown",pos);}return;}
    if(strcmp(name,"infected_death")&&strcmp(name,"player_death"))return;if(!attacker(event,f))return;bool si=!strcmp(name,"player_death");auto victim=text(event,"victimname");if(si&&(victim.empty()||victim=="Infected"))return;
    bool hs=number(event,"headshot")||(si&&number(event,"hitgroup")==1),melee=melee_event(event,f);float pos[3]{};
    if(si)for(int i=0;i<3;++i)pos[i]=source.event_float(event,i==0?"victim_x":i==1?"victim_y":"victim_z",0);
    if(haveImpact&&(!si||(!pos[0]&&!pos[1]&&!pos[2])))std::copy(impact,impact+3,pos);
    ciPending=0;tracePending=false;suppressCi=now+400;if(si)si_fx(false,hs,melee,pos);else common_fx(false,hs,melee,pos);
    if(si){L4P_EntityRefV1 r{};entity.for_user(number(event,"userid"),&r);bool air=(victim=="Hunter"||victim=="Jockey")&&airborne(r,victim=="Jockey");
        if(victim=="Charger"&&melee&&r.index<=64&&chargeUntil[r.index]&&!elapsed(chargeUntil[r.index]))special("level",pos);
        else if(air)special(hs?"headshot_skeet":melee?"melee_skeet":"skeet",pos);else if(hs)special("crit_text",pos);if(r.index<=64)airAt[r.index]=0;
    }
}
void precache(){std::set<std::string> names;auto add=[&](const DlcFx& fx){if(fx.particle[0]&&names.size()<256)names.emplace(fx.particle);for(int i=0;i<fx.particleExtraCount&&names.size()<256;++i)if(fx.particleExtra[i][0])names.emplace(fx.particleExtra[i]);};
    for(auto c:{"ci","si","ff","fx"})if(auto st=DlcFindStyle(DlcGetSelected(c))){add(st->hit);add(st->kill);add(st->headshot);add(st->melee);for(auto& fx:st->streak)add(fx);for(int i=0;i<st->namedCount;++i)add(st->named[i].fx);}
    if(opt("special-kill"))for(auto name:{"skeet","melee_skeet","headshot_skeet","crown","perfect_crown","melee_crown","crit_text","level","tongue_cut"})if(names.size()<256)names.emplace(name);
    for(auto& name:names){auto result=particles.precache(token,name.c_str());if(result)code=result;}warm=false;
}
void catalog(const L4P_SourceFrameV1* f){bool menu=!f->connected&&!f->in_game&&!f->loading;
    if(f->loading||(!menu&&!f->in_game)||(!menu&&DlcStyleLimitPending())){if(recovery)DlcCatalogRecoveryCancel();recovery=false;catalogAt=0;mountState=-1;return;}
    bool sample=elapsed(catalogAt);if(sample){catalogAt=now+500;DlcRefreshFiles();DlcNoteGameSearchPath();
        if(opt("workshop-recovery")){int32_t state=-1;feedback.addon_loading(token,&state);int previous=mountState;mountState=state;
            if(previous!=0&&state==0){DlcCatalogRecoveryCancel();recovery=false;DlcAllowEngineGlobAgain();return;}}}
    if(reloadCatalog){DlcCatalogRecoveryCancel();recovery=false;DlcAllowEngineGlobAgain();DlcReloadCatalog(gameDir.c_str(),false);reloadCatalog=false;warm=true;}
    DlcEnsureCatalog(gameDir.c_str(),false);
    if(menu&&!recovery&&(!DlcEngineGlobTried()||DlcStyleLimitPending()))if(DlcEnsureCatalog(gameDir.c_str(),true))warm=true;
    if(DlcEngineGlobTried()&&!recovery){if(sample&&DlcSelectedStyleMissing()&&DlcOpenSelectedStyleFiles()>0)warm=true;return;}
    if(!recovery){if(sample&&DlcEngineCatalogReady())recovery=DlcCatalogRecoveryBegin();return;}
    if(DlcCatalogRecoveryPump()!=0){recovery=false;DlcOpenSelectedStyleFiles();warm=true;}
}
void melee_sample(const L4P_EntityRefV1& me){if(elapsed(meleeUntil))meleeUntil=0;bool down=(GetAsyncKeyState(VK_LBUTTON)&0x8000)!=0;if(!down&&!meleeUntil){mouseBefore=false;return;}
    int kind=weapon(me);L4P_ViewV1 v{sizeof(v)};if(view.snapshot(&v)||v.game_ui)meleeUntil=0;else if(down&&(kind==2||(kind==1&&!mouseBefore)))meleeUntil=now+400;mouseBefore=down;
}
bool aimed(const L4P_EntityRefV1& target,const float eye[3],const float forward[3],float max,float minDot){float pos[3]{};if(!position(target,pos))return false;float delta[3]={pos[0]-eye[0],pos[1]-eye[1],pos[2]+40-eye[2]};float len=std::sqrt(delta[0]*delta[0]+delta[1]*delta[1]+delta[2]*delta[2]);return len>=1&&len<=max&&(delta[0]*forward[0]+delta[1]*forward[1]+delta[2]*forward[2])/len>=minDot;}
void hits(const L4P_SourceFrameV1* f,const L4P_EntityRefV1& me){float eye[3]{};L4P_ViewV1 v{sizeof(v)};bool aim=!entity.eye(&me,eye)&&!view.snapshot(&v);float forward[3]{};
    if(aim){const float rad=.01745329251f;forward[0]=cosf(v.angles[0]*rad)*cosf(v.angles[1]*rad);forward[1]=cosf(v.angles[0]*rad)*sinf(v.angles[1]*rad);forward[2]=-sinf(v.angles[0]*rad);}
    L4P_HealthDropV1 drop{sizeof(drop)};uint32_t available=0;
    while(!feedback.next_health(token,&drop,&available)&&available){if(!elapsed(armedAt)||!aim)continue;bool gun=false;for(auto t:gunTimes)if(uint32_t(drop.time_ms-t)<180){gun=true;break;}
        bool melee=meleeUntil&&int32_t(meleeUntil-drop.time_ms)>=0&&uint32_t(meleeUntil-drop.time_ms)<=400;if(!gun&&!melee)continue;
        if(!aimed(drop.target,eye,forward,gun?5000.f:110.f,gun?.93f:.90f))continue;int zc=value(drop.target,"m_zombieClass");
        if((zc==3||zc==5)&&drop.target.index<=64)airAt[drop.target.index]=!(value(drop.target,"m_fFlags",1)&1)&&(zc==5||leap(drop.target))?now:0;
        if(zc==8&&value(me,"m_checkpointDamageToTank",-1)>=0)continue;float pos[3]{};if(position(drop.target,pos)){pos[2]+=40;si_fx(true,false,false,pos);}
    }
    if(tracePending&&elapsed(traceAt)){tracePending=false;traceAt=now+40;if(aim){float end[3],length=0;for(int i=0;i<3;++i)length+=(tracePoint[i]-eye[i])*(tracePoint[i]-eye[i]);
        if(length>=1){length=2/std::sqrt(length);for(int i=0;i<3;++i)end[i]=tracePoint[i]+(tracePoint[i]-eye[i])*length;L4P_TraceV1 hit{sizeof(hit)};
            if(!effects.trace(token,eye,end,L4P_TRACE_SHOT,0,&me,&hit)&&hit.hit.index){L4P_EntityInfoV1 info{sizeof(info)};entity.describe(&hit.hit,&info);bool witch=!_stricmp(info.class_name,"Witch")||!_stricmp(info.class_name,"C_Witch");
                if(witch){witchTarget=hit.hit;remember_witch(hit.hit);}if((witch&&value(me,"m_checkpointDamageToWitch",-1)<0)||!_stricmp(info.class_name,"Infected")||!_stricmp(info.class_name,"C_Infected"))ciPending=now+45;
            }
        }}}
    if(ciPending&&elapsed(ciPending)){ciPending=0;if(elapsed(suppressCi))common_fx(true,false,false,impact);}
    for(auto& ff:friendly){L4P_EntityRefV1 victim{};if(uint32_t(now-ff.at)>5000||ff.attacker!=f->local_player||entity.for_user(ff.user,&victim)||int(victim.index)==f->local_player||value(victim,"m_iTeamNum")!=2)continue;
        DlcFx fx{};if(DlcResolve("ff",ff.damage>=15?"kill":"hit",false,false,0,&fx)){float pos[3]{};position(victim,pos);pos[2]+=40;queue(fx,pos,false,true,ff.damage>=15?240:110);}}friendly.clear();
}
void bosses(const L4P_EntityRefV1& me){int tank=value(me,"m_checkpointDamageToTank",-1),witch=value(me,"m_checkpointDamageToWitch",-1);if(tank>1000000||witch>1000000)return;
    bool active=!opt("boss-active-only")||(!gunTimes.empty()&&uint32_t(now-gunTimes.back())<180)||(meleeUntil&&!elapsed(meleeUntil));
    if(active&&integer("hit-mode")){
        if(tank>=0&&checkpointTank>=0&&tank>checkpointTank){auto alive=[](const L4P_EntityRefV1& r){return r.index&&value(r,"m_iTeamNum")==3&&value(r,"m_zombieClass")==8&&!byte(r,"m_lifeState",1);};
            if(!alive(tankTarget)){tankTarget={};for(int i=1;i<=32;++i){L4P_EntityRefV1 r{};if(ref(i,r)&&alive(r)){tankTarget=r;break;}}}float pos[3]{};if(tankTarget.index&&position(tankTarget,pos)){pos[2]+=40;si_fx(true,false,false,pos);}}
        if(witch>=0&&checkpointWitch>=0&&witch>checkpointWitch){float pos[3]{};bool have=witchTarget.index&&!byte(witchTarget,"m_lifeState")&&position(witchTarget,pos);
            if(!have){float eye[3]{};entity.eye(&me,eye);L4P_ViewV1 v{sizeof(v)};view.snapshot(&v);float rad=.01745329251f,forward[3]={cosf(v.angles[0]*rad)*cosf(v.angles[1]*rad),cosf(v.angles[0]*rad)*sinf(v.angles[1]*rad),-sinf(v.angles[0]*rad)},best=-1e30f;
                for(auto& w:witches){float point[3]{};if(!w.ref.index||byte(w.ref,"m_lifeState")||!position(w.ref,point))continue;float d[3]={point[0]-eye[0],point[1]-eye[1],point[2]+40-eye[2]},len=std::sqrt(d[0]*d[0]+d[1]*d[1]+d[2]*d[2]);float score=len>1?(d[0]*forward[0]+d[1]*forward[1]+d[2]*forward[2])/len:0;
                    if(!have||score>best){have=true;best=score;witchTarget=w.ref;std::copy(point,point+3,pos);}}
            }if(!have){if(haveImpact){std::copy(impact,impact+3,pos);have=true;}else if(!entity.eye(&me,pos)){pos[2]+=8;have=true;}}
            if(have){pos[2]+=40;common_fx(true,false,false,pos,true);}
        }
    }if(tank>=0)checkpointTank=tank;if(witch>=0)checkpointWitch=witch;
}
void L4P_CALL on_frame(void*,const L4P_SourceFrameV1* f){if(!ready)return;std::lock_guard<std::recursive_mutex> lock(mutex);now=f->time_ms;catalog(f);
    bool enabled=opt("active");if(enabled&&bootPlatform&&!bootHeld){code=particles.boot_manifests(token,"skeeto_",bootLimit);bootHeld=!code;}else if(!enabled&&bootHeld){particles.release_manifests(token);bootHeld=false;}
    char owner[65]{};resource.owner("skeeto.hud.pause-sampling",owner);bool nextPaused=*owner!=0;
    if(!enabled||!source.allowed(f,0)||nextPaused){if(running||paused!=nextPaused){feedback.release(token);audio.stop_all(token);reset();overlayUntil=0;overlays.clear();}running=false;paused=nextPaused;return;}
    paused=false;if(!running){reset();running=true;}if(!opt("icon"))clear_overlay();if(warm)precache();L4P_EntityRefV1 me{};bool live=local(f,me);
    feedback.watch_health(token,live&&(integer("hit-mode")||opt("special-kill")));
    if(live){melee_sample(me);if(integer("hit-mode")||opt("special-kill")||opt("friendly-fire"))hits(f,me);if(integer("hit-mode"))bosses(me);}else{gunTimes.clear();meleeUntil=0;friendly.clear();}
    std::vector<Job> batch;batch.swap(jobs);int best=-1;for(size_t i=0;i<batch.size();++i)if(batch[i].kill&&(best<0||batch[i].fx.priority>=batch[best].fx.priority))best=int(i);
    for(size_t i=0;i<batch.size();++i)play(batch[i],!batch[i].kill||int(i)==best);
    if(overlayUntil){if(elapsed(overlayUntil))clear_overlay();else if(overlays.size()>1&&overlayStep){int next=std::min(int(overlays.size()-1),int(uint32_t(now-overlayStart)/overlayStep));if(next>overlayIndex){overlayIndex=next;code=feedback.overlay(token,overlays[next].c_str());}}}
    if(splatDue&&elapsed(splatDue)){splatDue=0;if(opt("blood-splat")&&opt("sound")){static uint32_t rng=0x6C078965u;static int last=-1;rng=rng*1664525u+1013904223u;int pick=int((rng>>16)%6);if(pick==last)pick=(pick+1)%6;last=pick;auto path="player/survivor/splat/zombie_blood_spray_0"+std::to_string(pick+1)+".wav";sound(path.c_str(),.5f);}}
}
bool validate(const json& input,json& out){if(!flare_feature::validate(fields,input,out))return false;
    for(auto key:{"ci-style","si-style","ff-style","fx-style"}){auto id=out[key].get<std::string>();if(id.size()>40||id.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")!=id.npos)return false;}return true;
}
void select_styles(){for(auto c:{"ci","si","ff","fx"})DlcSetSelected(c,settings[std::string(c)+"-style"].get<std::string>().c_str());DlcSetStyleLimit(std::stoi(settings["json-limit"].get<std::string>()));warm=true;}
void L4P_CALL shutdown(){ready=false;if(token){source.unsubscribe(token);feedback.release(token);particles.release_manifests(token);audio.stop_all(token);DlcReleaseFiles();token=0;}}
uint32_t L4P_CALL init(const L4P_HostApiV1* host){if(!host||host->api_version!=1||host->struct_size!=sizeof(*host)||!host->plugin_directory||!host->config_json||ready)return L4P_BAD_ARGUMENT;
    try{fields=json::parse(kFields);if(!validate(json::parse(host->config_json),settings))return L4P_BAD_ARGUMENT;auto dir=fs::u8path(host->plugin_directory);configFile=dir/L"config.json";gameDir=(dir.parent_path().parent_path().parent_path().parent_path()/L"left4dead2").u8string();
        auto dll=GetModuleHandleW((dir.parent_path()/L"beacon.source/plugin.dll").c_str());if(!dll)return L4P_ERROR;
#define SDK(type,name,version,out) {auto get=reinterpret_cast<type>(GetProcAddress(dll,name));if(!get||get(version,out))return L4P_ERROR;}
        SDK(L4P_GetSourceApiFn,"L4P_GetSourceApi",2,&source) SDK(L4P_GetEntityApiFn,"L4P_GetEntityApi",1,&entity)
        SDK(L4P_GetFeedbackApiFn,"L4P_GetFeedbackApi",1,&feedback) SDK(L4P_GetParticleApiFn,"L4P_GetParticleApi",1,&particles)
        SDK(L4P_GetFileApiFn,"L4P_GetFileApi",3,&files.base.base) SDK(L4P_GetAudioApiFn,"L4P_GetAudioApi",1,&audio)
        SDK(L4P_GetEffectsApiFn,"L4P_GetEffectsApi",1,&effects) SDK(L4P_GetViewApiFn,"L4P_GetViewApi",1,&view) SDK(L4P_GetResourceApiFn,"L4P_GetResourceApi",1,&resource)
#undef SDK
        const char* events="game_newmap,server_spawn,round_start,player_death,infected_death,bullet_impact,melee_kill,player_hurt_concise,witch_spawn,witch_killed,tongue_pull_stopped,charger_charge_start,charger_charge_end";
        if(source.subscribe(kId,0,events,nullptr,on_frame,on_event,&token))return L4P_ERROR;DlcBindFiles(&files,token);select_styles();bootPlatform=opt("particle-platform");bootLimit=uint32_t(std::stoi(settings["manifest-limit"].get<std::string>()));
        bootHeld=false;if(opt("active")&&bootPlatform){code=particles.boot_manifests(token,"skeeto_",bootLimit);bootHeld=!code;}running=paused=false;now=GetTickCount();reset();ready=true;return L4P_OK;
    }catch(...){shutdown();return L4P_BAD_ARGUMENT;}
}
uint32_t L4P_CALL invoke(const char* action,const char* parameters,char* out,uint32_t cap,uint32_t* size){if(!ready||!action||!parameters||!out||!size)return L4P_BAD_ARGUMENT;
    try{auto args=json::parse(parameters);if(!args.is_object())return L4P_BAD_ARGUMENT;std::lock_guard<std::recursive_mutex> lock(mutex);json next=settings;bool change=!strcmp(action,"configure"),styles=!strcmp(action,"styles"),reload=!strcmp(action,"reload-styles");
        if(!change&&!styles&&!reload&&strcmp(action,"status"))return L4P_BAD_ARGUMENT;if(!change&&!args.empty())return L4P_BAD_ARGUMENT;
        if(change){for(auto& p:args.items())next[p.key()]=p.value();json checked;if(!validate(next,checked))return L4P_BAD_ARGUMENT;next=checked;}
        auto sections=json::array();if(styles){for(auto c:{"ci","si","ff","fx"}){auto items=json::array();for(int i=0;i<DlcCountChannel(c);++i)items.push_back({{"label",DlcChannelNameAt(c,i)},{"value",DlcChannelIdAt(c,i)}});sections.push_back({{"title",c},{"layout","list"},{"items",items}});}}
        else sections.push_back({{"title","运行状态"},{"layout","list"},{"items",json::array({{{"label","状态"},{"value",opt("active")?(running?"已启用":"等待对局"):"已关闭"}},{{"label","素材样式"},{"value",DlcGetCatalog()->count}},{{"label","已播放反馈"},{"value",played}},{{"label","接口状态"},{"value",code}},{{"label","粒子平台"},{"value",bootPlatform?"本次启动开启":"本次启动关闭"}}})}});
        auto body=json{{"format","flare.report.v1"},{"title","命中反馈"},{"summary",change?"设置已保存，粒子平台与清单上限下次启动应用":reload?"已安排刷新素材目录":"选择普感、特感、友伤和特殊击杀的独立素材"},{"settings",next},{"sections",sections}}.dump();*size=uint32_t(body.size()+1);if(cap<*size)return L4P_BUFFER_TOO_SMALL;
        if(change){if(!flare_feature::save(configFile,next))return L4P_ERROR;bool resetStreak=settings["streak-window"]!=next["streak-window"];if(settings["workshop-recovery"]!=next["workshop-recovery"])mountState=-1;settings=next;select_styles();if(resetStreak){ciStreak=siStreak=0;ciStreakAt=siStreakAt=0;}}
        if(reload)reloadCatalog=true;memcpy(out,body.c_str(),*size);return L4P_OK;
    }catch(...){return L4P_BAD_ARGUMENT;}
}
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetPluginApi(uint32_t version,L4P_PluginApiV1* out){if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;*out={1,sizeof(*out),kId,"0.1.0",init,invoke,shutdown};return L4P_OK;}
