// GPL-3.0. Independent 17-category mixer. Classification is extracted verbatim
// from Skeeto 2.2.19; sound hook ownership belongs to the Beacon Sound SDK.
#define NOMINMAX
#include <windows.h>
#include "l4p_sound.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <atomic>
#include <array>
#include <cstring>
#include <cmath>
#include <algorithm>
#include "classifier.hpp"
using nlohmann::json;namespace fs=std::filesystem;
namespace {
constexpr const char* ids[]={"gunfire","weapon_handling","melee","chainsaw","footsteps","survivor_voice","special_infected","common_infected","tank","witch","explosions","throwables","ambient","ui","vehicles","items","script_cue"};
constexpr const char* labels[]={"枪声","换弹与武器操作","近战与推击","电锯","脚步","幸存者语音","特殊感染者","普通感染者","Tank","Witch","爆炸","投掷物","环境","界面与按钮","载具","道具","脚本提示音"};
static_assert(int(SoundVolumeGroup::ScriptCue)==17,"category order");
L4P_SourceApiV1 source{1,sizeof(source)};L4P_SoundApiV1 sound{1,sizeof(sound)};
std::array<std::atomic<int>,17> gains;std::atomic<bool> ready{false},active{false},wanted{false};
std::mutex mutex;json settings;fs::path configFile;uint32_t token=0;bool subscribed=false;
bool validate(const json& input,json& result){
    if(!input.is_object())return false;result={{"active",true}};for(const auto* id:ids)result[id]=100;
    for(auto& p:input.items()){
        if(!result.contains(p.key()))return false;
        if(p.key()=="active"){if(!p.value().is_boolean())return false;}
        else if(!p.value().is_number_integer()||p.value().get<int64_t>()<0||p.value().get<int64_t>()>100)return false;
        result[p.key()]=p.value();
    }return true;
}
void publish(const json& next){
    bool altered=false;for(size_t i=0;i<17;++i){int n=next[ids[i]].get<int>();gains[i].store(n,std::memory_order_relaxed);altered|=n!=100;}
    active.store(next["active"].get<bool>(),std::memory_order_release);wanted.store(altered&&next["active"].get<bool>(),std::memory_order_release);
}
float L4P_CALL filter(void*,const char* sample,float volume){
    if(!active.load(std::memory_order_acquire))return volume;
    const auto group=ClassifySoundVolumeSample(sample);if(group==SoundVolumeGroup::None)return volume;
    const int percent=gains[size_t(group)-1].load(std::memory_order_relaxed);if(percent==100)return volume;
    return std::clamp(volume*float(percent)/100.f,0.f,1.f);
}
void L4P_CALL frame(void*,const L4P_SourceFrameV1*){
    bool need=wanted.load(std::memory_order_acquire);if(need==subscribed)return;
    if(need){if(sound.set_filter(token,nullptr,filter)==L4P_OK)subscribed=true;}
    else {sound.clear_filter(token);subscribed=false;}
}
void L4P_CALL shutdown(){ready=false;active=false;wanted=false;if(token){source.unsubscribe(token);token=0;}subscribed=false;}
uint32_t L4P_CALL init(const L4P_HostApiV1* host){
    if(!host||host->api_version!=1||host->struct_size!=sizeof(*host)||!host->plugin_directory||!host->config_json||ready)return L4P_BAD_ARGUMENT;
    try{json config;if(!validate(json::parse(host->config_json),config))return L4P_BAD_ARGUMENT;
        auto dir=fs::u8path(host->plugin_directory);configFile=dir/L"config.json";
        auto module=GetModuleHandleW((dir.parent_path()/L"beacon.source/plugin.dll").c_str());if(!module)return L4P_ERROR;
        auto get=reinterpret_cast<L4P_GetSourceApiFn>(GetProcAddress(module,"L4P_GetSourceApi"));auto getSound=reinterpret_cast<L4P_GetSoundApiFn>(GetProcAddress(module,"L4P_GetSoundApi"));
        if(!get||get(1,&source)!=L4P_OK||!getSound||getSound(1,&sound)!=L4P_OK)return L4P_ERROR;
        {std::lock_guard<std::mutex> lock(mutex);settings=config;publish(settings);}
        if(source.subscribe("skeeto.volume-mixer",L4P_SOURCE_ANY,"",nullptr,frame,nullptr,&token)!=L4P_OK)return L4P_ERROR;
        ready=true;return L4P_OK;
    }catch(...){shutdown();return L4P_BAD_ARGUMENT;}
}
uint32_t L4P_CALL invoke(const char* action,const char* parameters,char* out,uint32_t capacity,uint32_t* size){
    if(!ready||!action||!parameters||!out||!size)return L4P_BAD_ARGUMENT;
    try{auto args=json::parse(parameters);const bool change=!strcmp(action,"configure");
        if(!args.is_object()||(!change&&(strcmp(action,"status")||!args.empty())))return L4P_BAD_ARGUMENT;
        std::lock_guard<std::mutex> lock(mutex);json next=settings;
        if(change){for(auto& p:args.items())next[p.key()]=p.value();json checked;if(!validate(next,checked))return L4P_BAD_ARGUMENT;next=checked;}
        L4P_SoundStatusV1 status{sizeof(status)};if(sound.status(&status)!=L4P_OK)return L4P_ERROR;
        const char* states[]={"原始音量","等待游戏帧","已接入声音入口","游戏声音签名未匹配","声音 Hook 操作失败","声音入口已被其他模组修改"};
        json rows=json::array();for(size_t i=0;i<17;++i)rows.push_back({{"label",labels[i]},{"value",next[ids[i]]},{"unit","%"}});
        const auto body=json{{"format","flare.report.v1"},{"title","分类音量"},{"summary",change?"设置已保存，分类音量即时更新；入口开关在下一游戏帧应用":"17 类音量独立调整，未分类声音沿用原值"},{"settings",next},{"sections",json::array({
            {{"title","声音入口"},{"layout","list"},{"items",json::array({{{"label","连接状态"},{"value",states[std::min(status.state,5u)]}},{{"label","经过的声音"},{"value",status.sounds}},{{"label","已调整"},{"value",status.modified}},{{"label","未解析音名"},{"value",status.unresolved_names}},{{"label","回调错误"},{"value",status.callback_errors}}})}},
            {{"title","分类音量"},{"layout","list"},{"items",rows}}
        })}}.dump();
        *size=uint32_t(body.size()+1);if(capacity<*size)return L4P_BUFFER_TOO_SMALL;
        if(change){auto temp=configFile;temp+=L".pending";{std::ofstream file(temp,std::ios::binary|std::ios::trunc);file<<next.dump(2);file.flush();if(!file)return L4P_ERROR;}
            if(!MoveFileExW(temp.c_str(),configFile.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH))return L4P_ERROR;settings=next;publish(settings);}
        memcpy(out,body.c_str(),*size);return L4P_OK;
    }catch(...){return L4P_BAD_ARGUMENT;}
}
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetPluginApi(uint32_t version,L4P_PluginApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),"skeeto.volume-mixer","0.1.1",init,invoke,shutdown};return L4P_OK;
}
