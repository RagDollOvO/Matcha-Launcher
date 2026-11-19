// GPL-3.0. ClientUxFilterAddonBits from Skeeto 2.2.19.
#define NOMINMAX
#include <windows.h>
#include "l4p_addons.h"
#include "definition.hpp"
static constexpr char kId[]="skeeto.hide-back-items",kVersion[]="0.1.0",kTitle[]="隐藏背部挂件",kSummary[]="按分类隐藏背部物品，保留手持物和游戏库存";
static constexpr uint32_t kScope=L4P_SOURCE_ANY;static constexpr char kEvents[]="";
#include "feature_plugin.inc"
namespace {
L4P_AddonApiV1 addons{1,sizeof(addons)};std::atomic<uint32_t> options{0};bool listening=false;
uint32_t L4P_CALL filter(void*,int32_t team,uint32_t bits,const int32_t* weapons){
    const auto config=options.load(std::memory_order_relaxed);if(config&8)bits&=~(1u<<5);if(team!=2)return bits;
    if(config&2)bits&=~(1u<<6);
    for(int i=0;i<5;++i){uint32_t category=0;switch(weapons[i]){case 15:case 23:category=1;break;case 12:case 24:category=2;break;case 13:case 14:case 25:category=4;break;default:break;}
        if(config&category)bits&=~(1u<<i);}
    return bits;
}
void stop(){options=0;if(listening){addons.clear_filter(token);listening=false;}}
}
bool feature_create(HMODULE m){auto get=reinterpret_cast<L4P_GetAddonApiFn>(GetProcAddress(m,"L4P_GetAddonApi"));listening=false;options=0;return get&&get(1,&addons)==L4P_OK;}
void feature_end(){stop();}
void feature_event(const json&,const L4P_SourceFrameV1*,const char*,void*){}
void feature_tick(const json& config,const L4P_SourceFrameV1* f,bool){
    uint32_t wanted=0;if(config["medicine"].get<bool>())wanted|=1;if(config["medical"].get<bool>())wanted|=2;if(config["throwables"].get<bool>())wanted|=4;if(config["tongue"].get<bool>())wanted|=8;
    if(!config["active"].get<bool>()||!wanted){stop();feature_state("已关闭或未选择隐藏分类");return;}
    if(!source.allowed(f,kScope)){stop();feature_state("等待进入对局",6);return;}options=wanted;
    if(!listening){auto result=addons.set_filter(token,nullptr,filter);if(result!=L4P_OK){feature_state("等待挂件接口",result);return;}listening=true;}
    L4P_AddonStatusV1 status{sizeof(status)};addons.status(&status);
    feature_state(status.state==2?"正在按分类隐藏挂件":status.state>=3?"挂件入口状态变化，已保留原版显示":"等待挂件更新入口",status.state>=3?L4P_ERROR:L4P_OK);
}
