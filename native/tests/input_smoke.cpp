#define NOMINMAX
#include <windows.h>
#include "l4p_input.h"
#include "owned_input.hpp"
#include <filesystem>
#include <iostream>
#include <stdexcept>
namespace fs=std::filesystem;
void require(bool value,const char* why){if(!value)throw std::runtime_error(why);}
template<class T>T sym(HMODULE h,const char* name){auto p=reinterpret_cast<T>(GetProcAddress(h,name));require(p,name);return p;}
void L4P_CALL log(void*,uint32_t,const char*){}
L4P_InputApiV1 input{1,sizeof(input)};uint32_t local=0,other=0,any=0,owner=0,result=0;int frames=0,op=0;const char* command="+reload";
L4P_InputStateV1 state{sizeof(state)};L4P_BindingV1 binding{sizeof(binding)};
void L4P_CALL frame(void*,const L4P_SourceFrameV1*){++frames;if(op==1)result=input.press(owner,command);if(op==2)result=input.binding(command,&binding);input.snapshot(&state);}
void L4P_CALL noop(void*,const L4P_SourceFrameV1*){}
int wmain(int argc,wchar_t** argv){try{
    require(argc==4,"input_smoke <Source DLL> <fake engine dir> <fresh root>");fs::path root=fs::absolute(argv[3]);require(!fs::exists(root),"fresh root");fs::create_directories(root);fs::copy_file(argv[1],root/L"plugin.dll");
    auto load=[](fs::path p){auto h=LoadLibraryExW(fs::absolute(p).c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(h,"DLL load");return h;};
    auto engine=load(fs::path(argv[2])/L"engine.dll"),module=load(root/L"plugin.dll");owned_input::isolate(module);
    auto mode=sym<void(__cdecl*)(int)>(engine,"FixtureMode");auto paint=sym<void(__cdecl*)()>(engine,"FixturePaint");auto view=sym<void(__cdecl*)(int,float,float,float)>(engine,"FixtureView");auto bind=sym<void(__cdecl*)(const char*,const char*)>(engine,"FixtureBinding");mode(1);
    L4P_PluginApiV1 plugin{1,sizeof(plugin)};sym<L4P_GetPluginApiFn>(module,"L4P_GetPluginApi")(1,&plugin);auto dir=root.u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,dir.c_str(),"{}"};require(!plugin.init(&host),"init");
    L4P_SourceApiV1 source{1,sizeof(source)};sym<L4P_GetSourceApiFn>(module,"L4P_GetSourceApi")(1,&source);require(!sym<L4P_GetInputApiFn>(module,"L4P_GetInputApi")(1,&input),"Input API");
    source.subscribe("fixture.input",0,"",nullptr,frame,nullptr,&any);source.subscribe("fixture.input.local",1,"",nullptr,noop,nullptr,&local);source.subscribe("fixture.input.other",1,"",nullptr,noop,nullptr,&other);
    for(int n=0;n<100&&!frames;++n){Sleep(20);paint();}require(frames,"Paint ready");auto run=[&](int action){op=action;paint();op=0;return result;};
    using namespace owned_input;owner=local;require(run(2)==0&&!strcmp(binding.key,"r")&&!binding.held,"engine lookup binding slot 22");
    require(run(1)==0&&events.size()==1&&events.back().type==INPUT_KEYBOARD&&events.back().ki.wScan==MapVirtualKeyA('R',MAPVK_VK_TO_VSC)&&events.back().ki.dwFlags==KEYEVENTF_SCANCODE,"scan-code keyboard edge");
    run(1);require(events.size()==1,"idempotent held edge");owner=other;require(run(1)==L4P_INPUT_CONFLICT&&events.size()==1,"shared key owner");owner=any;require(run(1)==L4P_INPUT_SCOPE,"ANY cannot press");
    require(input.release(0)==L4P_BAD_ARGUMENT&&events.size()==1,"zero token preserves others");bind("+reload","MOUSE4");require(input.release(local)==0&&events.back().type==INPUT_KEYBOARD&&(events.back().ki.dwFlags&KEYEVENTF_KEYUP),"release uses captured key after rebind");
    owner=local;for(int i=1;i<=5;++i){auto name=std::string("MOUSE")+std::to_string(i);bind("+reload",name.c_str());require(run(1)==0,"mouse bind press");auto down=events.back();require(down.type==INPUT_MOUSE,"mouse input type");input.release(local);auto up=events.back();
        const DWORD downs[]={MOUSEEVENTF_LEFTDOWN,MOUSEEVENTF_RIGHTDOWN,MOUSEEVENTF_MIDDLEDOWN,MOUSEEVENTF_XDOWN,MOUSEEVENTF_XDOWN},ups[]={MOUSEEVENTF_LEFTUP,MOUSEEVENTF_RIGHTUP,MOUSEEVENTF_MIDDLEUP,MOUSEEVENTF_XUP,MOUSEEVENTF_XUP};
        require(down.mi.dwFlags==downs[i-1]&&up.mi.dwFlags==ups[i-1]&&(i<4||(down.mi.mouseData==DWORD(i==4?XBUTTON1:XBUTTON2)&&up.mi.mouseData==down.mi.mouseData)),"all mouse edges and X button payload");}
    for(const char* name:{"KP_ENTER","RCTRL","UPARROW","KP_SLASH"}){bind("+reload",name);require(run(1)==0,"extended bind press");require((events.back().ki.dwFlags&(KEYEVENTF_SCANCODE|KEYEVENTF_EXTENDEDKEY))==(KEYEVENTF_SCANCODE|KEYEVENTF_EXTENDEDKEY),"extended scan flag");input.release(local);}
    bind("+reload","r");held['R']=true;auto before=events.size();require(run(1)==L4P_INPUT_HELD&&events.size()==before,"user-held key preserved");require(run(2)==0&&binding.held,"held state");held.clear();
    bind("+reload","");require(run(1)==L4P_INPUT_MISSING&&events.size()==before,"unbound reload silent");bind("+reload","MWHEELUP");require(run(1)==L4P_INPUT_MISSING,"unsupported wheel bind silent");
    command="+attack";bind(command,"");require(run(2)==0&&!strcmp(binding.key,"MOUSE1"),"attack read fallback");require(run(1)==L4P_INPUT_MISSING,"press requires actual bind");command="exec";require(run(1)==L4P_BAD_ARGUMENT&&run(2)==L4P_BAD_ARGUMENT,"bounded commands");command="+reload";bind(command,"r");
    foreground=false;require(run(1)==L4P_INPUT_SCOPE&&events.size()==before,"other app no event");foreground=true;view(1,0,0,0);require(run(1)==L4P_INPUT_SCOPE,"menu no event");view(0,0,0,0);
    for(int stage:{0,2,3}){mode(stage);require(run(1)==L4P_INPUT_SCOPE,"connection/local/loading gates");}mode(1);
    require(run(1)==0,"press before focus loss");foreground=false;paint();require(!state.owned&&(events.back().ki.dwFlags&KEYEVENTF_KEYUP),"focus exit releases once");before=events.size();paint();require(events.size()==before,"idle off path silent");foreground=true;
    run(1);view(1,0,0,0);paint();require(!state.owned,"UI exit restores");view(0,0,0,0);run(1);mode(2);paint();require(!state.owned,"scope exit restores");mode(1);
    rejected=1;before=events.size();require(run(1)==L4P_ERROR&&!state.owned&&events.size()==before,"refused press leaves no lease");run(1);rejected=1;require(input.release(local)==L4P_ERROR,"refused release reported");paint();require(!state.owned&&(events.back().ki.dwFlags&KEYEVENTF_KEYUP),"failed release retried");
    run(1);source.unsubscribe(local);require(events.back().ki.dwFlags&KEYEVENTF_KEYUP,"unsubscribe releases immediately");source.subscribe("fixture.input.shutdown",1,"",nullptr,noop,nullptr,&local);owner=local;run(1);
    require(input.press(local,"+reload")==L4P_BAD_ARGUMENT&&input.snapshot(&state)==L4P_BAD_ARGUMENT,"press and snapshot callback-only");before=events.size();plugin.shutdown();require(events.size()==before+1&&(events.back().ki.dwFlags&KEYEVENTF_KEYUP),"shutdown releases without further Paint");
    std::cout<<"PASS: isolated native input ABI, bind mapping, key ownership, scope/UI/focus, failures, rebind and shutdown; zero desktop input\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
