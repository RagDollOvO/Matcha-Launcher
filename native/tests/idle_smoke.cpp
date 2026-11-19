#define NOMINMAX
#include <windows.h>
#include "l4p_player.h"
#include "l4p_localize.h"
#include "l4p_view.h"
#include "l4p_cvar.h"
#include "l4p_draw.h"
#include "owned_input.hpp"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <limits>
using nlohmann::json;namespace fs=std::filesystem;
void require(bool ok,const char* why){if(!ok)throw std::runtime_error(why);}
template<class T>T sym(HMODULE h,const char* name){auto p=reinterpret_cast<T>(GetProcAddress(h,name));require(p,name);return p;}
void L4P_CALL log(void*,uint32_t,const char*){}
DWORD now=1000;DWORD WINAPI clockValue(){return now;}
L4P_PlayerApiV1 playerApi{1,sizeof(playerApi)};L4P_LocalizeApiV1 localize{1,sizeof(localize)};L4P_ViewApiV1 viewApi{1,sizeof(viewApi)};L4P_CvarApiV1 cvar{1,sizeof(cvar)};
L4P_DrawApiV1 draw{1,sizeof(draw)};char localized[128]{};uint32_t localizedSize=0;
uint32_t probe=0,remote=0,op=0,result=0,third=77;int frames=0;float inputAngles[3]={10,20,0};const char* text="A";
void L4P_CALL frame(void*,const L4P_SourceFrameV1*){++frames;
    if(op==1)result=playerApi.camera_mode(probe,&third);if(op==2)result=playerApi.set_camera_mode(probe,1);if(op==3)result=playerApi.set_camera_mode(probe,0);
    if(op==4)result=playerApi.set_angles(probe,inputAngles);if(op==5)result=playerApi.action(probe,100);if(op==6)result=playerApi.action(probe,6);if(op==7)result=playerApi.action(remote,1);
    if(op==8)result=localize.set(probe,"#L4D360UI_Gambler",text);if(op==9)result=localize.set(remote,"fixture_local",text);if(op==10)result=cvar.pin(probe,"r_flashlightbrightness",.25f);
    if(op==11){uint32_t font=0;result=draw.font(probe,"Microsoft YaHei",24,400,0x80,&font);if(result)return;
        draw.rect(probe,0,0,960,640,{246,243,235,255},1);draw.text(probe,font,50,36,{50,45,35,255},"BOT 显示名 · 本地化 SDK → Surface");
        const char* keys[]={"Gambler","Producer","Coach","Mechanic","NamVet","TeenGirl","Biker","Manager"};
        for(int i=0;i<8;++i){auto key=std::string("L4D360UI_")+keys[i];result=localize.read(key.c_str(),localized,sizeof(localized),&localizedSize);if(result)return;
            draw.text(probe,font,50,90+i*56,{110,95,70,255},keys[i]);draw.text(probe,font,300,90+i*56,{40,40,40,255},localized);}}
    if(op==12){strcpy(localized,"untouched");result=localize.read("L4D360UI_Gambler",localized,1,&localizedSize);}
}
void L4P_CALL noop(void*,const L4P_SourceFrameV1*){}
int wmain(int argc,wchar_t** argv){try{
    require(argc==5,"idle_smoke <plugins dist> <fixtures parent> <fresh root> <normal|unsupported|fault-memory>");auto dist=fs::absolute(argv[1]),fixtures=fs::absolute(argv[2]),root=fs::absolute(argv[3]);std::wstring variant=argv[4];require(!fs::exists(root),"fresh root");
    for(auto id:{L"beacon.source",L"skeeto.idle-restore"}){fs::create_directories(root/id);fs::copy_file(dist/id/L"plugin.dll",root/id/L"plugin.dll");}
    auto load=[](fs::path p){auto h=LoadLibraryExW(fs::absolute(p).c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(h,"DLL load");return h;};
    auto engine=load(fixtures/L"source/engine.dll"),client=load(fixtures/L"idle/client.dll"),vgui=load(fixtures/L"idle/vgui2.dll"),vars=load(fixtures/L"source/vstdlib.dll"),surface=load(fixtures/L"source/vguimatsurface.dll");
    require(sym<int(__cdecl*)(int)>(client,"FixtureCameraSetup")(variant==L"unsupported"?1:0),"owned camera mapped image");
    auto camera=sym<void(__cdecl*)(int,int)>(client,"FixtureCamera");auto cameraStats=sym<void(__cdecl*)(int*)>(client,"FixtureCameraStats");int cs[4]{};
    auto paint=sym<void(__cdecl*)()>(engine,"FixturePaint");auto mode=sym<void(__cdecl*)(int)>(engine,"FixtureMode");auto event=sym<void(__cdecl*)(const char*)>(engine,"FixtureEvent");auto eventInt=sym<void(__cdecl*)(const char*,int)>(engine,"FixtureEventInt");
    auto view=sym<void(__cdecl*)(int,float,float,float)>(engine,"FixtureView");auto writes=sym<int(__cdecl*)(float*)>(engine,"FixtureViewWrites");float angles[3]{};
    auto who=sym<void(__cdecl*)(int,const char*,int,int)>(engine,"FixturePlayer");auto pawn=sym<void(__cdecl*)(int,int,int,uint32_t)>(client,"FixturePlayer");
    auto health=sym<void(__cdecl*)(int,int,float,float,int)>(client,"FixtureHealth");auto weapon=sym<void(__cdecl*)(const char*,int,int,uint32_t)>(client,"FixtureWeapon");auto light=sym<void(__cdecl*)(int)>(client,"FixtureFlashlight");
    auto commands=sym<int(__cdecl*)()>(engine,"FixtureCommands");auto last=sym<const char*(__cdecl*)()>(engine,"FixtureLastCommand");auto emit=sym<float(__cdecl*)(const char*,float)>(engine,"FixtureEmit");
    auto nativeName=sym<const wchar_t*(__cdecl*)(const char*)>(vgui,"FixtureLocalize");auto chain=sym<void(__cdecl*)(int)>(vgui,"FixtureLocalizeChain");auto hooked=sym<int(__cdecl*)()>(vgui,"FixtureLocalizeOwned");
    auto cvset=sym<void(__cdecl*)(const char*,float,int)>(vars,"FixtureSet");auto cv=sym<float(__cdecl*)(const char*)>(vars,"FixtureValue");auto flags=sym<int(__cdecl*)(const char*)>(vars,"FixtureFlags");cvset("r_flashlightbrightness",1.5f,1<<14);
    auto init=[&](const wchar_t* id){auto module=load(root/id/L"plugin.dll");L4P_PluginApiV1 api{1,sizeof(api)};require(!sym<L4P_GetPluginApiFn>(module,"L4P_GetPluginApi")(1,&api),"plugin ABI");require(owned_input::replace(module,"GetTickCount",reinterpret_cast<void*>(&clockValue)),"isolated clock");auto directory=(root/id).u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,directory.c_str(),"{}"};require(!api.init(&host),"plugin init");return std::make_pair(module,api);};
    mode(1);pawn(0,2,0,1);health(100,100,0,0,0);weapon("CRifle",30,0,1);auto source=init(L"beacon.source");L4P_SourceApiV1 sdk{1,sizeof(sdk)};sym<L4P_GetSourceApiFn>(source.first,"L4P_GetSourceApi")(1,&sdk);
    auto get=sym<L4P_GetPlayerApiFn>(source.first,"L4P_GetPlayerApi");require(get(2,&playerApi)==L4P_UNSUPPORTED_VERSION&&!get(1,&playerApi),"Player API version");sym<L4P_GetLocalizeApiFn>(source.first,"L4P_GetLocalizeApi")(1,&localize);sym<L4P_GetViewApiFn>(source.first,"L4P_GetViewApi")(1,&viewApi);sym<L4P_GetCvarApiFn>(source.first,"L4P_GetCvarApi")(1,&cvar);
    sym<L4P_GetDrawApiFn>(source.first,"L4P_GetDrawApi")(1,&draw);
    sdk.subscribe("fixture.idle",0,"",nullptr,frame,nullptr,&probe);sdk.subscribe("fixture.idle.local",1,"",nullptr,noop,nullptr,&remote);for(int i=0;i<100&&!frames;++i){Sleep(20);paint();}require(frames,"Paint ready");
    auto tick=[&](uint32_t n){now+=n;paint();};auto run=[&](uint32_t action){op=action;paint();op=0;return result;};
    auto idle=init(L"skeeto.idle-restore");char out[16384]{};uint32_t size=0;auto invoke=[&](const char* action,json args=json::object()){auto input=args.dump();require(!idle.second.invoke(action,input.c_str(),out,sizeof(out),&size),action);return json::parse(out);};
    auto set=[&](json args){invoke("configure",args);tick(1);};auto only=[&](const char* key){json c={{"active",true}};for(auto id:{"flashlight","look","weapon","person","bot-names"})c[id]=!strcmp(key,id);set(c);};
    if(variant==L"unsupported"){third=77;require(run(1)==L4P_ENTITY_MISSING&&third==77,"mismatched native prefix preserves output");uint32_t status=0;playerApi.camera_status(&status);require(status==2,"unsupported camera state");only("person");require(invoke("status")["sections"][0]["items"][0]["code"]==7,"unsupported status visible");idle.second.shutdown();source.second.shutdown();paint();std::cout<<"PASS idle unsupported native camera\n";return 0;}
    if(variant==L"fault-memory"){camera(0,2);require(run(1)==L4P_ENTITY_MISSING,"actual native memory fault caught");uint32_t status=0;playerApi.camera_status(&status);require(status==3,"camera fault terminal");camera(0,0);require(run(1)==L4P_ENTITY_MISSING,"fault stays stopped");idle.second.shutdown();source.second.shutdown();paint();std::cout<<"PASS idle native memory fault\n";return 0;}
    require(playerApi.action(probe,100)==L4P_BAD_ARGUMENT&&localize.set(probe,"x","a")==L4P_BAD_ARGUMENT,"SDK Paint-only writes");
    camera(0,0);require(!run(1)&&third==0&&!run(2)&&!run(1)&&third==1&&!run(3),"native CInput getter(-1) first/third exact ABI");cameraStats(cs);require(cs[1]==2&&cs[2]==2&&!cs[3],"camera ABI counters");
    require(!run(4)&&writes(angles)==1&&angles[0]==10&&angles[1]==20,"Engine013 SetViewAngles slot20");inputAngles[0]=std::numeric_limits<float>::quiet_NaN();require(run(4)==L4P_BAD_ARGUMENT,"nonfinite angle rejected");inputAngles[0]=10;
    int n=commands();require(run(6)==L4P_BAD_ARGUMENT&&commands()==n,"bounded command enum");pawn(0,2,4,1);require(run(5)==L4P_ENTITY_SCOPE,"observed pawn blocked");pawn(1,2,0,1);require(run(5)==L4P_ENTITY_SCOPE,"dead pawn blocked");pawn(0,3,0,1);require(run(5)==L4P_ENTITY_SCOPE,"infected pawn blocked");pawn(0,2,0,1);who(1,"Bot",7,1);require(run(5)==L4P_ENTITY_SCOPE,"bot ownership blocked");who(1,"Player",7,0);view(1,0,0,0);require(run(5)==L4P_ENTITY_SCOPE,"menu control blocked");view(0,0,0,0);mode(2);require(run(7)==L4P_ENTITY_SCOPE&&!run(5)&&commands()==n+1&&!strcmp(last(),"impulse 100"),"ANY ordinary action versus LOCAL gate");mode(1);
    auto idleEvent=[&](bool take){eventInt("player",7);eventInt("bot",8);event(take?"bot_player_replace":"player_bot_replace");};
    light(0);only("flashlight");tick(200);light(1);idleEvent(false);pawn(0,2,4,1);tick(1);require(cv("r_flashlightbrightness")==0&&flags("r_flashlightbrightness")==1<<14,"off baseline brightness lease and flags restored");
    require(emit("items/FLASHLIGHT2.wav",.8f)==0&&emit("ui/other.wav",.8f)==.8f,"only flashlight sound muted");n=commands();idleEvent(true);pawn(0,2,0,1);tick(149);require(commands()==n,"flash 150ms settle");tick(1);require(commands()==n+1&&!strcmp(last(),"impulse 100"),"one toggle");tick(500);require(commands()==n+1&&cv("r_flashlightbrightness")==0,"delayed network convergence waits with no duplicate");light(0);tick(100);require(cv("r_flashlightbrightness")==1.5f,"brightness restored after convergence");tick(4600);require(emit("items/flashlight1.wav",.8f)==.8f,"mute tail expiry");
    tick(200);idleEvent(false);pawn(0,2,4,1);tick(1);light(1);idleEvent(true);pawn(0,2,0,1);tick(150);n=commands();tick(4000);require(commands()==n&&cv("r_flashlightbrightness")==1.5f,"nonconvergent toggle times out and returns brightness");
    // Missing takeover event still uses observing -> playing transition.
    event("round_start");light(0);tick(200);idleEvent(false);pawn(0,2,4,1);tick(1);light(1);pawn(0,2,0,1);tick(1);n=commands();tick(150);require(commands()==n+1,"flash observer fallback arms");set({{"flashlight",false}});require(cv("r_flashlightbrightness")==1.5f&&emit("items/flashlight1.wav",.8f)==.8f,"subswitch releases brightness and filter immediately");
    mode(2);light(0);only("flashlight");tick(200);idleEvent(false);pawn(0,2,4,1);tick(1);require(cv("r_flashlightbrightness")==1.5f&&invoke("status")["sections"][0]["items"][0]["code"]==6,"remote preserves restricted parameter");light(1);idleEvent(true);pawn(0,2,0,1);n=commands();tick(150);require(commands()==n+1,"remote ordinary toggle remains usable");set({{"flashlight",false}});mode(1);
    only("look");view(0,10,20,0);tick(1);tick(1);idleEvent(false);pawn(0,2,4,1);view(0,0,90,0);tick(1);idleEvent(true);pawn(0,2,0,1);n=writes(angles);tick(99);require(writes(angles)==n,"look settle100");tick(1);require(writes(angles)==n+1&&angles[0]==10&&angles[1]==20,"restores last player view instead of bot");view(0,0,90,0);tick(1);require(writes(angles)==n+2&&angles[1]==20,"one bot snap-back correction");view(0,0,90,0);tick(1);tick(650);require(writes(angles)==n+2,"look maximum two writes");
    view(0,0,20,0);tick(1);tick(1);idleEvent(false);pawn(0,2,4,1);view(0,0,90,0);tick(1);idleEvent(true);pawn(0,2,0,1);tick(100);n=writes(angles);tick(1);view(0,0,21,0);tick(1);view(0,0,90,0);tick(1);require(writes(angles)==n,"mouse movement cancels further correction");
    // Reset must discard the previous match's live sample.
    event("round_start");idleEvent(true);view(0,0,130,0);n=writes(angles);tick(2100);require(writes(angles)==n,"new round without snapshot stays quiet");
    only("weapon");int serial=2;for(auto entry:{std::pair<const char*,int>{"CRifle_AK47",1},{"CChainsaw",2},{"CVomitJar",3},{"CUpgradePack_Explosive",4},{"CAdrenaline",5}}){event("round_start");weapon(entry.first,20,0,serial++);tick(1);idleEvent(false);pawn(0,2,4,1);weapon("CPistol",15,0,serial++);if(entry.second==2)weapon("CRifle",30,0,serial++);tick(1);idleEvent(true);pawn(0,2,0,1);n=commands();tick(99);require(commands()==n,"slot settle100");tick(1);auto expected="slot"+std::to_string(entry.second);require(commands()==n+1&&last()==expected,"five slot classification");tick(100);tick(100);require(commands()==n+2,"slot max two tries");}
    event("round_start");weapon("CRifle",30,0,serial++);tick(1);idleEvent(false);weapon("CPistol",15,0,serial++);health(100,100,0,0,1);idleEvent(true);n=commands();tick(100);tick(2000);require(commands()==n,"incap waits for primary then times out");health(100,100,0,0,0);
    event("round_start");weapon("CPistol",15,0,serial++);tick(1);idleEvent(false);weapon("CRifle",30,0,serial++);health(100,100,0,0,1);idleEvent(true);tick(100);require(commands()==n+1&&!strcmp(last(),"slot2"),"incap secondary allowed");health(100,100,0,0,0);
    event("round_start");weapon("CPhysicsProp",0,0,serial++);tick(1);idleEvent(false);idleEvent(true);n=commands();tick(2100);require(commands()==n,"unknown carry item not mistaken for prior slot");
    camera(1,0);only("person");tick(100);idleEvent(false);pawn(0,2,4,1);camera(0,0);tick(100);idleEvent(true);pawn(0,2,0,1);cameraStats(cs);n=cs[2];tick(99);cameraStats(cs);require(cs[2]==n,"person settle100");tick(101);cameraStats(cs);require(cs[2]==n+1&&cs[0]==1&&!cs[3],"restores third person through native no-arg setter");tick(200);require(!run(3),"native first after restore");
    event("round_start");camera(0,0);tick(100);idleEvent(false);pawn(0,2,4,1);idleEvent(true);cameraStats(cs);n=cs[2];tick(2100);pawn(0,2,0,1);tick(100);cameraStats(cs);require(cs[2]==n,"camera snapshot expires during failed possession");
    only("bot-names");const char* roles[]={"nick","rochelle","coach","ellis","bill","zoey","francis","louis"};const char* keys[]={"Gambler","Producer","Coach","Mechanic","NamVet","TeenGirl","Biker","Manager"};json names;
    for(int i=0;i<8;++i)names[std::string("name-")+roles[i]]="  自定义"+std::to_string(i)+"　";set(names);for(int i=0;i<8;++i){std::wstring expected=L"自定义"+std::to_wstring(i);require(nativeName((std::string("#L4D360UI_")+keys[i]).c_str())==expected,"eight localized BOT names trimmed");}
    require(!run(11),"SDK effective name read and draw");require(sym<int(__cdecl*)(const wchar_t*)>(surface,"FixtureDrawSave")((root/L"bot-names.bmp").c_str()),"BOT name visual");
    require(run(12)==L4P_BUFFER_TOO_SMALL&&!strcmp(localized,"untouched")&&localizedSize==11,"localized UTF-8 short buffer preserves output");
    require(!wcscmp(nativeName("OTHER_TEXT"),L"普通文字"),"unrelated localization preserved");auto retained=nativeName("L4D360UI_Gambler");set({{"name-nick","第二名"}});require(!wcscmp(retained,L"自定义0"),"native retained pointer immutable");
    require(run(8)==5,"localization first owner conflict");localize.clear(probe,nullptr);require(!wcscmp(nativeName("L4D360UI_Gambler"),L"第二名"),"foreign clear respects owner");set({{"name-nick",""}});require(!wcscmp(nativeName("L4D360UI_Gambler"),L"游戏 / Mod 名称"),"empty field restores native lookup");
    char tiny[1];auto saved=invoke("status")["settings"];require(idle.second.invoke("configure","{\"active\":false}",tiny,1,&size)==L4P_BUFFER_TOO_SMALL&&invoke("status")["settings"]==saved,"capacity before configuration side effect");
    for(auto bad:{std::string("line\nname"),std::string(24,'a'),std::string("😀😀😀😀😀😀😀😀😀😀😀😀")}){auto args=json{{"name-nick",bad}}.dump();require(idle.second.invoke("configure",args.c_str(),out,sizeof(out),&size)==L4P_BAD_ARGUMENT,"invalid BOT name rejected");}
    set({{"name-nick","😀幸存者"}});mode(0);tick(1);require(!wcscmp(nativeName("L4D360UI_Gambler"),L"😀幸存者"),"ANY names work in menu and valid surrogate pairs");text="Scoped";require(run(9)==6,"LOCAL name rejects menu");mode(1);require(!run(9),"LOCAL name available in scope");mode(2);tick(1);require(!wcscmp(nativeName("fixture_local"),L"普通文字"),"LOCAL name becomes transparent outside scope");localize.clear(remote,nullptr);mode(1);
    set({{"bot-names",false}});require(!hooked()&&!wcscmp(nativeName("L4D360UI_Gambler"),L"游戏 / Mod 名称"),"off restores native slot and text");set({{"bot-names",true}});chain(1);set({{"bot-names",false}});require(hooked()&&!wcscmp(nativeName("L4D360UI_Gambler"),L"游戏 / Mod 名称"),"external hook preserved with transparent predecessor");chain(0);tick(1);require(!hooked(),"restoration completes when own slot returned");
    only("flashlight");light(0);event("round_start");tick(200);idleEvent(false);pawn(0,2,4,1);tick(1);require(cv("r_flashlightbrightness")==0,"final live brightness lease");mode(3);tick(1);require(cv("r_flashlightbrightness")==1.5f&&emit("items/flashlight1.wav",.8f)==.8f,"loading clears restore and sound state");mode(1);pawn(0,2,0,1);
    camera(0,1);require(run(1)==L4P_ENTITY_MISSING,"RaiseException native boundary");uint32_t status=0;playerApi.camera_status(&status);require(status==3,"fault state");camera(0,0);require(run(1)==L4P_ENTITY_MISSING,"fault terminal for current process");
    set({{"bot-names",true}});event("round_start");light(0);tick(200);idleEvent(false);pawn(0,2,4,1);tick(1);require(cv("r_flashlightbrightness")==0&&hooked(),"shutdown has live leases and names");
    idle.second.shutdown();require(!wcscmp(nativeName("L4D360UI_Gambler"),L"游戏 / Mod 名称")&&emit("items/flashlight1.wav",.8f)==.8f,"shutdown immediately makes callbacks transparent");paint();require(cv("r_flashlightbrightness")==1.5f&&!hooked(),"consumer shutdown restores native leases");
    sdk.unsubscribe(probe);sdk.unsubscribe(remote);source.second.shutdown();paint();require(cv("r_flashlightbrightness")==1.5f&&!hooked(),"final shutdown cleanup");
    std::cout<<"PASS idle: real Source/feature DLL, native camera/angles/actions, full restore state machines, audio/leases, eight BOT names, ownership/UTF-16/lifetime, scope and teardown\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<"\n";return 1;}}
