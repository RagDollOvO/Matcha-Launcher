#define NOMINMAX
#include <windows.h>
#include "l4p_file.h"
#include "style_catalog.hpp"
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <vector>
#include <cstring>
namespace fs=std::filesystem;
void require(bool b,const char* s){if(!b)throw std::runtime_error(s);}
void L4P_CALL log(void*,uint32_t,const char*){}
template<class T>T symbol(HMODULE m,const char* name){auto fn=reinterpret_cast<T>(GetProcAddress(m,name));require(fn,name);return fn;}
L4P_FileApiV1 files{1,sizeof(files)};uint32_t token=0,other=0,handle=0,search=0,size=0,result=0;int frames=0,op=0;unsigned char data[262144]{};uint32_t got=0;L4P_FileEntryV1 entry{sizeof(entry)};
L4P_FileApiV3 files3{{{3,sizeof(files3)}}};uint32_t pathRevision=0;bool styleLoaded=false;
void L4P_CALL frame(void*,const L4P_SourceFrameV1*){++frames;switch(op){
case 1:result=files.open(token,"sound/skeeto/safe/中文曲目.wav",1024*1024,&handle,&size);break;
case 2:result=files.read(token,handle,data,sizeof(data),&got);break;
case 3:result=files.find_open(token,"sound/skeeto/safe/*.wav",&search);break;
case 4:result=files.find_next(token,search,&entry);break;
case 5:result=files.open(token,"sound/skeeto/safe/中文曲目.wav",5,&handle,&size);break;
case 6:result=files.read(other,handle,data,sizeof(data),&got);break;
case 7:result=files.find_open(token,"sound/empty/*.mp3",&search);break;
case 8:result=files.open(token,"../secret",1024,&handle,&size);break;
case 9:result=files.open(token,"C:/secret",1024,&handle,&size);break;
case 10:result=files.find_open(token,"sound/*/safe/*.wav",&search);break;
case 11:result=files.close(token,handle);break;
case 12:result=files3.path_revision(token,&pathRevision);break;
case 13:DlcRefreshFiles();DlcSetSelected("ci","smoke");DlcOpenSelectedStyleFiles();styleLoaded=DlcFindStyle("smoke")!=nullptr;break;
default:break;}}
void L4P_CALL noop(void*,const L4P_SourceFrameV1*){}
int wmain(int argc,wchar_t** argv){try{require(argc==4,"files_smoke <Source DLL> <fixture dir> <fresh root>");fs::path root=fs::absolute(argv[3]);require(!fs::exists(root),"fresh root");fs::create_directories(root);
    auto load=[](fs::path path){auto m=LoadLibraryExW(fs::absolute(path).c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(m,"DLL load");return m;};
    auto engine=load(fs::path(argv[2])/L"engine.dll"),file=load(fs::path(argv[2])/L"filesystem_stdio.dll");auto paint=symbol<void(__cdecl*)()>(engine,"FixturePaint");auto mode=symbol<void(__cdecl*)(int)>(engine,"FixtureMode");auto add=symbol<void(__cdecl*)(const char*,const void*,unsigned,int)>(file,"FixtureFsAdd");auto stats=symbol<void(__cdecl*)(int*)>(file,"FixtureFsStats");int counts[5]{};
    std::vector<unsigned char> bytes(600000);for(size_t i=0;i<bytes.size();++i)bytes[i]=static_cast<unsigned char>(i%251);add("sound/skeeto/safe/中文曲目.wav",bytes.data(),bytes.size(),0);add("sound/skeeto/safe/folder.wav",nullptr,0,1);
    fs::copy_file(argv[1],root/L"plugin.dll");auto sourceDll=load(root/L"plugin.dll");L4P_PluginApiV1 plugin{1,sizeof(plugin)};symbol<L4P_GetPluginApiFn>(sourceDll,"L4P_GetPluginApi")(1,&plugin);auto dir=root.u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,dir.c_str(),"{}"};require(plugin.init(&host)==0,"init");L4P_SourceApiV1 source{1,sizeof(source)};symbol<L4P_GetSourceApiFn>(sourceDll,"L4P_GetSourceApi")(1,&source);require(symbol<L4P_GetFileApiFn>(sourceDll,"L4P_GetFileApi")(1,&files)==0,"File API");source.subscribe("fixture.files",0,"",nullptr,frame,nullptr,&token);source.subscribe("fixture.other",0,"",nullptr,noop,nullptr,&other);
    for(int i=0;i<100&&!frames;++i){Sleep(20);paint();}require(frames,"Paint");auto run=[&](int n){op=n;paint();op=0;return result;};
    require(files.open(token,"sound/a",2,&handle,&size)==L4P_BAD_ARGUMENT,"control thread read gate");require(run(1)==0&&size==bytes.size(),"menu UTF8 open and size");uint32_t saved=handle;require(run(6)==L4P_BAD_ARGUMENT,"token ownership");
    size_t consumed=0;for(int i=0;i<3;++i){require(run(2)==0&&got==std::min(size_t(sizeof(data)),bytes.size()-consumed)&&!memcmp(data,bytes.data()+consumed,got),"bounded native reads");consumed+=got;}require(run(2)==0&&got==0,"captured EOF");
    require(files.close(token,handle)==0,"queued control close");stats(counts);require(counts[0]==1,"close deferred");paint();stats(counts);require(counts[0]==0&&counts[3]==1,"close native ABI");
    handle=123;size=321;require(run(5)==L4P_ERROR&&handle==123&&size==321,"size limit outputs preserved");stats(counts);require(counts[0]==0&&counts[3]==2,"oversize closed");
    require(run(3)==0,"FindFirstEx");require(run(4)==0&&!entry.done&&entry.is_directory&&!strcmp(entry.name,"folder.wav"),"directory flag and primary this");require(run(4)==0&&!entry.done&&!entry.is_directory&&!strcmp(entry.name,"中文曲目.wav"),"UTF8 native find next");require(run(4)==0&&entry.done,"find end");require(files.find_close(other,search)==L4P_BAD_ARGUMENT,"find ownership");files.find_close(token,search);paint();stats(counts);require(!counts[1]&&counts[4]==1,"find handle zero closed");
    require(run(7)==0&&run(4)==0&&entry.done,"empty search");files.find_close(token,search);paint();stats(counts);require(counts[4]==1,"invalid native search handle not closed");
    for(int n:{8,9,10})require(run(n)==L4P_BAD_ARGUMENT,"relative path or leaf glob constraint");mode(3);require(run(1)==6,"loading pause");mode(1);require(run(1)==0,"local open");add("sound/skeeto/safe/中文曲目.wav",nullptr,0,0);got=42;require(run(2)==L4P_ERROR&&got==42,"truncation explicit failure");
    require(!symbol<L4P_GetFileApiFn>(sourceDll,"L4P_GetFileApi")(3,&files3.base.base),"File API 3");
    auto searchPath=symbol<void(__cdecl*)(const char*)>(file,"FixtureFsSearchPath");searchPath("fixture/game;fixture/addons.vpk");
    require(!run(12)&&pathRevision,"GAME mount revision");auto oldRevision=pathRevision;require(!run(12)&&pathRevision==oldRevision,"stable revision");
    searchPath("fixture/game;fixture/addons.vpk;fixture/workshop.vpk");require(!run(12)&&pathRevision!=oldRevision,"changed mount revision");
    const char style[]=R"({"id":"smoke","name":"Fixture style","channel":"ci","hit":{"overlay":"smoke/hit","overlay_sequence":["smoke/1","smoke/2"],"overlay_step_ms":40,"particles":["smoke_extra"],"sound":"smoke/hit.wav"},"streak":{"enabled":true,"wrap":2,"priority":10},"kill":{"sound":"smoke/kill.wav"},"streak_2":{"sound":"smoke/double.wav"},"headshot":{"sound":"smoke/head.wav","priority":11},"skeet":{"particle":"smoke_skeet","world":true}})";
    add("skeeto/skeeto_smoke.json",style,sizeof(style)-1,0);DlcBindFiles(&files3,token);run(13);require(styleLoaded,"SDK catalog loads selected GAME JSON");
    DlcFx fx{};require(DlcResolve("ci","hit",false,false,0,&fx)&&fx.overlaySequenceCount==2&&fx.particleExtraCount==1,"original composite hit parser");
    require(DlcResolve("ci","kill",false,false,4,&fx)&&!strcmp(fx.sound,"smoke/double.wav"),"original streak wrapping");
    require(DlcResolve("ci","kill",true,false,2,&fx)&&!strcmp(fx.sound,"smoke/head.wav"),"original priority selection");
    require(DlcResolveNamed("ci","skeet",&fx)&&fx.worldSpace&&!strcmp(fx.particle,"smoke_skeet"),"named effects");
    DlcReleaseFiles();require(!strcmp(DlcGetSelected("ci"),"smoke"),"release preserves selected style");
    require(run(3)==0,"live search before unsubscribe");source.unsubscribe(token);paint();stats(counts);require(!counts[0]&&!counts[1]&&!counts[2],"unsubscribe closes native handles with exact ABI");source.unsubscribe(other);plugin.shutdown();paint();
    std::cout<<"PASS: mounted GAME files/find, primary+secondary ABI, bounded reads, UTF8, missing/truncated/oversize assets, menu/loading gates and owned cleanup\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
