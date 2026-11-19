// GPL-3.0. Read-only Steam statistics port. See SOURCE.md for provenance.
#define NOMINMAX
#include <windows.h>
#include "l4p_plugin.h"
#include <nlohmann/json.hpp>
#include <algorithm>
#include <array>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include "catalog.hpp"
using nlohmann::json;
using InterfaceFn = void* (__cdecl*)();
using GetIntFn = bool (__cdecl*)(void*, const char*, int32_t*);
using ReleaseFn = void (__cdecl*)();
static bool initialized = false;
// Beacon serializes invoke and calls shutdown after active control work ends.
struct SteamScope {
    HMODULE module = nullptr;
    ReleaseFn release = nullptr;
    ~SteamScope() { if (release) release(); if (module) FreeLibrary(module); }
};
static json metric(const char* label, const json& value, const char* format = "number", const char* unit = "") {
    return {{"label",label},{"value",value},{"format",format},{"unit",unit}};
}
static json refresh() {
    SteamScope steam;
    std::string reason = "steam-not-loaded";
    GetIntFn read = nullptr; void* stats = nullptr;
    // Hold only an already-loaded library. The game owns Steam initialization and callbacks.
    if (GetModuleHandleExW(0, L"steam_api.dll", &steam.module)) {
        auto iface = reinterpret_cast<InterfaceFn>(GetProcAddress(steam.module,"SteamAPI_SteamUserStats_v012"));
        read = reinterpret_cast<GetIntFn>(GetProcAddress(steam.module,"SteamAPI_ISteamUserStats_GetStatInt32"));
        auto release = reinterpret_cast<ReleaseFn>(GetProcAddress(steam.module,"SteamAPI_ReleaseCurrentThreadMemory"));
        reason = "unsupported-interface";
        if (iface && read && release) {
            steam.release = release; stats = iface(); reason = stats ? "stats-not-ready" : "steam-not-ready";
        }
    }
    int valid = 0, validWeapons = 0;
    auto get = [&](const career::Stat& def) -> json {
        int32_t value = 0;
        if (!stats || !read(stats,def.key,&value) || value < 0) return nullptr;
        ++valid; return value;
    };
    std::array<json,23> values;
    for (size_t i=0;i<values.size();++i) values[i] = get(career::general[i]);
    json allWeapons = json::array();
    std::vector<size_t> ranking;
    for (size_t i=0;i<std::size(career::weapons);++i) {
        auto value = get(career::weapons[i]);
        if (!value.is_null()) { ++validWeapons; if (value.get<int32_t>()>0) ranking.push_back(i); }
        auto item = metric(career::weapons[i].label,value,"number","击杀");
        item["key"] = career::weapons[i].key; allWeapons.push_back(item);
    }
    std::stable_sort(ranking.begin(),ranking.end(),[&](size_t a,size_t b){return allWeapons[a]["value"].get<int32_t>()>allWeapons[b]["value"].get<int32_t>();});
    json top = json::array();
    for (size_t i=0;i<std::min<size_t>(6,ranking.size());++i) top.push_back(allWeapons[ranking[i]]);
    json sections = json::array();
    auto section = [&](const char* title, size_t begin, size_t end, const char* layout) {
        json items = json::array();
        for (size_t i=begin;i<end;++i) {
            auto item = metric(career::general[i].label,values[i],i==0?"duration":"number");
            item["key"] = career::general[i].key; items.push_back(item);
        }
        sections.push_back({{"title",title},{"layout",layout},{"items",items}});
    };
    section("生涯概览",0,4,"metrics");
    json ratio = nullptr, rate = nullptr;
    if (!values[2].is_null() && values[2].get<int32_t>()>0 && !values[3].is_null()) ratio=values[3].get<double>()*100/values[2].get<double>();
    if (!values[0].is_null() && values[0].get<int32_t>()>0 && !values[1].is_null()) rate=values[1].get<double>()*3600/values[0].get<double>();
    sections[0]["items"].push_back(metric("终局 / 参与战役",ratio,"percent"));
    sections[0]["items"].push_back(metric("平均每小时击杀",rate,"number","/ 小时"));
    sections[0]["note"] = "比值使用 Steam 累计计数计算；游玩时间以游戏记录的秒数为准。";
    sections.push_back({{"title","常用武器 · 前 6"},{"layout","list"},{"items",top},
        {"note","已读取 " + std::to_string(validWeapons) + " / 37 项武器统计，按已读取的正数击杀排序；同值沿用原作顺序。"}});
    section("团队协作",4,14,"list");
    section("角色出场",14,18,"list");
    section("模式记录",18,23,"list");
    sections.push_back({{"title","全部武器统计 · 37 项"},{"layout","list"},{"collapsed",true},{"items",allWeapons}});
    SYSTEMTIME utc{}; GetSystemTime(&utc); char timestamp[32];
    std::snprintf(timestamp,sizeof timestamp,"%04u-%02u-%02uT%02u:%02u:%02uZ",utc.wYear,utc.wMonth,utc.wDay,utc.wHour,utc.wMinute,utc.wSecond);
    std::string state = valid==60 ? "ready" : valid ? "partial" : "unavailable";
    std::string summary;
    if (valid) { reason.clear(); summary="已读取 " + std::to_string(valid) + " / 60 项 Steam 累计统计。缺失值显示 —，可稍后刷新。"; }
    else if (reason=="steam-not-loaded") summary="等待游戏加载 Steam。进入游戏后点击刷新。";
    else if (reason=="unsupported-interface") summary="当前 Steam 接口缺少所需导出，请保留版本信息供兼容性检查。";
    else summary="Steam 统计尚未就绪。进入游戏并稍候，再点击刷新。";
    return {{"format","flare.report.v1"},{"title","生涯档案"},{"summary",summary},{"state",state},
        {"reason",reason},{"refreshedAt",timestamp},{"available",valid},{"total",60},{"sections",sections}};
}
static uint32_t L4P_CALL initialize(const L4P_HostApiV1* host) {
    if (initialized || !host || host->api_version!=1 || host->struct_size!=sizeof(*host) || !host->log || !host->plugin_directory || !host->config_json) return L4P_BAD_ARGUMENT;
    try { auto config=json::parse(host->config_json); if (!config.is_object() || !config.empty()) return L4P_BAD_ARGUMENT; }
    catch (...) { return L4P_BAD_ARGUMENT; }
    initialized=true; host->log(host->context,L4P_LOG_INFO,"Career archive ready; Steam cached stats are read on explicit refresh only"); return L4P_OK;
}
static void L4P_CALL shutdown() { initialized=false; }
static uint32_t L4P_CALL invoke(const char* action,const char* params,char* output,uint32_t capacity,uint32_t* size) {
    if (!initialized || !action || !params || !output || !size || std::strcmp(action,"refresh")) return L4P_BAD_ARGUMENT;
    try {
        auto args=json::parse(params); if (!args.is_object() || !args.empty()) return L4P_BAD_ARGUMENT;
        auto result=refresh().dump(); *size=uint32_t(result.size()+1);
        if (capacity<*size) return L4P_BUFFER_TOO_SMALL;
        std::memcpy(output,result.c_str(),*size); return L4P_OK;
    } catch (...) { return L4P_ERROR; }
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetPluginApi(uint32_t version,L4P_PluginApiV1* output) {
    if (version!=1) return L4P_UNSUPPORTED_VERSION;
    if (!output || output->api_version!=1 || output->struct_size!=sizeof(*output)) return L4P_BAD_ARGUMENT;
    *output={1,sizeof(*output),"skeeto.career","0.1.0",initialize,invoke,shutdown}; return L4P_OK;
}
