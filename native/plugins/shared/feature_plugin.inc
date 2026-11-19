// GPL-3.0. Lifecycle and independent configuration for Source SDK features.
// Consumer declares kId/kVersion/kTitle/kSummary/kScope/kEvents/kFields before
// inclusion, then implements feature_create/tick/event/end below it.
#include "feature_config.hpp"
#include <mutex>
#include <atomic>
#include <cstring>
using nlohmann::json;namespace fs=std::filesystem;
L4P_SourceApiV1 source{1,sizeof(source)};uint32_t token=0;
std::mutex featureMutex;json featureFields,featureSettings;fs::path featureConfigFile;
std::atomic<bool> featureReady{false};bool featureDirty=true;
std::string featureState="等待游戏帧";uint32_t featureCode=L4P_OK;
bool feature_create(HMODULE dependency);
void feature_tick(const json&,const L4P_SourceFrameV1*,bool changed);
void feature_event(const json&,const L4P_SourceFrameV1*,const char*,void*);
void feature_end();
#ifdef L4P_FEATURE_CUSTOM_ACTIONS
uint32_t feature_custom_invoke(const char*,const char*,char*,uint32_t,uint32_t*);
#endif
#ifdef L4P_FEATURE_VALIDATE_FIELDS
bool feature_validate(const json&);
#endif
void feature_state(const char* state,uint32_t code=L4P_OK){std::lock_guard<std::mutex> lock(featureMutex);featureState=state;featureCode=code;}
void L4P_CALL feature_frame_callback(void*,const L4P_SourceFrameV1* frame){
    json config;bool changed;{std::lock_guard<std::mutex> lock(featureMutex);config=featureSettings;changed=featureDirty;featureDirty=false;}feature_tick(config,frame,changed);
}
void L4P_CALL feature_event_callback(void*,const L4P_SourceFrameV1* frame,const char* name,void* event){
    json config;{std::lock_guard<std::mutex> lock(featureMutex);config=featureSettings;}feature_event(config,frame,name,event);
}
void L4P_CALL feature_shutdown(){featureReady=false;if(token){source.unsubscribe(token);feature_end();token=0;}}
uint32_t L4P_CALL feature_init(const L4P_HostApiV1* host){
    if(!host||host->api_version!=1||host->struct_size!=sizeof(*host)||!host->plugin_directory||!host->config_json||featureReady)return L4P_BAD_ARGUMENT;
    try{featureFields=json::parse(kFields);json config;if(!flare_feature::validate(featureFields,json::parse(host->config_json),config))return L4P_BAD_ARGUMENT;
#ifdef L4P_FEATURE_VALIDATE_FIELDS
        if(!feature_validate(config))return L4P_BAD_ARGUMENT;
#endif
        auto dir=fs::u8path(host->plugin_directory);featureConfigFile=dir/L"config.json";
        auto module=GetModuleHandleW((dir.parent_path()/L"beacon.source/plugin.dll").c_str());if(!module)return L4P_ERROR;
        auto get=reinterpret_cast<L4P_GetSourceApiFn>(GetProcAddress(module,"L4P_GetSourceApi"));if(!get||get(1,&source)||!feature_create(module))return L4P_ERROR;
        {std::lock_guard<std::mutex> lock(featureMutex);featureSettings=config;featureDirty=true;featureState="等待游戏帧";featureCode=L4P_OK;}
        if(source.subscribe(kId,kScope,kEvents,nullptr,feature_frame_callback,feature_event_callback,&token)!=L4P_OK){feature_end();return L4P_ERROR;}
        featureReady=true;return L4P_OK;
    }catch(...){feature_shutdown();return L4P_BAD_ARGUMENT;}
}
uint32_t L4P_CALL feature_invoke(const char* action,const char* parameters,char* out,uint32_t capacity,uint32_t* size){
    if(!featureReady||!action||!parameters||!out||!size)return L4P_BAD_ARGUMENT;
#ifdef L4P_FEATURE_CUSTOM_ACTIONS
    if(strcmp(action,"configure")&&strcmp(action,"status"))return feature_custom_invoke(action,parameters,out,capacity,size);
#endif
    try{auto args=json::parse(parameters);bool change=!strcmp(action,"configure");if(!args.is_object()||(!change&&(strcmp(action,"status")||!args.empty())))return L4P_BAD_ARGUMENT;
        std::lock_guard<std::mutex> lock(featureMutex);json next=featureSettings;
        if(change){for(auto& p:args.items())next[p.key()]=p.value();json checked;if(!flare_feature::validate(featureFields,next,checked))return L4P_BAD_ARGUMENT;next=checked;}
#ifdef L4P_FEATURE_VALIDATE_FIELDS
        if(change&&!feature_validate(next))return L4P_BAD_ARGUMENT;
#endif
        auto body=json{{"format","flare.report.v1"},{"title",kTitle},{"summary",change?"设置已保存，下一游戏帧应用":kSummary},{"settings",next},{"sections",json::array({{{"title","运行状态"},{"layout","list"},{"items",json::array({{{"label","状态"},{"value",featureState},{"code",featureCode}}})}}})}}.dump();
        *size=uint32_t(body.size()+1);if(capacity<*size)return L4P_BUFFER_TOO_SMALL;
        if(change){if(!flare_feature::save(featureConfigFile,next))return L4P_ERROR;featureSettings=next;featureDirty=true;}memcpy(out,body.c_str(),*size);return L4P_OK;
    }catch(...){return L4P_BAD_ARGUMENT;}
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetPluginApi(uint32_t version,L4P_PluginApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),kId,kVersion,feature_init,feature_invoke,feature_shutdown};return L4P_OK;
}
