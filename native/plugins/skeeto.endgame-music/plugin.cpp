// GPL-3.0. SafeMusic / LastMusic from Skeeto 2.2.19, independent SDK module.
#define NOMINMAX
#include <windows.h>
#include "l4p_entity.h"
#include "l4p_sound.h"
#include "l4p_draw.h"
#include "l4p_view.h"
#include "l4p_resource.h"
#include "music.hpp"
#include "definition.hpp"
#include <algorithm>
#include <thread>
static constexpr char kId[]="skeeto.endgame-music",kVersion[]="0.1.0",kTitle[]="结算与氛围音乐",kSummary[]="自定义安全屋音乐与最后生还者氛围音乐";
static constexpr uint32_t kScope=L4P_SOURCE_ANY;static constexpr char kEvents[]="game_newmap,server_spawn,round_start,game_disconnect,map_transition,mission_lost";
#define L4P_FEATURE_CUSTOM_ACTIONS
#define L4P_FEATURE_VALIDATE_FIELDS
#include "feature_plugin.inc"
namespace {
L4P_EntityApiV2 entity2{{2,sizeof(entity2)}};auto& entities=entity2.base;
L4P_FileApiV1 files{1,sizeof(files)};L4P_SoundApiV1 sound{1,sizeof(sound)};L4P_DrawApiV1 draw{1,sizeof(draw)};L4P_ViewApiV1 view{1,sizeof(view)};L4P_ResourceApiV1 resource{1,sizeof(resource)};
std::thread lifecycle;HANDLE lifecycleStop=nullptr;std::atomic<unsigned> commands{0},chapterEpoch{1};std::atomic<bool> safeWanted{false},chapterClaimed{false},requestBusy{false};
bool filterOn=false,lastWanted=false,conditionBefore=false,roundFailed=false,lastReset=false,safePending=false,preview=false,previewQueued=false,noticePreview=false;
uint32_t sampleAt=0,settleUntil=0,noticeBorn=0,noticeUntil=0,seenStart=0,previewUntil=0,resourceRetry=0;int resourceCursor=1;L4P_EntityRefV1 playerResource{};
SkeetoSafeMusicCatalog catalog{};std::string actionState;
constexpr const char* modes[]={"团灭后","仅一人存活","仅一人未倒地","仅自己存活","仅自己未倒地"};
bool due(uint32_t now,uint32_t at){return !at||int32_t(now-at)>=0;}
void resetSafe(){++chapterEpoch;chapterClaimed=false;safePending=false;SkeetoSafeMusicCancel();}
bool requestSafe(){if(!safeWanted)return false;if(chapterClaimed)return true;if(requestBusy.exchange(true))return false;
    const auto epoch=chapterEpoch.load();const bool queued=SkeetoSafeMusicQueuePlay();const bool success=queued&&epoch==chapterEpoch.load()&&safeWanted.load();if(success)chapterClaimed=true;if(epoch!=chapterEpoch.load())chapterClaimed=false;requestBusy=false;return success;}
float L4P_CALL filter(void*,const char* sample,float volume){if(!sample||!safeWanted.load())return volume;int prefix=0;while(*sample&&strchr("@#*^)$!?",*sample)&&prefix++<16)++sample;
    char normalized[128]{};size_t i=0;for(;i<127&&sample[i];++i)normalized[i]=sample[i]=='\\'?'/':sample[i];if(sample[i])return volume;
    return (!_stricmp(normalized,"music/safe/themonsterswithout.wav")||!_stricmp(normalized,"music/safe/themonsterswithout_l4d1.wav"))&&requestSafe()?0:volume;}
bool roster(int& total,int& alive,int& standing,bool& selfAlive,bool& selfStanding,int local,uint32_t now){
    total=alive=standing=0;selfAlive=selfStanding=false;L4P_EntityInfoV1 info{sizeof(info)};
    if(playerResource.index&&(entities.describe(&playerResource,&info)!=L4P_OK||strcmp(info.class_name,"CTerrorPlayerResource"))){playerResource={};resourceCursor=1;}
    if(!playerResource.index&&due(now,resourceRetry)){for(int n=0;n<64&&resourceCursor<=255;++n){L4P_EntityRefV1 ref{};
        if(entities.reference(resourceCursor++,&ref)==L4P_OK&&entities.describe(&ref,&info)==L4P_OK&&!strcmp(info.class_name,"CTerrorPlayerResource")){playerResource=ref;break;}}
        if(resourceCursor>255){resourceCursor=1;resourceRetry=now+3000;}}
    int probe=0;const bool pr=playerResource.index&&entity2.read_index(&playerResource,"m_iTeam",1,&probe)==L4P_OK&&entity2.read_index(&playerResource,"m_bAlive",1,&probe)==L4P_OK&&entity2.read_index(&playerResource,"m_isIncapacitated",1,&probe)==L4P_OK;
    for(int i=1;i<=32;++i){if(entity2.player_info(i,&info)!=L4P_OK||!info.player_name[0])continue;int team=0,a=0,incap=0;uint8_t hanging=0;bool living=false;
        if(pr){if(entity2.read_index(&playerResource,"m_iTeam",i,&team)!=L4P_OK||team!=2)continue;
            if(entity2.read_index(&playerResource,"m_bAlive",i,&a)!=L4P_OK||entity2.read_index(&playerResource,"m_isIncapacitated",i,&incap)!=L4P_OK)continue;
            if(info.ref.index)entities.read(&info.ref,"m_isHangingFromLedge",L4P_FIELD_BYTE,&hanging);living=a!=0;
        }else{if(!info.ref.index)continue;if(entities.read(&info.ref,"m_iTeamNum",L4P_FIELD_INT,&team)!=L4P_OK)return false;if(team!=2)continue;
            uint8_t life=0,down=0;if(entities.read(&info.ref,"m_lifeState",L4P_FIELD_BYTE,&life)!=L4P_OK||entities.read(&info.ref,"m_isIncapacitated",L4P_FIELD_BYTE,&down)!=L4P_OK||entities.read(&info.ref,"m_isHangingFromLedge",L4P_FIELD_BYTE,&hanging)!=L4P_OK)return false;living=life==0;incap=down;}
        ++total;const bool up=living&&!incap&&!hanging;if(living)++alive;if(up)++standing;if(i==local){selfAlive=living;selfStanding=up;}}
    return true;
}
bool shouldPlay(const std::string& mode,int total,int alive,int standing,bool selfAlive,bool selfStanding,bool failed){
    if(total<2||alive<0||standing<0||standing>alive||alive>total)return false;
    if(mode==modes[0])return failed||alive==0;if(mode==modes[1])return alive==1;if(mode==modes[2])return standing==1;if(mode==modes[3])return alive==1&&selfAlive;return standing==1&&selfStanding;
}
void drawNotice(const json& c,const L4P_SourceFrameV1* frame){
    if(!noticeUntil||!c["last_notice"].get<bool>()||!source.allowed(frame,kScope))return;L4P_ViewV1 v{sizeof(v)};if(view.snapshot(&v)!=L4P_OK||!(v.paint_mode&2)||v.game_ui)return;
    char hidden[65]{};resource.owner("skeeto.hud.hide-all",hidden);if(*hidden)return;const auto elapsed=frame->time_ms-noticeBorn;if(elapsed>=5000)return;
    const int alpha=elapsed<100?int(elapsed*255/100):elapsed>4550?int((5000-elapsed)*255/450):255;if(alpha<12)return;
    int32_t sw=0,sh=0;if(draw.screen(token,&sw,&sh)!=L4P_OK)return;const int scale=((c["notice_scale"].get<int>()+2)/5)*5;
    auto px=[&](int n){return std::max(1,(n*scale+50)/100);};uint32_t font=0;if(draw.font(token,"Microsoft YaHei",px(22),900,0x290,&font)!=L4P_OK)return;
    int32_t tw=0,th=0;if(draw.measure(token,font,"会赢吗？",&tw,&th)!=L4P_OK)return;const int stripe=px(4),padX=px(14),padY=px(8),inner=std::max(tw,px(72)),width=stripe+padX*2+inner,height=padY*2+px(22)+2;
    int x=c["notice_x"],y=c["notice_y"];if(!c["notice_absolute"].get<bool>())x+=(sw-width)/2;x=std::clamp(x,0,std::max(0,sw-width));y=std::clamp(y,0,std::max(0,sh-height));
    draw.rect(token,x+2,y+3,width,height,{0,0,0,uint8_t(alpha*45/255)},1);draw.rect(token,x,y,width,height,{8,16,32,uint8_t(alpha*105/255)},1);
    draw.rect(token,x+stripe+1,y+1,width-stripe-2,1,{255,255,255,uint8_t(alpha*14/255)},1);draw.rect(token,x,y,stripe,height,{64,144,255,uint8_t(alpha*235/255)},1);
    const L4P_ColorV1 accent{64,144,255,uint8_t(alpha*150/255)};for(int right=0;right<2;++right)for(int bottom=0;bottom<2;++bottom){int cx=x+(right?width:0),cy=y+(bottom?height:0);draw.line(token,cx,cy,cx+(right?-8:8),cy,accent);draw.line(token,cx,cy,cx,cy+(bottom?-8:8),accent);}
    draw.text(token,font,x+stripe+padX+(inner-tw)/2,y+padY,{218,236,255,255},"会赢吗？");
}
}
bool feature_validate(const json& c){const auto name=c["safe_track"].get<std::string>();return name.size()<256&&name.find_first_of("/\\:\r\n")==std::string::npos&&(!name.size()||MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,name.c_str(),int(name.size()),nullptr,0));}
bool feature_create(HMODULE m){
    auto ge=reinterpret_cast<L4P_GetEntityApiFn>(GetProcAddress(m,"L4P_GetEntityApi"));auto gf=reinterpret_cast<L4P_GetFileApiFn>(GetProcAddress(m,"L4P_GetFileApi"));auto gs=reinterpret_cast<L4P_GetSoundApiFn>(GetProcAddress(m,"L4P_GetSoundApi"));
    auto gd=reinterpret_cast<L4P_GetDrawApiFn>(GetProcAddress(m,"L4P_GetDrawApi"));auto gv=reinterpret_cast<L4P_GetViewApiFn>(GetProcAddress(m,"L4P_GetViewApi"));auto gr=reinterpret_cast<L4P_GetResourceApiFn>(GetProcAddress(m,"L4P_GetResourceApi"));
    if(!ge||!gf||!gs||!gd||!gv||!gr||ge(2,&entity2.base)||gf(1,&files)||gs(1,&sound)||gd(1,&draw)||gv(1,&view)||gr(1,&resource))return false;
    SkeetoMusicBind(files,&token,(featureConfigFile.parent_path()/L"media-cache").c_str());commands=0;safeWanted=false;chapterClaimed=false;requestBusy=false;++chapterEpoch;
    filterOn=lastWanted=conditionBefore=roundFailed=lastReset=safePending=preview=previewQueued=noticePreview=false;sampleAt=settleUntil=noticeBorn=noticeUntil=seenStart=previewUntil=resourceRetry=0;playerResource={};resourceCursor=1;catalog={};
    lifecycleStop=CreateEventW(nullptr,TRUE,FALSE,nullptr);if(!lifecycleStop)return false;
    try{lifecycle=std::thread([](){while(WaitForSingleObject(lifecycleStop,25)==WAIT_TIMEOUT){SkeetoSafeMusicLifecyclePump();SkeetoLastMusicLifecyclePump();}});}catch(...){CloseHandle(lifecycleStop);lifecycleStop=nullptr;return false;}return true;
}
void feature_end(){safeWanted=false;commands=0;SkeetoSafeMusicConfigure("",false,100,false,"");SkeetoLastMusicConfigure(false,100);if(lifecycleStop)SetEvent(lifecycleStop);if(lifecycle.joinable())lifecycle.join();
    SkeetoSafeMusicShutdown();SkeetoLastMusicShutdown();SkeetoMusicClearCache();if(lifecycleStop){CloseHandle(lifecycleStop);lifecycleStop=nullptr;}filterOn=false;}
