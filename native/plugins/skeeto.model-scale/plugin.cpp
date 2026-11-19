// GPL-3.0. Skeeto 2.2.19 WModelScale, independent Source SDK consumer.
#define NOMINMAX
#include <windows.h>
#include "l4p_model.h"
#include "definition.hpp"
static constexpr char kId[]="skeeto.model-scale",kVersion[]="0.1.0",kTitle[]="感染者模型缩放",kSummary[]="分别调整特感和普通感染者的显示比例";
static constexpr uint32_t kScope=L4P_SOURCE_LOCAL;static constexpr char kEvents[]="game_newmap,server_spawn";
#include "feature_plugin.inc"
namespace {
L4P_ModelApiV1 model{1,sizeof(model)};L4P_EntityApiV1 entities{1,sizeof(entities)};int cursor=65;
struct Kind {int category=0;uint32_t method=L4P_MODEL_FIELD;};
Kind classify(const L4P_EntityRefV1& ref){
    L4P_EntityInfoV1 info{sizeof(info)};if(entities.describe(&ref,&info)!=L4P_OK)return {};auto name=info.class_name;
    if(strstr(name,"ViewModel"))return {};
    if(!_stricmp(name,"Witch")||!_stricmp(name,"C_Witch"))return {1,L4P_MODEL_BONES};
    if(!_stricmp(name,"Infected")||!_stricmp(name,"C_Infected"))return {2,L4P_MODEL_BONES};
    const char* names[]={"Tank","Boomer","Hunter","Smoker","Jockey","Charger","Spitter"};
    const char* plain=name;if(!_strnicmp(plain,"C_",2))plain+=2;else if(!_strnicmp(plain,"C",1)&&_stricmp(plain,"Charger"))++plain;
    for(auto value:names)if(!_stricmp(plain,value))return {1,L4P_MODEL_BONES};
    if(strstr(name,"TerrorPlayer")||strstr(name,"CSPlayer")||!strcmp(name,"C_BasePlayer")||!strcmp(name,"CBasePlayer")){
        int team=0;if(entities.read(&ref,"m_iTeamNum",L4P_FIELD_INT,&team)==L4P_OK&&team==3)return {1,L4P_MODEL_FIELD};}
    return {};
}
}
bool feature_create(HMODULE module){
    auto get=reinterpret_cast<L4P_GetModelApiFn>(GetProcAddress(module,"L4P_GetModelApi"));auto entity=reinterpret_cast<L4P_GetEntityApiFn>(GetProcAddress(module,"L4P_GetEntityApi"));cursor=65;
    return get&&entity&&get(1,&model)==L4P_OK&&entity(1,&entities)==L4P_OK;
}
void feature_end(){model.release(token,nullptr);cursor=65;}
void feature_event(const json&,const L4P_SourceFrameV1*,const char*,void*){cursor=65;}
void feature_tick(const json& config,const L4P_SourceFrameV1* frame,bool changed){
    if(!config["active"].get<bool>()||!source.allowed(frame,kScope)){model.release(token,nullptr);cursor=65;feature_state(config["active"].get<bool>()?"等待本地服":"已关闭，恢复原比例");return;}
    const float si=config["special"].get<float>(),common=config["common"].get<float>();
    if(changed){model.release(token,nullptr);cursor=65;}
    if(std::abs(si-1)<.0001f&&std::abs(common-1)<.0001f){model.release(token,nullptr);feature_state("使用原比例");return;}
    uint32_t failure=0;auto apply=[&](int index){L4P_EntityRefV1 ref{};if(entities.reference(index,&ref)!=L4P_OK)return;
        const auto kind=classify(ref);auto result=kind.category?model.scale(token,&ref,kind.category==1?si:common,kind.method):model.release(token,&ref);if(result!=L4P_OK)failure=result;};
    for(int i=1;i<=64;++i)apply(i);int highest=64;
    if(entities.highest(&highest)==L4P_OK&&highest>=65){if(cursor>highest)cursor=65;const int count=std::min(256,highest-64);
        for(int i=0;i<count;++i){apply(cursor);if(++cursor>highest)cursor=65;}}
    L4P_ModelStatusV1 status{sizeof(status)};model.status(&status);
    feature_state(failure?"部分模型接口暂不可用，保留其原比例":status.leases?"本地服缩放已应用":"等待感染者模型",failure);
}
