// GPL-3.0. Independent SpotlightVision port from Skeeto 2.2.19.
#define NOMINMAX
#include <windows.h>
#include "l4p_effects.h"
#include "feature_config.hpp"
#include "definition.hpp"
#include <mutex>
#include <atomic>
#include <cstring>
#include <algorithm>
using nlohmann::json;namespace fs=std::filesystem;
namespace {
L4P_SourceApiV1 source{1,sizeof(source)};L4P_EntityApiV1 entities{1,sizeof(entities)};L4P_EffectsApiV1 effects{1,sizeof(effects)};
uint32_t token=0,nextRefresh=0,nextProbe=0,epoch=0;float lastEye[3]{},offset=96;
std::mutex mutex;json fields,settings;fs::path configFile;std::atomic<bool> ready{false};bool dirty=true,live=false;
std::string state="等待游戏帧";uint32_t code=L4P_OK;
void report(const char* text,uint32_t value){std::lock_guard<std::mutex> lock(mutex);state=text;code=value;}
void stop(const char* text,uint32_t result){effects.drop_light(token,0);live=false;nextRefresh=0;report(text,result);}
void L4P_CALL frame(void*,const L4P_SourceFrameV1* f){
    json config;{std::lock_guard<std::mutex> lock(mutex);config=settings;if(dirty){nextRefresh=0;nextProbe=0;dirty=false;}}
    if(!config["active"].get<bool>()){stop("已关闭",L4P_OK);return;}
    if(!source.allowed(f,L4P_SOURCE_LOCAL)){stop("等待本地服务器",L4P_ENTITY_SCOPE);return;}
    L4P_EntityRefV1 me{};auto result=entities.reference(f->local_player,&me);if(result!=L4P_OK){stop("等待玩家实体",result);return;}
    if(epoch!=me.epoch){epoch=me.epoch;nextRefresh=nextProbe=0;offset=96;live=false;}
    if(live&&nextRefresh&&int32_t(f->time_ms-nextRefresh)<0)return;nextRefresh=f->time_ms+33;
    uint8_t life=1;int team=0,observer=0;
    if(entities.read(&me,"m_lifeState",L4P_FIELD_BYTE,&life)!=L4P_OK||entities.read(&me,"m_iTeamNum",L4P_FIELD_INT,&team)!=L4P_OK){stop("玩家状态字段缺失",L4P_ENTITY_MISSING);return;}
    result=entities.read(&me,"m_iObserverMode",L4P_FIELD_INT,&observer);if(result!=L4P_OK&&result!=L4P_ENTITY_MISSING){stop("等待玩家状态",result);return;}
    if(life||team!=2||observer){stop("等待存活幸存者",L4P_OK);return;}
    float eye[3]{};result=entities.eye(&me,eye);if(result!=L4P_OK){stop("视点位置缺失",result);return;}
    bool moved=false;for(int i=0;i<3;++i)moved|=std::abs(eye[i]-lastEye[i])>24;
    if(!nextProbe||moved||int32_t(f->time_ms-nextProbe)>=0){
        nextProbe=f->time_ms+250;memcpy(lastEye,eye,sizeof(eye));float end[3]={eye[0],eye[1],eye[2]+112};L4P_TraceV1 trace{sizeof(trace)};
        if(effects.trace(token,eye,end,L4P_TRACE_SHOT,1,nullptr,&trace)==L4P_OK)offset=trace.fraction<1?std::max(12.f,trace.end[2]-10.f-eye[2]):96.f;
    }
    int rgb[3]={config["red"].get<int>(),config["green"].get<int>(),config["blue"].get<int>()};auto preset=config["preset"].get<std::string>();
    if(preset=="natural"){rgb[0]=235;rgb[1]=240;rgb[2]=230;}else if(preset=="warm"){rgb[0]=255;rgb[1]=218;rgb[2]=170;}else if(preset=="cool"){rgb[0]=190;rgb[1]=225;rgb[2]=255;}
    float scale=config["brightness"].get<int>()/100.f;int8_t exponent=0;if(scale>1){scale*=.5f;exponent=1;}
    auto color=[&](int c){return uint8_t(std::clamp(c*scale,0.f,255.f)+.5f);};
    L4P_LightV1 light{sizeof(light)};memcpy(light.origin,eye,sizeof(eye));light.origin[2]+=offset;light.radius=config["radius"].get<int>();light.ttl=.2f;
    light.red=color(rgb[0]);light.green=color(rgb[1]);light.blue=color(rgb[2]);light.exponent=exponent;
    result=effects.light(token,0,&light);if(result!=L4P_OK){stop("灯光接口暂不可用",result);return;}live=true;report("照明已应用",L4P_OK);
}
void L4P_CALL shutdown(){ready=false;if(token){effects.drop_light(token,0);source.unsubscribe(token);token=0;}live=false;}
uint32_t L4P_CALL init(const L4P_HostApiV1* host){
    if(!host||host->api_version!=1||host->struct_size!=sizeof(*host)||!host->plugin_directory||!host->config_json||ready)return L4P_BAD_ARGUMENT;
    try{fields=json::parse(kFields);json config;if(!flare_feature::validate(fields,json::parse(host->config_json),config))return L4P_BAD_ARGUMENT;
        auto dir=fs::u8path(host->plugin_directory);configFile=dir/L"config.json";auto module=GetModuleHandleW((dir.parent_path()/L"beacon.source/plugin.dll").c_str());if(!module)return L4P_ERROR;
        auto get=reinterpret_cast<L4P_GetSourceApiFn>(GetProcAddress(module,"L4P_GetSourceApi"));auto ge=reinterpret_cast<L4P_GetEntityApiFn>(GetProcAddress(module,"L4P_GetEntityApi"));auto gf=reinterpret_cast<L4P_GetEffectsApiFn>(GetProcAddress(module,"L4P_GetEffectsApi"));
        if(!get||!ge||!gf||get(1,&source)||ge(1,&entities)||gf(1,&effects))return L4P_ERROR;
        {std::lock_guard<std::mutex> lock(mutex);settings=config;dirty=true;state="等待游戏帧";code=L4P_OK;}nextRefresh=nextProbe=epoch=0;offset=96;
        if(source.subscribe("skeeto.night-vision",L4P_SOURCE_LOCAL,"",nullptr,frame,nullptr,&token)!=L4P_OK)return L4P_ERROR;ready=true;return L4P_OK;
    }catch(...){shutdown();return L4P_BAD_ARGUMENT;}
}
uint32_t L4P_CALL invoke(const char* action,const char* parameters,char* out,uint32_t capacity,uint32_t* size){
    if(!ready||!action||!parameters||!out||!size)return L4P_BAD_ARGUMENT;
    try{auto args=json::parse(parameters);bool change=!strcmp(action,"configure");if(!args.is_object()||(!change&&(strcmp(action,"status")||!args.empty())))return L4P_BAD_ARGUMENT;
        std::lock_guard<std::mutex> lock(mutex);json next=settings;if(change){for(auto& p:args.items())next[p.key()]=p.value();json checked;if(!flare_feature::validate(fields,next,checked))return L4P_BAD_ARGUMENT;next=checked;}
        auto body=json{{"format","flare.report.v1"},{"title","聚光灯夜视"},{"summary",change?"设置已保存，下一游戏帧应用":"仅在本地服照亮存活幸存者周围"},{"settings",next},{"sections",json::array({{{"title","照明状态"},{"layout","list"},{"items",json::array({{{"label","状态"},{"value",state},{"code",code}},{{"label","亮度"},{"value",next["brightness"]},{"unit","%"}},{{"label","半径"},{"value",next["radius"]},{"unit","Source 单位"}}})}}})}}.dump();
        *size=uint32_t(body.size()+1);if(capacity<*size)return L4P_BUFFER_TOO_SMALL;
        if(change){if(!flare_feature::save(configFile,next))return L4P_ERROR;settings=next;dirty=true;}
        memcpy(out,body.c_str(),*size);return L4P_OK;
    }catch(...){return L4P_BAD_ARGUMENT;}
}
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetPluginApi(uint32_t version,L4P_PluginApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),"skeeto.night-vision","0.1.0",init,invoke,shutdown};return L4P_OK;
}
