#define NOMINMAX
#include <windows.h>
#include "l4p_plugin.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <vector>
#include <stdexcept>
using nlohmann::json;
static void require(bool ok,const char* why) { if(!ok) throw std::runtime_error(why); }
static void L4P_CALL log(void*,uint32_t,const char*) {}
int wmain(int argc,wchar_t** argv) {
    try {
        require(argc==4,"Usage: career_smoke <plugin.dll> <fake steam_api.dll> <output.json>");
        auto module=LoadLibraryExW(std::filesystem::absolute(argv[1]).c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);
        require(module,"Plugin load failed");
        auto entry=reinterpret_cast<L4P_GetPluginApiFn>(GetProcAddress(module,"L4P_GetPluginApi")); require(entry,"ABI export missing");
        L4P_PluginApiV1 api{1,sizeof(api)};
        require(entry(2,&api)==L4P_UNSUPPORTED_VERSION,"Version validation");
        require(entry(1,&api)==L4P_OK && std::string(api.id)=="skeeto.career","API identity");
        L4P_HostApiV1 host{1,sizeof(host),nullptr,log,".","{}"};
        require(api.init(&host)==L4P_OK,"Initialize without Steam");
        require(api.init(&host)==L4P_BAD_ARGUMENT,"Duplicate init");
        std::vector<char> buffer(256*1024); uint32_t size=0;
        auto refresh=[&]() { require(api.invoke("refresh","{}",buffer.data(),uint32_t(buffer.size()),&size)==L4P_OK,"Refresh failed"); require(size>0 && size<=buffer.size(),"Output size"); return json::parse(buffer.data()); };
        require(refresh()["reason"]=="steam-not-loaded","Missing Steam state");
        auto fake=LoadLibraryExW(std::filesystem::absolute(argv[2]).c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32); require(fake,"Fake Steam load failed");
        auto set=reinterpret_cast<void(__cdecl*)(int)>(GetProcAddress(fake,"FixtureSetMode"));
        auto count=reinterpret_cast<int(__cdecl*)(int)>(GetProcAddress(fake,"FixtureCount")); require(set && count,"Fixture exports");
        set(0); auto full=refresh();
        require(full["state"]=="ready" && full["available"]==60 && count(0)==60 && count(2)==0,"Complete exact-key read");
        require(full["sections"][0]["items"][4]["value"]==75 && full["sections"][0]["items"][5]["value"]==21000,"Derived units");
        require(full["sections"][2]["items"][0]["value"]==0,"Valid zero lost");
        require(full["sections"][1]["items"].size()==6 && full["sections"][1]["items"][0]["label"]=="手枪" && full["sections"][1]["items"][1]["label"]=="马格南","Stable top six");
        require(full["sections"][5]["items"].size()==37 && count(1)==1,"Weapon count / thread memory release");
        std::ofstream(std::filesystem::path(argv[3]),std::ios::binary)<<full.dump(2);
        char tiny='!'; require(api.invoke("refresh","{}",&tiny,1,&size)==L4P_BUFFER_TOO_SMALL && tiny=='!' && size>1,"Small buffer overwritten");
        set(1); auto partial=refresh(); require(partial["state"]=="partial" && partial["available"]==58 && partial["sections"][2]["items"][1]["value"].is_null() && partial["sections"][2]["items"][2]["value"].is_null(),"Missing / negative values");
        set(2); require(refresh()["reason"]=="stats-not-ready","Unavailable stats");
        set(3); require(refresh()["reason"]=="steam-not-ready" && count(0)==0,"Null interface");
        set(4); auto zero=refresh(); require(zero["state"]=="ready" && zero["sections"][0]["items"][4]["value"].is_null() && zero["sections"][1]["items"].empty(),"Zero denominator / empty rank");
        require(api.invoke("unknown","{}",buffer.data(),uint32_t(buffer.size()),&size)==L4P_BAD_ARGUMENT,"Unknown action");
        require(api.invoke("refresh","{\"extra\":1}",buffer.data(),uint32_t(buffer.size()),&size)==L4P_BAD_ARGUMENT,"Unknown argument");
        require(api.invoke("refresh","[]",buffer.data(),uint32_t(buffer.size()),&size)==L4P_BAD_ARGUMENT,"Array argument");
        FreeLibrary(fake); require(refresh()["reason"]=="steam-not-loaded","Module reference leak");
        api.shutdown(); require(api.invoke("refresh","{}",buffer.data(),uint32_t(buffer.size()),&size)==L4P_BAD_ARGUMENT,"Invoke after shutdown");
        require(api.init(&host)==L4P_OK,"Reinitialize"); api.shutdown(); FreeLibrary(module);
        std::cout<<"PASS: career x86 DLL; 60 fields, partial/missing/zero, rankings, lifecycle, read-only fixture\n";
        return 0;
    } catch(const std::exception& e) { std::cerr<<"FAIL: "<<e.what()<<'\n'; return 1; }
}
