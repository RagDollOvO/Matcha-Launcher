#define NOMINMAX
#include <windows.h>
#include "l4p_draw.h"
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <cmath>
namespace fs=std::filesystem;
void require(bool value,const char* why){if(!value)throw std::runtime_error(why);}
void L4P_CALL log(void*,uint32_t,const char*){}
template<class T>T symbol(HMODULE m,const char* name){auto p=reinterpret_cast<T>(GetProcAddress(m,name));require(p,name);return p;}
L4P_DrawApiV1 draw{1,sizeof(draw)};uint32_t token=0,local=0;uint32_t code=99,localCode=99;bool render=false;int calls=0;std::string failure;
void L4P_CALL frame(void*,const L4P_SourceFrameV1* f){++calls;if(!render)return;try{
    code=draw.rect(token,0,0,960,640,{240,237,224,255},1);localCode=draw.rect(local,0,0,1,1,{0,0,0,0},1);if(code!=L4P_OK)return;
    int w=0,h=0;require(draw.screen(token,&w,&h)==L4P_OK&&w==960&&h==640,"viewport ABI");
    uint32_t font=0,title=0;require(draw.font(token,"Microsoft YaHei",24,500,0x210,&font)==L4P_OK,"font ABI");require(draw.font(token,"Microsoft YaHei",36,700,0x210,&title)==L4P_OK,"title font");
    uint32_t repeated=0;require(draw.font(token,"Microsoft YaHei",24,500,0x210,&repeated)==L4P_OK&&repeated==font,"font reuse");
    require(draw.measure(token,font,"Source 绘制接口",&w,&h)==L4P_OK&&w>100&&h>0,"UTF8 measurement");
    require(draw.text(token,title,56,48,{34,54,69,255},"Source · 独立功能绘制")==L4P_OK,"UTF8 text ABI");
    draw.text(token,font,56,108,{80,92,96,255},"实体快照 → 功能 DLL → 原生 Surface");draw.line(token,56,164,904,164,{188,143,52,255});
    draw.rect(token,56,212,480,42,{70,96,109,255},0);draw.rect(token,59,215,320,36,{65,153,136,255},1);
    draw.text(token,font,56,278,{34,54,69,255},"绘制范围、字体与贴图由 SDK 管理");
    uint32_t tex=99;require(draw.texture_file(token,"missing/icon",&tex,&w,&h)==7&&tex==99,"missing material avoids placeholder");
    require(draw.texture_file(token,"fixture/icon",&tex,&w,&h)==L4P_OK&&tex==0&&w==64&&h==64,"material mount and zero texture ID");
    const float uv[]={0,0,1,1};require(draw.texture(token,tex,688,212,120,120,uv,{255,255,255,255})==L4P_OK,"texture ABI");
    float p[2]={-1,-1},world[3]{};if(f->in_game){require(draw.project(token,world,p)==L4P_OK&&std::abs(p[0]-480.5f)<.01f&&std::abs(p[1]-320.5f)<.01f,"world projection");world[0]=100;require(draw.project(token,world,p)==7&&std::abs(p[0]-480.5f)<.01f,"offscreen output retained");}
    require(draw.rect(token,0,0,-1,10,{0,0,0,0},1)==L4P_BAD_ARGUMENT,"geometry bounds");require(draw.text(token,font,0,0,{0,0,0,0},"\xff")==L4P_BAD_ARGUMENT,"UTF8 validation");
}catch(const std::exception& e){failure=e.what();}}
struct Counts {int begins,ends,pushes,pops,flushes,shapes,texts,textures,errors,root;};
int wmain(int argc,wchar_t** argv){try{
    require(argc==5,"drawing_smoke <Source DLL> <fixture DLL directory> <fresh output directory> normal|unsupported");fs::path root=fs::absolute(argv[3]),fake=fs::absolute(argv[2]);require(!fs::exists(root),"fresh root");fs::create_directories(root);
    auto load=[](const fs::path& p){auto m=LoadLibraryExW(p.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(m,"load DLL");return m;};
    auto engine=load(fake/L"engine.dll"),surface=load(fake/L"vguimatsurface.dll");load(fake/L"filesystem_stdio.dll");
    auto paint=symbol<void(__cdecl*)()>(engine,"FixturePaint");auto mode=symbol<void(__cdecl*)(int)>(engine,"FixtureMode");auto paintMode=symbol<void(__cdecl*)(int)>(engine,"FixturePaintMode");auto context=symbol<void(__cdecl*)(int,unsigned)>(surface,"FixtureDrawContext");auto open=symbol<int(__cdecl*)()>(surface,"FixtureDrawOpen");auto getCounts=symbol<void(__cdecl*)(void*)>(surface,"FixtureDrawCounts");auto counts=[&](){Counts c{};getCounts(&c);return c;};
    bool unsupported=!wcscmp(argv[4],L"unsupported");if(unsupported)symbol<void(__cdecl*)()>(surface,"FixtureDrawUnsupported")();
    auto module=load(fs::absolute(argv[1]));L4P_PluginApiV1 plugin{1,sizeof(plugin)};require(symbol<L4P_GetPluginApiFn>(module,"L4P_GetPluginApi")(1,&plugin)==L4P_OK,"Source plugin API");auto directory=root.u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,directory.c_str(),"{}"};require(plugin.init(&host)==L4P_OK,"Source init");
    L4P_SourceApiV1 source{1,sizeof(source)};require(symbol<L4P_GetSourceApiFn>(module,"L4P_GetSourceApi")(1,&source)==L4P_OK,"Source API");require(symbol<L4P_GetDrawApiFn>(module,"L4P_GetDrawApi")(1,&draw)==L4P_OK,"Draw API");source.subscribe("fixture.draw",0,"",nullptr,frame,nullptr,&token);source.subscribe("fixture.local",1,"",nullptr,[](void*,const L4P_SourceFrameV1*){},nullptr,&local);
    mode(1);for(int i=0;i<100&&!calls;++i){Sleep(20);paint();}require(calls,"Paint connection");render=true;paint();
    if(unsupported){require(code==7&&counts().begins==0,"unsupported context rejected before calling");L4P_DrawStatusV1 status{sizeof(status)};draw.status(&status);require(status.state==2,"unsupported diagnostic");plugin.shutdown();std::cout<<"PASS: Unsupported Surface context rejected\n";return 0;}
    require(failure.empty(),failure.c_str());require(code==L4P_OK&&localCode==L4P_OK,"draw gate");auto c=counts();require(c.begins==1&&c.ends==1&&c.pushes==1&&c.pops==1&&c.root==7&&!open()&&!c.errors,"owned context ABI/balance");
    context(1,9);paint();c=counts();require(c.begins==1&&c.ends==1&&c.pushes==1&&c.pops==1&&c.flushes==1&&open(),"borrowed context stays open");
    context(0,11);paint();c=counts();require(c.begins==2&&c.ends==2&&c.root==11,"current root reacquired");
    mode(0);paintMode(1);require(code==L4P_OK&&localCode==6,"UI menu ANY and gated LOCAL");paintMode(0);require(code==L4P_BAD_ARGUMENT,"only panel passes");
    require(draw.line(token,0,0,1,1,{0,0,0,0})==L4P_BAD_ARGUMENT,"control thread draw refused");require(failure.empty(),failure.c_str());require(!counts().errors,"native call arguments");
    auto file=root/L"surface.bmp";require(symbol<int(__cdecl*)(const wchar_t*)>(surface,"FixtureDrawSave")(file.c_str()),"render output");L4P_DrawStatusV1 status{sizeof(status)};draw.status(&status);require(status.state==1&&status.fonts==2&&status.textures==1,"bounded reuse");source.unsubscribe(token);source.unsubscribe(local);plugin.shutdown();std::cout<<"PASS: Surface context ownership, native primitives, fonts, textures, projection, gates; "<<file.u8string()<<'\n';return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
