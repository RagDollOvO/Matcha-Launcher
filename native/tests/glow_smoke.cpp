#define NOMINMAX
#include <windows.h>
#include "l4p_glow.h"
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <cmath>
namespace fs=std::filesystem;
void require(bool value,const char* why){if(!value)throw std::runtime_error(why);}
void L4P_CALL log(void*,uint32_t,const char*){}
template<class T>T symbol(HMODULE m,const char* name){auto p=reinterpret_cast<T>(GetProcAddress(m,name));require(p,name);return p;}
L4P_EntityApiV1 entity{1,sizeof(entity)};L4P_GlowApiV1 glow{1,sizeof(glow)};uint32_t any=0,local=0,owner=0,result=0,alpha=0;int frames=0,op=0,index=2,colour=0x123456,range=32767;L4P_EntityRefV1 ref{};
void L4P_CALL frame(void*,const L4P_SourceFrameV1*){++frames;if(!op)return;require(entity.reference(index,&ref)==0,"reference");
 if(op==1)result=glow.survivor_colour(owner,&ref,colour,alpha);if(op==2)result=glow.outline(owner,&ref,uint32_t(colour),range);if(op==3)result=glow.release(owner,&ref);}
int wmain(int argc,wchar_t** argv){try{
 require(argc==6,"glow_smoke <Source DLL> <fake engine directory> <glow client DLL> <fresh root> <normal|unsupported>");bool unsupported=!wcscmp(argv[5],L"unsupported");fs::path root=fs::absolute(argv[4]);require(!fs::exists(root),"fresh root");fs::create_directories(root);
 auto load=[](fs::path p){auto h=LoadLibraryExW(fs::absolute(p).c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(h,"DLL load");return h;};
 auto engine=load(fs::path(argv[2])/L"engine.dll"),client=load(argv[3]),vars=load(fs::path(argv[2])/L"vstdlib.dll");auto paint=symbol<void(__cdecl*)()>(engine,"FixturePaint");auto mode=symbol<void(__cdecl*)(int)>(engine,"FixtureMode");auto event=symbol<void(__cdecl*)(const char*)>(engine,"FixtureEvent");auto modeText=symbol<void(__cdecl*)(const char*,const char*)>(vars,"FixtureString");
 auto native=symbol<void(__cdecl*)(int,float*)>(client,"FixtureGlowGet");auto values=symbol<void(__cdecl*)(int,int*,float*)>(client,"FixtureGlowValues");auto external=symbol<void(__cdecl*)(int,int,int,int,int)>(client,"FixtureGlowExternal");auto serial=symbol<void(__cdecl*)(int,unsigned)>(client,"FixtureGlowSerial");
 if(unsupported)symbol<void(__cdecl*)()>(client,"FixtureGlowVariant")();mode(1);modeText("mp_gamemode","coop");fs::copy_file(argv[1],root/L"plugin.dll");auto module=load(root/L"plugin.dll");L4P_PluginApiV1 plugin{1,sizeof(plugin)};symbol<L4P_GetPluginApiFn>(module,"L4P_GetPluginApi")(1,&plugin);auto dir=root.u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,dir.c_str(),"{}"};require(plugin.init(&host)==0,"init");
 L4P_SourceApiV1 source{1,sizeof(source)};symbol<L4P_GetSourceApiFn>(module,"L4P_GetSourceApi")(1,&source);require(symbol<L4P_GetGlowApiFn>(module,"L4P_GetGlowApi")(1,&glow)==0,"Glow API");symbol<L4P_GetEntityApiFn>(module,"L4P_GetEntityApi")(1,&entity);source.subscribe("fixture.glow.any",0,"round_start",nullptr,frame,nullptr,&any);source.subscribe("fixture.glow.local",1,"",nullptr,frame,nullptr,&local);
 for(int n=0;n<100&&!frames;++n){Sleep(20);paint();}require(frames,"Paint");auto run=[&](int n){op=n;paint();op=0;return result;};float rgba[4]{},rgb[3]{};int raw[4]{};auto close=[](float a,float b){return std::abs(a-b)<.0001f;};
 index=65;owner=local;require(run(2)==(unsupported?L4P_ENTITY_MISSING:L4P_OK),"native signature resolve");L4P_GlowStatusV1 status{sizeof(status)};glow.status(&status);
 if(unsupported){values(65,raw,rgb);require(status.outline_state==2&&raw[0]==0&&raw[1]==40,"unsupported preserves fields");source.unsubscribe(any);source.unsubscribe(local);plugin.shutdown();paint();std::cout<<"PASS: unsupported glow entry preserves native fields\n";return 0;}
 values(65,raw,rgb);require(raw[0]==3&&raw[1]==32767&&raw[2]==0&&raw[3]==colour&&close(rgb[0],0x56/255.f)&&close(rgb[2],0x12/255.f),"type/range/colour proxy normalized cache");owner=any;require(run(2)==L4P_ENTITY_SCOPE,"throughwall needs LOCAL");owner=local;
 require(glow.release(local,&ref)==0,"queued release");values(65,raw,rgb);require(raw[0]==3,"control release deferred");paint();values(65,raw,rgb);require(raw[0]==0&&raw[1]==40&&raw[2]==7&&raw[3]==0x332211&&close(rgb[1],0x22/255.f),"native exact restore and RGB cache");
 require(run(2)==0,"outline reenable");external(65,2,500,0,0x778899);require(run(3)==0,"foreign release");values(65,raw,rgb);require(raw[0]==2&&raw[1]==500&&raw[2]==7&&raw[3]==0x778899,"restore only still-owned fields");require(run(2)==L4P_GLOW_CONFLICT,"existing active outline preserved");external(65,0,40,7,0x332211);
 run(2);mode(2);paint();values(65,raw,rgb);require(raw[0]==0&&raw[1]==40,"scope restore before consumer");mode(1);paint();run(2);serial(65,9);external(65,0,900,30,0x998877);paint();values(65,raw,rgb);require(raw[1]==900,"reused serial untouched");
 run(2);mode(3);paint();values(65,raw,rgb);glow.status(&status);require(raw[0]==3&&!status.outlines,"loading discards ownership without native writes");mode(1);external(65,0,900,30,0x998877);paint();
 index=2;owner=any;require(run(1)==0,"survivor colour hook");native(2,rgba);require(close(rgba[0],0x56/255.f)&&close(rgba[1],0x34/255.f)&&close(rgba[3],.25f),"RGB native alpha preserved");native(1,rgba);require(close(rgba[0],.2f),"unowned entity same vtable");
 std::thread worker([&]{native(2,rgba);});worker.join();require(close(rgba[0],.2f),"other thread original");alpha=1;require(run(1)==L4P_ENTITY_SCOPE,"alpha expansion needs LOCAL");alpha=0;run(3);owner=local;alpha=1;require(run(1)==0,"local alpha");native(2,rgba);require(rgba[3]==1,"force alpha one");mode(2);paint();native(2,rgba);require(close(rgba[0],.2f)&&close(rgba[3],.25f),"remote restores original callback");
 owner=any;alpha=0;require(run(1)==0,"remote cosmetic RGB");modeText("mp_gamemode","realism");paint();native(2,rgba);require(close(rgba[0],.2f),"realism original");require(run(1)==L4P_ENTITY_SCOPE,"realism gate");modeText("mp_gamemode","coop");paint();run(1);serial(2,2);native(2,rgba);require(close(rgba[0],.2f),"native call detects stale serial before next Paint");paint();run(1);
 symbol<void(__cdecl*)()>(client,"FixtureGlowForeign")();paint();require(run(1)==L4P_GLOW_CONFLICT,"foreign hook conflict");native(2,rgba);require(close(rgba[0],.3f)&&close(rgba[3],.25f),"retained thunk forwards original then foreign");run(3);native(2,rgba);require(close(rgba[0],.3f),"release retains foreign slot");
 mode(1);index=65;owner=local;external(65,0,900,30,0x998877);run(2);event("round_start");paint();source.unsubscribe(local);paint();values(65,raw,rgb);require(raw[0]==0&&raw[1]==900&&raw[2]==30&&raw[3]==0x998877,"unsubscribe outline restore");
 source.subscribe("fixture.glow.shutdown",1,"",nullptr,frame,nullptr,&local);owner=local;run(2);source.unsubscribe(any);plugin.shutdown();paint();values(65,raw,rgb);require(raw[0]==0&&raw[1]==900,"shutdown in live game restores");glow.status(&status);require(!status.colours&&!status.outlines&&!status.hooks,"service owned state empty");
 std::cout<<"PASS: real glow x86 ABI, normalized RGB, native alpha, local gates, identity, field ownership, foreign hooks and shutdown\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
