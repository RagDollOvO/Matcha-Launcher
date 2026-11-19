#include "common.hpp"
#include "l4p_runtime.h"
#include <nlohmann/json.hpp>
#include <iostream>
using json=nlohmann::json;
void check(bool ok,const char* message) { if(!ok) throw std::runtime_error(message); }
json request(json value) {
    auto name=L"\\\\.\\pipe\\l4p."+std::to_wstring(GetCurrentProcessId());
    HANDLE h=INVALID_HANDLE_VALUE;
    for(int i=0;i<100 && h==INVALID_HANDLE_VALUE;++i) {
        h=CreateFileW(name.c_str(),GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,0,nullptr);
        if(h==INVALID_HANDLE_VALUE) Sleep(10);
    }
    l4p::Handle pipe(h); check(h!=INVALID_HANDLE_VALUE,"pipe unavailable");
    auto line=value.dump()+"\n"; DWORD count; check(WriteFile(h,line.data(),DWORD(line.size()),&count,nullptr),"pipe write");
    std::string response; char bytes[2048];
    while(response.find('\n')==std::string::npos) { check(ReadFile(h,bytes,sizeof(bytes),&count,nullptr)&&count,"pipe read"); response.append(bytes,count); }
    return json::parse(response);
}
int wmain(int argc,wchar_t** argv) {
    try {
        check(argc==3,"Usage: release_smoke <runtime-root> <allow|reject>");
        auto root=std::filesystem::absolute(argv[1]); bool allow=std::wstring(argv[2])==L"allow";
        auto module=l4p::load(root/L"l4p_runtime.dll"); check(module,"runtime load");
        auto init=reinterpret_cast<L4P_RuntimeInitializeFn>(GetProcAddress(module,"L4P_RuntimeInitialize"));
        auto stop=reinterpret_cast<L4P_RuntimeShutdownFn>(GetProcAddress(module,"L4P_RuntimeShutdown"));
        check(init && stop && init(root.c_str())==0,"runtime init");
        auto status=request({{"id","status"},{"type","status"}}).at("result");
        auto p=status.at("plugins").at(0); check(p.at("state")== (allow?"initialized":"failed"),"unexpected plugin state");
        json output={{"status",status},{"pluginMapped",GetModuleHandleW(L"plugin.dll")!=nullptr}};
        if(allow) {
            auto hello=request({{"id","hello"},{"type","invoke"},{"pluginId","demo.hello"},{"actionId","hello"},{"params",{{"name","Beacon"}}}});
            check(hello.at("ok")==true && hello.at("result").at("message")=="Hello, Beacon!","hello action"); output["hello"]=hello;
            // Writes/deletes of verified DLLs are denied while the gate is alive.
            l4p::Handle writer(CreateFileW((root/L"plugins/demo.hello/plugin.dll").c_str(),GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,0,nullptr));
            check(writer.value==INVALID_HANDLE_VALUE,"payload write lock missing"); output["payloadWriteDenied"]=true;
        } else check(!GetModuleHandleW(L"plugin.dll"),"rejected DLL executed before gate");
        stop(); std::cout << output.dump() << '\n'; return 0;
    } catch(const std::exception& e) { std::cerr<<e.what()<<'\n'; return 1; }
}
