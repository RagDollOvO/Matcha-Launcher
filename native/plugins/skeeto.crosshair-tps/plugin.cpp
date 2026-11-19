// GPL-3.0. SurfDrawThirdPersonAimMarker / XhairTpFactory, Skeeto 2.2.19.
#define NOMINMAX
#include <windows.h>
#include "l4p_effects.h"
#include "l4p_draw.h"
#include "l4p_view.h"
#include "l4p_cvar.h"
#include "l4p_resource.h"
#include "definition.hpp"
#include <cmath>
#include <algorithm>
static constexpr char kId[]="skeeto.crosshair-tps",kVersion[]="0.1.0",kTitle[]="第三人称准星",kSummary[]="沿玩家眼睛视线标出落点";
static constexpr uint32_t kScope=L4P_SOURCE_ANY;
static constexpr char kEvents[]="game_newmap,server_spawn,round_start,round_end,map_transition,mission_lost,finale_win,finale_vehicle_leaving";
#include "feature_plugin.inc"
namespace {
L4P_EntityApiV1 entities{1,sizeof(entities)};L4P_EffectsApiV1 effects{1,sizeof(effects)};
L4P_DrawApiV1 draw{1,sizeof(draw)};L4P_ViewApiV1 view{1,sizeof(view)};
L4P_CvarApiV1 cvar{1,sizeof(cvar)};L4P_ResourceApiV1 resource{1,sizeof(resource)};
bool quiet=false;uint32_t hiddenUntil=0;
constexpr L4P_ColorV1 palette[]={{255,255,255,255},{0,255,0,255},{0,255,255,255},{255,40,40,255},{255,220,0,255},{255,140,0,255},{255,80,180,255},{80,140,255,255},{180,255,0,255},{0,200,120,255}};
struct Tune{int length,gap,thick,dot;};constexpr Tune factory[]={{8,4,2,0},{8,4,2,3},{0,0,2,4},{5,6,2,0}};
void release(){cvar.release(token,"crosshair");resource.release(token,"skeeto.crosshair.tps-active");}
bool occupied(const char* key){char owner[65]{};return resource.owner(key,owner)==L4P_OK&&owner[0];}
uint32_t marker(const json& config,int cx,int cy,int height){
    int style=config["style"],scale=config["size"],base=std::max(8,height/90);auto tune=factory[style];
    int arm=std::max(2,base*tune.length*scale/1000),half=std::max(1,base*tune.thick*scale/1000)/2;
    int gap=base*tune.gap*scale/1000,dot=base*tune.dot*scale/1000;uint32_t result=L4P_OK;
    L4P_ColorV1 color{0,0,0,uint8_t((config["opacity"].get<int>()*255+50)/100)};
    auto line=[&](int x0,int y0,int x1,int y1){if(result==L4P_OK)result=draw.line(token,x0,y0,x1,y1,color);};
    auto h=[&](int x0,int x1,int y){for(int k=-half;k<=half;++k)line(x0,y+k,x1,y+k);};
    auto v=[&](int x,int y0,int y1){for(int k=-half;k<=half;++k)line(x+k,y0,x+k,y1);};
    auto point=[&](int side){if(side>0&&result==L4P_OK)result=draw.rect(token,cx-side/2,cy-side/2,side,side,color,1);};
    for(int grow=1;grow>=0;--grow){if(!grow){auto alpha=color.a;color=palette[config["color"].get<int>()];color.a=alpha;}
        int a=arm+grow,gp=std::max(0,gap-grow);
        if(style==2)point(dot+grow*2);
        else if(style==3){h(cx-a,cx-gp,cy-a);v(cx-a,cy-a,cy-gp);h(cx+gp,cx+a,cy-a);v(cx+a,cy-a,cy-gp);h(cx-a,cx-gp,cy+a);v(cx-a,cy+gp,cy+a);h(cx+gp,cx+a,cy+a);v(cx+a,cy+gp,cy+a);}
        else{h(cx-a,cx-gp,cy);h(cx+gp,cx+a,cy);v(cx,cy-a,cy-gp);v(cx,cy+gp,cy+a);if(style==1)point(dot+grow*2);}
    }return result;
}
}
bool feature_create(HMODULE m){
    auto ge=reinterpret_cast<L4P_GetEntityApiFn>(GetProcAddress(m,"L4P_GetEntityApi"));auto gf=reinterpret_cast<L4P_GetEffectsApiFn>(GetProcAddress(m,"L4P_GetEffectsApi"));
    auto gd=reinterpret_cast<L4P_GetDrawApiFn>(GetProcAddress(m,"L4P_GetDrawApi"));auto gv=reinterpret_cast<L4P_GetViewApiFn>(GetProcAddress(m,"L4P_GetViewApi"));
    auto gc=reinterpret_cast<L4P_GetCvarApiFn>(GetProcAddress(m,"L4P_GetCvarApi"));auto gr=reinterpret_cast<L4P_GetResourceApiFn>(GetProcAddress(m,"L4P_GetResourceApi"));
    if(!ge||!gf||!gd||!gv||!gc||!gr||ge(1,&entities)||gf(1,&effects)||gd(1,&draw)||gv(1,&view)||gc(1,&cvar)||gr(1,&resource))return false;
    quiet=false;hiddenUntil=0;return true;
}
void feature_end(){release();}
void feature_event(const json&,const L4P_SourceFrameV1* f,const char* name,void*){
    if(!strcmp(name,"round_start")||!strcmp(name,"server_spawn")||!strcmp(name,"game_newmap")){quiet=false;return;}
    quiet=true;if(!strcmp(name,"round_end")||!strcmp(name,"map_transition"))hiddenUntil=f->time_ms+2800;
    release();
}
void feature_tick(const json& config,const L4P_SourceFrameV1* f,bool){
    if(f->loading)hiddenUntil=f->time_ms+500;
    if(!f->connected||!f->in_game){quiet=false;release();feature_state("等待进入对局",L4P_ENTITY_SCOPE);return;}
    if(!config["active"].get<bool>()){release();feature_state("已关闭");return;}
    if(!source.allowed(f,kScope)||quiet||(hiddenUntil&&int32_t(hiddenUntil-f->time_ms)>0)){release();feature_state("场景切换期间隐藏");return;}
    L4P_ViewV1 state{sizeof(state)};auto result=view.snapshot(&state);
    if(result!=L4P_OK){release();feature_state("等待视角接口",result);return;}
    if(state.game_ui||occupied("skeeto.crosshair.hide-all")||occupied("skeeto.crosshair.reach-hidden")||occupied("skeeto.crosshair.reload-hidden")){release();feature_state("界面或动画期间隐藏");return;}
    if(!(state.paint_mode&L4P_PAINT_GAME))return;
    float shoulder=0;result=cvar.read("c_thirdpersonshoulder",&shoulder);
    if(result!=L4P_OK||shoulder!=1){release();feature_state("等待第三人称肩后视角",result);return;}
    L4P_EntityRefV1 me{};float eye[3]{};int width=0,height=0;
    if(!state.angles_valid||entities.reference(f->local_player,&me)!=L4P_OK||entities.eye(&me,eye)!=L4P_OK){release();feature_state("等待本地视线",L4P_ENTITY_MISSING);return;}
    result=draw.screen(token,&width,&height);if(result!=L4P_OK||width<80||height<80){release();feature_state("等待绘制尺寸",result);return;}
    constexpr float rad=3.14159265358979323846f/180.f;float pitch=state.angles[0]*rad,yaw=state.angles[1]*rad;
    float forward[3]={std::cos(pitch)*std::cos(yaw),std::cos(pitch)*std::sin(yaw),-std::sin(pitch)};
    float target[3];for(int i=0;i<3;++i)target[i]=eye[i]+forward[i]*8192.f;
    L4P_TraceV1 trace{sizeof(trace)};if(effects.trace(token,eye,target,L4P_TRACE_SHOT,0,&me,&trace)==L4P_OK)memcpy(target,trace.end,sizeof(target));
    float screen[2]{};result=draw.project(token,target,screen);
    if(result!=L4P_OK){release();feature_state("落点在画面外",result);return;}
    result=marker(config,int(screen[0]+.5f),int(screen[1]+.5f),height);
    if(result!=L4P_OK){release();feature_state("绘制入口暂不可用",result);return;}
    result=cvar.pin(token,"crosshair",0);if(result==L4P_OK)result=resource.claim(token,"skeeto.crosshair.tps-active");
    feature_state(result==L4P_OK?"正在显示第三人称视线落点":"落点已显示，原版准星参数被占用或缺失",result);
}