void feature_event(const json& c,const L4P_SourceFrameV1*,const char* name,void*){
    if(!strcmp(name,"round_start")||!strcmp(name,"game_disconnect")||!strcmp(name,"game_newmap")||!strcmp(name,"server_spawn")){resetSafe();lastReset=true;roundFailed=false;playerResource={};resourceCursor=1;resourceRetry=0;}
    else if(!strcmp(name,"map_transition")){lastReset=true;roundFailed=false;if(safeWanted)safePending=true;}
    else if(!strcmp(name,"mission_lost")&&c["active"].get<bool>()&&c["last_enabled"].get<bool>())roundFailed=true;
}
void feature_tick(const json& c,const L4P_SourceFrameV1* frame,bool){
    const auto now=frame->time_ms,ops=commands.exchange(0);const bool active=c["active"],safe=active&&c["safe_enabled"].get<bool>(),last=active&&c["last_enabled"].get<bool>();
    if(ops&2){preview=true;previewQueued=false;previewUntil=now+15000;}
    if((ops&4)||!active){preview=false;previewQueued=false;SkeetoSafeMusicCancel();SkeetoLastMusicSetActive(false);noticeUntil=0;noticePreview=false;conditionBefore=true;if((ops&4)&&safeWanted)chapterClaimed=true;}
    SkeetoSafeMusicConfigure("",safe||preview,c["safe_volume"],c["safe_random"],c["safe_track"].get_ref<const std::string&>().c_str());SkeetoLastMusicConfigure(last,c["last_volume"]);
    if(ops&1){SkeetoSafeMusicReload();SkeetoLastMusicReload();}
    if((ops&8)&&active){noticeBorn=now;noticeUntil=now+5000;noticePreview=true;}
    const bool wanted=safe&&frame->connected&&frame->mode[0]&&!strstr(frame->mode,"scavenge");const bool before=safeWanted.exchange(wanted);if(before&&!wanted)resetSafe();
    if(wanted&&!filterOn){if(sound.set_filter(token,nullptr,filter)==L4P_OK)filterOn=true;}else if(!wanted&&filterOn){sound.clear_filter(token);filterOn=false;}
    SkeetoSafeMusicResourcePump(!frame->loading);SkeetoLastMusicResourcePump(!frame->loading);SkeetoMusicPruneCache();
    SkeetoSafeMusicCatalog updated{};{std::lock_guard<std::mutex> lock(featureMutex);updated=catalog;}if(SkeetoSafeMusicGetCatalog(&updated)){std::lock_guard<std::mutex> lock(featureMutex);catalog=updated;}
    L4P_SoundStatusV1 soundState{sizeof(soundState)};sound.status(&soundState);if(safePending){safePending=false;if(soundState.state==2)requestSafe();}
    if(preview&&!previewQueued){if(SkeetoSafeMusicQueuePlay())previewQueued=true;else if(due(now,previewUntil)){preview=false;feature_state("试听资源尚未就绪",L4P_ERROR);}}
    if(last!=lastWanted){sampleAt=0;settleUntil=now+500;conditionBefore=false;roundFailed=false;lastWanted=last;}
    const bool inGame=last&&source.allowed(frame,kScope);if(lastReset||!inGame){SkeetoLastMusicSetActive(false);if(lastReset||!noticePreview)noticeUntil=0;conditionBefore=false;sampleAt=0;settleUntil=now+1000;if(!inGame)roundFailed=false;}
    const auto started=SkeetoLastMusicStartedGeneration();if(started!=seenStart){seenStart=started;if(started&&inGame&&!lastReset&&c["last_notice"].get<bool>()){noticeBorn=now;noticeUntil=now+5000;}}
    lastReset=false;if(!c["last_notice"].get<bool>()||(noticeUntil&&due(now,noticeUntil))){noticeUntil=0;noticePreview=false;}
    if(inGame&&due(now,settleUntil)&&due(now,sampleAt)){sampleAt=now+1000;int total=0,alive=0,standing=0;bool selfAlive=false,selfStanding=false;
        const bool valid=roster(total,alive,standing,selfAlive,selfStanding,frame->local_player,now);const bool condition=valid&&shouldPlay(c["last_mode"],total,alive,standing,selfAlive,selfStanding,roundFailed);
        if(condition&&!conditionBefore)SkeetoLastMusicSetActive(true);else if(!condition&&c["last_auto_stop"].get<bool>())SkeetoLastMusicSetActive(false);conditionBefore=condition;}
    drawNotice(c,frame);
    const auto media=SkeetoMusicGetStatus();feature_state(!active?"已关闭":media.last==2?"最后生还者音乐播放中":media.safe==2?"安全屋音乐播放中":last&&media.last<0?"雨爱音轨未就绪，请检查素材包后重新扫描":(safe||preview)&&media.safe<0?"安全屋曲目或播放设备未就绪":safe&&soundState.state>=3?"原生结算入口不可用，保留游戏音乐":safe||last||preview?"等待结算或指定存活条件":"两类音乐均关闭",(last&&media.last<0)||((safe||preview)&&media.safe<0)?L4P_ERROR:L4P_OK);
}
uint32_t feature_custom_invoke(const char* action,const char* parameters,char* out,uint32_t capacity,uint32_t* size){try{
    auto args=json::parse(parameters);if(!args.is_object())return L4P_BAD_ARGUMENT;
    if(!strcmp(action,"adjust-volume")){if(args.size()!=2||!args.contains("channel")||!args["channel"].is_string()||!args.contains("direction")||!args["direction"].is_number_integer())return L4P_BAD_ARGUMENT;
        auto channel=args["channel"].get<std::string>();int direction=args["direction"];if((channel!="safe"&&channel!="last")||(direction!=-1&&direction!=1))return L4P_BAD_ARGUMENT;json change;
        {std::lock_guard<std::mutex> lock(featureMutex);const auto step=std::stoi(featureSettings[channel+"_step"].get<std::string>());change[channel+"_volume"]=std::clamp(featureSettings[channel+"_volume"].get<int>()+direction*step,0,100);}auto text=change.dump();return feature_invoke("configure",text.c_str(),out,capacity,size);}
    if(!args.empty())return L4P_BAD_ARGUMENT;unsigned op=!strcmp(action,"rescan")?1:!strcmp(action,"preview")?2:!strcmp(action,"stop")?4:!strcmp(action,"preview-notice")?8:0;
    const bool tracks=!strcmp(action,"tracks"),playback=!strcmp(action,"playback");if(!op&&!tracks&&!playback)return L4P_BAD_ARGUMENT;
    json items=json::array();std::string summary;
    if(tracks){std::lock_guard<std::mutex> lock(featureMutex);for(int i=0;i<catalog.count;++i)items.push_back({{"label",catalog.names[i]},{"value","sound/skeeto/safe/"+std::string(catalog.names[i])}});summary=catalog.failed?"扫描包含读取失败，可重新扫描":catalog.truncated?"已列出前 128 首曲目":catalog.count?"在设置中填写曲目名，或启用随机选择":"暂无曲目：启用安全屋音乐或点击试听后扫描挂载素材";}
    else if(playback){auto state=SkeetoMusicGetStatus();items={{{"label","safeState"},{"value",std::to_string(state.safe)}},{{"label","lastState"},{"value",std::to_string(state.last)}},{{"label","safeStarts"},{"value",std::to_string(state.safeStarts)}},{{"label","lastStarts"},{"value",std::to_string(state.lastStarts)}}};summary="状态：-1 资源或设备不可用，0 准备中，1 就绪，2 播放中";}
    else summary="请求已排队，下一游戏帧处理";
    auto text=json{{"format","flare.report.v1"},{"title",tracks?"安全屋曲目":kTitle},{"summary",summary},{"sections",json::array({{{"title",tracks?"可选曲目":"操作"},{"layout","list"},{"items",items}}})}}.dump();*size=uint32_t(text.size()+1);if(capacity<*size)return L4P_BUFFER_TOO_SMALL;
    if(op)commands.fetch_or(op);memcpy(out,text.c_str(),*size);return L4P_OK;
}catch(...){return L4P_BAD_ARGUMENT;}}
