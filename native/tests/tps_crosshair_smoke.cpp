#define NOMINMAX
#include <windows.h>
#include "l4p_view.h"
#include "l4p_resource.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <vector>
#include <cmath>
namespace fs=std::filesystem;using nlohmann::json;
void require(bool b,const char* s){if(!b)throw std::runtime_error(s);}
void L4P_CALL log(void*,uint32_t,const char*){}
template<class T>T symbol(HMODULE m,const char* n){auto fn=reinterpret_cast<T>(GetProcAddress(m,n));require(fn,n);return fn;}
L4P_ViewApiV1 view{1,sizeof(view)};L4P_ResourceApiV1 resource{1,sizeof(resource)};L4P_ViewV1 current{sizeof(current)};uint32_t token=0;bool hide=false;int calls=0;
void L4P_CALL onFrame(void*,const L4P_SourceFrameV1*){++calls;view.snapshot(&current);if(hide)resource.claim(token,"skeeto.crosshair.hide-all");else resource.release(token,nullptr);}
struct Counts{int begins,ends,pushes,pops,flushes,shapes,texts,textures,errors,root;};
int wmain(int argc,wchar_t** argv){try{
    require(argc==4,"tps_crosshair_smoke <dist plugins> <fixture DLL directory> <fresh output>");fs::path dist=fs::absolute(argv[1]),fake=fs::absolute(argv[2]),root=fs::absolute(argv[3]);require(!fs::exists(root),"fresh root");
    auto loadDll=[](const fs::path& path){auto h=LoadLibraryExW(path.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(h,"load DLL");return h;};
    auto engine=loadDll(fake/L"engine.dll");loadDll(fake/L"client.dll");auto vars=loadDll(fake/L"vstdlib.dll"),surface=loadDll(fake/L"vguimatsurface.dll");
    auto paint=symbol<void(__cdecl*)()>(engine,"FixturePaint");auto paintMode=symbol<void(__cdecl*)(int)>(engine,"FixturePaintMode");auto mode=symbol<void(__cdecl*)(int)>(engine,"FixtureMode");auto setView=symbol<void(__cdecl*)(int,float,float,float)>(engine,"FixtureView");auto event=symbol<void(__cdecl*)(const char*)>(engine,"FixtureEvent");
    auto traceTarget=symbol<void(__cdecl*)(int,float,float,float)>(engine,"FixtureTraceTarget");auto traceCalls=symbol<int(__cdecl*)()>(engine,"FixtureTraceCalls");auto segment=symbol<int(__cdecl*)(float*)>(engine,"FixtureTraceSegment");
    auto set=symbol<void(__cdecl*)(const char*,float,int)>(vars,"FixtureSet");auto value=symbol<float(__cdecl*)(const char*)>(vars,"FixtureValue");
    auto getCounts=symbol<void(__cdecl*)(void*)>(surface,"FixtureDrawCounts");auto counts=[&](){Counts c{};getCounts(&c);return c;};auto clear=symbol<void(__cdecl*)()>(surface,"FixtureDrawClear");auto pixel=symbol<unsigned long(__cdecl*)(int,int)>(surface,"FixtureDrawPixel");auto save=symbol<int(__cdecl*)(const wchar_t*)>(surface,"FixtureDrawSave");
    auto load=[&](const wchar_t* id){auto dir=root/L"bin/l4p/plugins"/id;fs::create_directories(dir);fs::copy_file(dist/id/L"plugin.dll",dir/L"plugin.dll");auto h=loadDll(dir/L"plugin.dll");L4P_PluginApiV1 api{1,sizeof(api)};require(symbol<L4P_GetPluginApiFn>(h,"L4P_GetPluginApi")(1,&api)==L4P_OK,"plugin API");return std::make_pair(h,api);};
    auto bridge=load(L"beacon.source");std::string directory=(root/L"bin/l4p/plugins/beacon.source").u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,directory.c_str(),"{}"};require(bridge.second.init(&host)==L4P_OK,"Source init");
    L4P_SourceApiV1 source{1,sizeof(source)};require(symbol<L4P_GetSourceApiFn>(bridge.first,"L4P_GetSourceApi")(1,&source)==L4P_OK,"Source API");require(symbol<L4P_GetViewApiFn>(bridge.first,"L4P_GetViewApi")(1,&view)==L4P_OK,"View API");require(symbol<L4P_GetResourceApiFn>(bridge.first,"L4P_GetResourceApi")(1,&resource)==L4P_OK,"Resource API");
    source.subscribe("fixture.visibility",0,"",nullptr,onFrame,nullptr,&token);mode(1);for(int i=0;i<100&&!calls;++i){Sleep(20);paint();}require(calls,"hook connected");
    auto plugin=load(L"skeeto.crosshair-tps");directory=(root/L"bin/l4p/plugins/skeeto.crosshair-tps").u8string();host.plugin_directory=directory.c_str();require(plugin.second.init(&host)==L4P_OK,"TPS init");
    set("crosshair",1,0);set("c_thirdpersonshoulder",0,0);paint();require(!traceCalls(),"first person cheap path");
    set("c_thirdpersonshoulder",1,0);setView(0,30,60,0);traceTarget(1,0,0,0);clear();paint();require(counts().shapes>0&&value("crosshair")==0,"marker and stock ownership");
    float ray[6]{};require(segment(ray),"MASK_SHOT/local skip");require(std::abs(ray[0]-10)<.01f&&std::abs(ray[1]-20)<.01f&&std::abs(ray[2]-92)<.01f,"actual eye");
    require(std::abs(ray[3]-(10+8192*.4330127f))<.1f&&std::abs(ray[4]-(20+8192*.75f))<.1f&&std::abs(ray[5]-(92-4096))<.1f,"8192 forward ray native viewangles");
    require(current.paint_mode==2&&current.angles_valid&&current.angles[1]==60,"native View ABI");
    std::vector<char> output(65536);uint32_t size=0;auto configure=[&](const json& args){auto text=args.dump();return plugin.second.invoke("configure",text.c_str(),output.data(),output.size(),&size);};
    clear();for(int style=0;style<4;++style){require(configure({{"style",style},{"size",320},{"opacity",100}})==L4P_OK,"style settings");traceTarget(1,-.6f+.4f*style,0,0);paint();}require(save((root/L"four-styles.bmp").c_str()),"style render");
    require(configure({{"style",2},{"size",100}})==L4P_OK,"dot");traceTarget(1,0,0,0);
    const unsigned long colors[]={RGB(255,255,255),RGB(0,255,0),RGB(0,255,255),RGB(255,40,40),RGB(255,220,0),RGB(255,140,0),RGB(255,80,180),RGB(80,140,255),RGB(180,255,0),RGB(0,200,120)};
    for(int i=0;i<10;++i){configure({{"color",i}});clear();paint();require(pixel(481,321)==colors[i],"original ten-color palette");}
    auto before=counts().shapes;paintMode(1);require(counts().shapes==before&&current.paint_mode==1,"UI-only pass not duplicated");paintMode(3);require(counts().shapes>before,"combined pass draws");
    setView(1,0,0,0);before=counts().shapes;paint();require(counts().shapes==before&&value("crosshair")==1,"menu hide and restore");setView(0,0,0,0);paint();require(value("crosshair")==0,"menu resume");
    hide=true;paint();require(value("crosshair")==1,"shared visibility hide");hide=false;paint();require(value("crosshair")==0,"visibility released");
    traceTarget(1,100,0,0);before=counts().shapes;paint();require(counts().shapes==before&&value("crosshair")==1,"offscreen preserves stock");traceTarget(1,0,0,0);paint();
    mode(3);paint();require(value("crosshair")==1,"loading restore");mode(1);before=counts().shapes;paint();require(counts().shapes==before,"loading 500ms hold");Sleep(510);paint();require(value("crosshair")==0,"loading resumes");
    event("round_end");paint();require(value("crosshair")==1,"round boundary restore");event("round_start");paint();require(value("crosshair")==1,"2800ms boundary hold");Sleep(2810);paint();require(value("crosshair")==0,"round resumed");
    event("finale_win");Sleep(20);paint();require(value("crosshair")==1,"postmission quiet");event("server_spawn");paint();require(value("crosshair")==0,"map quiet cleared");
    require(configure({{"size",321}})==L4P_BAD_ARGUMENT&&configure({{"color",10}})==L4P_BAD_ARGUMENT,"bounds");char tiny='!';require(plugin.second.invoke("configure","{\"active\":false}",&tiny,1,&size)==L4P_BUFFER_TOO_SMALL,"capacity first");paint();require(value("crosshair")==0,"no tiny-buffer write");
    configure({{"active",false}});before=counts().shapes;paint();require(counts().shapes==before&&value("crosshair")==1,"off restore");configure({{"active",true}});mode(2);paint();require(value("crosshair")==0,"cosmetic remote scope");
    plugin.second.shutdown();paint();require(value("crosshair")==1,"shutdown restore");char owner[65]{};resource.owner("skeeto.crosshair.tps-active",owner);require(!*owner,"shutdown resource cleanup");require(view.snapshot(&current)==L4P_BAD_ARGUMENT,"control thread view gate");require(!counts().errors,"native drawing arguments");source.unsubscribe(token);bridge.second.shutdown();
    std::cout<<"PASS: TPS marker geometry/palette/projection, view/trace ABI, pass/scene gates, settings and stock restoration; "<<root.u8string()<<'\n';return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
