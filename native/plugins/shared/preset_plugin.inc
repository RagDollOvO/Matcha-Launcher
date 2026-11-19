// GPL-3.0. Shared lifecycle for independent numeric-preset DLLs. Each DLL
// compiles only its own definition; the Source service owns shared Cvar leases.
#define NOMINMAX
#include <windows.h>
#include "l4p_cvar.h"
#include "l4p_resource.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <atomic>
#include <cstring>
#include <string>
#include <cmath>
using nlohmann::json;namespace fs=std::filesystem;
namespace {
L4P_SourceApiV1 source{1,sizeof(source)};L4P_CvarApiV1 cvar{1,sizeof(cvar)};
L4P_CvarApiV2 cvar2{2,sizeof(cvar2)};
L4P_ResourceApiV1 resource{1,sizeof(resource)};
uint32_t token=0,localToken=0;std::mutex mutex;std::atomic<bool> ready{false};
json definition,settings,rows=json::array();fs::path configFile;
uint32_t nextAt=0,previousScope=0;bool dirty=true;
bool validate(const json& config,json& result) {
    if(!config.is_object())return false;result=json::object();
    for(auto& p:config.items())if(!definition["fields"].contains(p.key()))return false;
    for(auto& p:definition["fields"].items()){
        const auto& spec=p.value();auto v=config.contains(p.key())?config[p.key()]:spec["default"];
        if(spec["type"]=="boolean") {if(!v.is_boolean())return false;}
        else {if(!v.is_number()||(spec["type"]=="integer"&&!v.is_number_integer()))return false;
            const double n=v.get<double>();if(!std::isfinite(n)||n<spec["minimum"].get<double>()||n>spec["maximum"].get<double>())return false;}
        result[p.key()]=v;
    }return true;
}
void L4P_CALL localFrame(void*,const L4P_SourceFrameV1*){}
void L4P_CALL onFrame(void*,const L4P_SourceFrameV1* f) {
    json config;{std::lock_guard<std::mutex> lock(mutex);
        uint32_t scope=f->connected|(f->in_game<<1)|(f->loading<<2)|(f->local_server<<3);
        if(!dirty&&scope==previousScope&&nextAt&&int32_t(f->time_ms-nextAt)<0)return;
        dirty=false;previousScope=scope;nextAt=f->time_ms+250;config=settings;}
    json report=json::array();bool exclusiveWanted=false;uint32_t exclusiveResult=L4P_OK;
    if(definition.contains("exclusive")){
        const auto& e=definition["exclusive"];exclusiveWanted=config["active"].get<bool>()&&config[e["option"].get<std::string>()].get<bool>();
        if(exclusiveWanted){
            if(e.contains("blockedBy"))for(const auto& name:e["blockedBy"]){char owner[65]{};if(resource.owner(name.get_ref<const std::string&>().c_str(),owner)==L4P_OK&&owner[0]){exclusiveResult=L4P_CVAR_CONFLICT;break;}}
            if(exclusiveResult==L4P_OK)exclusiveResult=resource.claim(definition.value("localOnly",false)?localToken:token,e["name"].get_ref<const std::string&>().c_str());
        }
    }
    for(const auto& entry:definition["entries"]){
        const auto name=entry["name"].get<std::string>();bool wanted=config["active"].get<bool>();
        if(entry.contains("option"))wanted=wanted&&config[entry["option"].get<std::string>()].get<bool>();
        if(entry.contains("any")){bool any=false;for(const auto& option:entry["any"])any=any||config[option.get<std::string>()].get<bool>();wanted=wanted&&any;}
        if(entry.contains("requires")){const auto& v=config[entry["requires"].get<std::string>()];wanted=wanted&&(v.is_boolean()?v.get<bool>():v.get<double>()!=0);}
        float value=entry.contains("setting")?config[entry["setting"].get<std::string>()].get<float>():entry["value"].get<float>();
        if(entry.value("zeroDisables",false)&&value==0)wanted=false;
        const bool local=definition.value("localOnly",false)||entry.value("local",false);
        uint32_t result=L4P_OK;
        if(!wanted){cvar.release(token,name.c_str());cvar.release(localToken,name.c_str());}
        else if(exclusiveWanted&&exclusiveResult!=L4P_OK){cvar.release(token,name.c_str());cvar.release(localToken,name.c_str());result=exclusiveResult;}
        else if(!source.allowed(f,local?L4P_SOURCE_LOCAL:L4P_SOURCE_ANY)){result=L4P_CVAR_SCOPE;}
        else {
            auto pin=entry.value("lock",false)?cvar2.pin_locked:cvar.pin;
            result=pin(local?localToken:token,name.c_str(),value);
            // Engine-restricted rows of a client preset are local-only. Scope is
            // checked again by the service on every frame and native event.
            if(!local && result==L4P_CVAR_SCOPE){cvar.release(token,name.c_str());result=pin(localToken,name.c_str(),value);}
        }
        const char* state=!wanted?"已关闭":result==L4P_OK?(entry.value("lock",false)?"已即时锁定":"已应用"):result==L4P_CVAR_SCOPE?"等待允许的服务器":result==L4P_CVAR_MISSING?"游戏缺少此参数":result==L4P_CVAR_CONFLICT?"由其他模组管理":"设置未生效";
        report.push_back({{"label",name},{"value",state},{"code",result},{"target",value}});
    }
    if(definition.contains("exclusive")&&(!exclusiveWanted||exclusiveResult!=L4P_OK)){resource.release(token,nullptr);resource.release(localToken,nullptr);}
    {std::lock_guard<std::mutex> lock(mutex);rows=std::move(report);}
}
void L4P_CALL shutdown(){ready=false;if(token){source.unsubscribe(token);token=0;}if(localToken){source.unsubscribe(localToken);localToken=0;}}
uint32_t L4P_CALL init(const L4P_HostApiV1* host) {
    if(!host||host->api_version!=1||host->struct_size!=sizeof(*host)||!host->plugin_directory||!host->config_json||ready)return L4P_BAD_ARGUMENT;
    try {
        definition=json::parse(kDefinition);json config;if(!validate(json::parse(host->config_json),config))return L4P_BAD_ARGUMENT;
        auto dir=fs::u8path(host->plugin_directory);configFile=dir/L"config.json";
        auto bridge=dir.parent_path()/L"beacon.source/plugin.dll";auto module=GetModuleHandleW(bridge.c_str());if(!module)return L4P_ERROR;
        auto get=reinterpret_cast<L4P_GetSourceApiFn>(GetProcAddress(module,"L4P_GetSourceApi"));auto getCvar=reinterpret_cast<L4P_GetCvarApiFn>(GetProcAddress(module,"L4P_GetCvarApi"));
        if(!get||!getCvar||get(1,&source)!=L4P_OK||getCvar(1,&cvar)!=L4P_OK)return L4P_ERROR;
        if(definition.value("lockApi",false)){
            auto get2=reinterpret_cast<L4P_GetCvarApiV2Fn>(getCvar);if(get2(2,&cvar2)!=L4P_OK)return L4P_ERROR;}
        if(definition.contains("exclusive")){auto getResource=reinterpret_cast<L4P_GetResourceApiFn>(GetProcAddress(module,"L4P_GetResourceApi"));if(!getResource||getResource(1,&resource)!=L4P_OK)return L4P_ERROR;}
        {std::lock_guard<std::mutex> lock(mutex);settings=config;rows=json::array();nextAt=0;dirty=true;}
        const std::string id=definition["id"], local=id+".local";
        if(source.subscribe(local.c_str(),L4P_SOURCE_LOCAL,"",nullptr,localFrame,nullptr,&localToken)!=L4P_OK)return L4P_ERROR;
        if(source.subscribe(id.c_str(),L4P_SOURCE_ANY,"",nullptr,onFrame,nullptr,&token)!=L4P_OK){source.unsubscribe(localToken);localToken=0;return L4P_ERROR;}
        ready=true;return L4P_OK;
    }catch(...){shutdown();return L4P_BAD_ARGUMENT;}
}
uint32_t L4P_CALL invoke(const char* action,const char* parameters,char* out,uint32_t capacity,uint32_t* size) {
    if(!ready||!action||!parameters||!out||!size)return L4P_BAD_ARGUMENT;
    try {
        auto args=json::parse(parameters);const bool change=!strcmp(action,"configure");
        if(!args.is_object()||(!change&&(strcmp(action,"status")||!args.empty())))return L4P_BAD_ARGUMENT;
        std::lock_guard<std::mutex> lock(mutex);json next=settings;
        if(change){for(auto& p:args.items())next[p.key()]=p.value();json validated;if(!validate(next,validated))return L4P_BAD_ARGUMENT;next=validated;}
        const auto result=json{{"format","flare.report.v1"},{"title",definition["name"]},{"summary",change?"设置已保存，下一游戏帧应用":"游戏参数与独立开关状态"},{"settings",next},{"sections",json::array({{{"title","参数状态"},{"layout","list"},{"items",rows}}})}}.dump();
        *size=uint32_t(result.size()+1);if(capacity<*size)return L4P_BUFFER_TOO_SMALL;
        if(change){auto temp=configFile;temp+=L".pending";{std::ofstream file(temp,std::ios::binary|std::ios::trunc);file<<next.dump(2);file.flush();if(!file)return L4P_ERROR;}
            if(!MoveFileExW(temp.c_str(),configFile.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH))return L4P_ERROR;settings=next;dirty=true;}
        memcpy(out,result.c_str(),*size);return L4P_OK;
    }catch(...){return L4P_BAD_ARGUMENT;}
}
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetPluginApi(uint32_t version,L4P_PluginApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),kPluginId,kPluginVersion,init,invoke,shutdown};return L4P_OK;
}
