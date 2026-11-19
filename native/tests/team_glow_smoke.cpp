// Owned offline host for real Source and team-glow-style DLLs. No game process.
#define NOMINMAX
#include <windows.h>
#include "l4p_glow.h"
#include "l4p_cvar.h"
#include "l4p_resource.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <cmath>
using nlohmann::json;namespace fs=std::filesystem;
void require(bool ok,const char* why){if(!ok)throw std::runtime_error(why);}
template<class T>T sym(HMODULE module,const char* name){auto p=reinterpret_cast<T>(GetProcAddress(module,name));require(p,name);return p;}
void L4P_CALL log(void*,uint32_t,const char*){}
L4P_EntityApiV1 entities{1,sizeof(entities)};L4P_CvarApiV3 cvars{{3,sizeof(cvars)}};L4P_ResourceApiV1 resources{1,sizeof(resources)};
uint32_t probe=0;int frames=0;const char* resource="";bool checkShort=false;bool badRelative=false;
void L4P_CALL frame(void*,const L4P_SourceFrameV1*){++frames;if(*resource)require(resources.claim(probe,resource)==0,"claim HUD state");else resources.release(probe,nullptr);
    if(checkShort){L4P_EntityRefV1 ref{};require(!entities.reference(2,&ref),"short ref");struct {uint16_t index,guard;} value{0,0x55cc};
        require(!entities.read(&ref,"m_nModelIndex",L4P_FIELD_SHORT,&value.index)&&value.index==100&&value.guard==0x55cc,"2-byte field preserves adjacent output");
        float untouched=42;require(entities.read(&ref,"m_nModelIndex",L4P_FIELD_FLOAT,&untouched)==L4P_BAD_ARGUMENT&&untouched==42,"field type mismatch");}
    if(badRelative){require(cvars.pin_relative(probe,"cl_glow_brightness",11)==L4P_BAD_ARGUMENT,"relative factor bound");require(cvars.pin_relative(probe,"cl_glow_brightness",NAN)==L4P_BAD_ARGUMENT,"relative finite");}}
int wmain(int argc,wchar_t** argv){try{
    require(argc==6,"team_glow_smoke <Source DLL> <feature DLL> <engine dir> <glow client DLL> <fresh root>");
    fs::path root=fs::absolute(argv[5]);require(!fs::exists(root),"fresh root");fs::create_directories(root/L"beacon.source");fs::create_directories(root/L"skeeto.team-glow-style");
    fs::copy_file(argv[1],root/L"beacon.source/plugin.dll");fs::copy_file(argv[2],root/L"skeeto.team-glow-style/plugin.dll");
    auto load=[](fs::path p){auto h=LoadLibraryExW(fs::absolute(p).c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(h,"DLL load");return h;};
    auto engine=load(fs::path(argv[3])/L"engine.dll"),vars=load(fs::path(argv[3])/L"vstdlib.dll"),client=load(argv[4]);
    auto paint=sym<void(__cdecl*)()>(engine,"FixturePaint");auto event=sym<void(__cdecl*)(const char*)>(engine,"FixtureEvent"),map=sym<void(__cdecl*)(const char*)>(engine,"FixtureMap");
    auto mode=sym<void(__cdecl*)(int)>(engine,"FixtureMode");auto player=sym<void(__cdecl*)(int,const char*,int,int)>(engine,"FixturePlayer");auto model=sym<void(__cdecl*)(int,const char*)>(engine,"FixtureModelName");
    auto text=sym<void(__cdecl*)(const char*,const char*)>(vars,"FixtureString");auto set=sym<void(__cdecl*)(const char*,float,int)>(vars,"FixtureSet");auto value=sym<float(__cdecl*)(const char*)>(vars,"FixtureValue");auto retarget=sym<void(__cdecl*)(const char*,float,int)>(vars,"FixtureRetarget");
    auto actor=sym<void(__cdecl*)(int,int,int,int,int,int,int,int)>(client,"FixtureGlowPlayer");auto laser=sym<void(__cdecl*)(int,int,unsigned,int)>(client,"FixtureGlowLaser");auto present=sym<void(__cdecl*)(int,int)>(client,"FixtureGlowPresent");
    auto native=sym<void(__cdecl*)(int,float*)>(client,"FixtureGlowGet");auto raw=sym<void(__cdecl*)(int,int*,float*)>(client,"FixtureGlowValues");auto external=sym<void(__cdecl*)(int,int,int,int,int)>(client,"FixtureGlowExternal");
    text("mp_gamemode","coop");mode(1);set("cl_glow_brightness",2,0);set("cl_glow_blur_scale",4,0);
    const char* states[]={"infected-vomit","item","survivor-vomit","item-far","critical"};
    const char* prefixes[]={"cl_glow_infected_vomit_","cl_glow_item_","cl_glow_survivor_vomit_","cl_glow_item_far_","cl_glow_survivor_health_crit_"};
    for(auto prefix:prefixes)for(int j=0;j<3;++j){std::string name=prefix;name+="rgb"[j];set(name.c_str(),.1f*(j+1),0);}
    const char* models[]={"gambler","producer","coach","mechanic","namvet","teenangst","biker","manager"};
    for(int i=0;i<8;++i){auto name=std::string("models/survivors/survivor_")+models[i]+".mdl";model(100+i,name.c_str());actor(i+2,2,0,100,0,0,i,100+i);}
    model(200,"models/w_models/weapons/w_laser_sights.mdl");model(201,"models/w_models/weapons/w_upgradepack_explosive.mdl");
    auto sourceModule=load(root/L"beacon.source/plugin.dll");L4P_PluginApiV1 sourcePlugin{1,sizeof(sourcePlugin)},feature{1,sizeof(feature)};
    sym<L4P_GetPluginApiFn>(sourceModule,"L4P_GetPluginApi")(1,&sourcePlugin);auto dir=(root/L"beacon.source").u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,dir.c_str(),"{}"};require(!sourcePlugin.init(&host),"Source init");
    L4P_SourceApiV1 source{1,sizeof(source)};sym<L4P_GetSourceApiFn>(sourceModule,"L4P_GetSourceApi")(1,&source);
    require(!sym<L4P_GetEntityApiFn>(sourceModule,"L4P_GetEntityApi")(1,&entities),"Entity API");auto getCvar=sym<L4P_GetCvarApiFn>(sourceModule,"L4P_GetCvarApi");
    require(!getCvar(3,reinterpret_cast<L4P_CvarApiV1*>(&cvars)),"Cvar V3");L4P_CvarApiV1 v1{1,sizeof(v1)};L4P_CvarApiV2 v2{2,sizeof(v2)};
    require(!getCvar(1,&v1)&&!getCvar(2,reinterpret_cast<L4P_CvarApiV1*>(&v2))&&v1.struct_size==sizeof(v1)&&v2.struct_size==sizeof(v2),"V1/V2 negotiation preserved");
    require(!sym<L4P_GetResourceApiFn>(sourceModule,"L4P_GetResourceApi")(1,&resources),"Resource API");source.subscribe("fixture.team-glow",0,"",nullptr,frame,nullptr,&probe);
    for(int i=0;i<100&&!frames;++i){Sleep(20);paint();}require(frames,"Paint hook");checkShort=badRelative=true;paint();checkShort=badRelative=false;
    auto module=load(root/L"skeeto.team-glow-style/plugin.dll");sym<L4P_GetPluginApiFn>(module,"L4P_GetPluginApi")(1,&feature);
    dir=(root/L"skeeto.team-glow-style").u8string();host.plugin_directory=dir.c_str();require(!feature.init(&host),"feature init");event("game_newmap");paint();
    char output[32768]{};uint32_t size=0;
    auto invoke=[&](const char* action,const json& args=json::object()){auto s=args.dump();auto code=feature.invoke(action,s.c_str(),output,sizeof(output),&size);require(!code,action);return json::parse(output);};
    auto configure=[&](const json& args){invoke("configure",args);paint();};auto refresh=[&]{configure({{"active",true}});};
    auto close=[](float a,float b){return std::abs(a-b)<.0001f;};float rgba[4]{},rgb[3]{};int fields[4]{};
    int colourCheck=0;auto nativeColor=[&](int index,int color,float alpha=.25f){++colourCheck;native(index,rgba);bool ok=close(rgba[0],(color&255)/255.f)&&close(rgba[1],((color>>8)&255)/255.f)&&close(rgba[2],((color>>16)&255)/255.f)&&close(rgba[3],alpha);
        if(!ok)std::cerr<<"Colour check "<<colourCheck<<" entity "<<index<<" expected "<<color<<" / "<<alpha<<" actual "<<rgba[0]<<","<<rgba[1]<<","<<rgba[2]<<","<<rgba[3]<<'\n';require(ok,"expected native role RGB/alpha");};
    auto original=[&](int index){native(index,rgba);require(close(rgba[0],.2f)&&close(rgba[3],.25f),"native colour preserved");};
    original(2);require(value("cl_glow_brightness")==2,"default untouched");invoke("role-presets");paint();
    const int presets[]={RGB(185,230,255),RGB(180,92,255),RGB(255,201,40),RGB(36,224,163),RGB(111,175,69),RGB(240,79,100),RGB(255,122,34),RGB(57,169,255)};
    for(int i=0;i<8;++i)nativeColor(i+2,presets[i]);original(1);
    configure({{"brightness",150},{"blur",50}});require(value("cl_glow_brightness")==3&&value("cl_glow_blur_scale")==2,"relative baseline factors");
    refresh();require(value("cl_glow_brightness")==3,"repeated factor does not compound");retarget("cl_glow_brightness",6,0);refresh();require(value("cl_glow_brightness")==9,"new identity baseline");
    json config=json::object();for(auto key:states){config[key]="自定义";config[std::string(key)+"-rgb"]="#123456";}configure(config);
    for(auto prefix:prefixes)for(int j=0;j<3;++j){std::string name=prefix;name+="rgb"[j];require(close(value(name.c_str()),float(0x12+0x22*j)/255),"five normalized RGB triples");}
    auto saved=invoke("status")["settings"];char tiny[1]{};require(feature.invoke("reset-roles","{}",tiny,sizeof(tiny),&size)==L4P_BUFFER_TOO_SMALL,"action capacity checked");require(invoke("status")["settings"]==saved,"small action leaves config");
    for(auto invalid:{"{\"nick-rgb\":\"#12345Z\"}","{\"brightness\":201}","{\"blur\":49}","{\"nick\":\"unknown\"}","{\"surprise\":true}"})require(feature.invoke("configure",invalid,output,sizeof(output),&size)==L4P_BAD_ARGUMENT,"invalid settings rejected");
    configure({{"active",false}});original(2);require(value("cl_glow_brightness")==6&&value("cl_glow_blur_scale")==4&&close(value("cl_glow_item_r"),.1f),"disable exact restore");refresh();
    actor(2,2,0,100,0,0,7,100);refresh();nativeColor(2,presets[7]); // Explicit ID outranks model.
    actor(2,2,0,100,0,0,0,104);refresh();nativeColor(2,presets[4]); // Model outranks map.
    actor(2,2,0,100,0,0,0,0);player(2,"Zoey",8,1);refresh();nativeColor(2,presets[5]);
    actor(2,2,0,100,0,0,1,0);player(2,"Bill",8,0);refresh();nativeColor(2,presets[1]);
    player(2,"Bill fan",8,1);refresh();nativeColor(2,presets[1]);
    map("addons/custom_campaign");event("game_newmap");actor(2,2,0,100,0,0,0,0);player(2,"Bill",8,1);actor(3,2,0,100,0,0,1,0);player(3,"Zoey",9,1);actor(4,2,0,100,0,0,2,0);refresh();nativeColor(4,presets[7]);
    map("c13m1_alpinecreek");event("game_newmap");refresh();nativeColor(4,presets[2]);map("c14m1_junkyard");event("game_newmap");refresh();nativeColor(4,presets[7]);
    actor(2,2,0,100,0,5,0,100);actor(3,2,0,100,0,0,1,101);player(2,"A",33,0);player(3,"B",33,0);refresh();original(2);nativeColor(3,presets[1]);
    player(3,"B",99,0);actor(3,2,1,0,1,0,1,101);refresh();nativeColor(3,presets[1]); // Incap stays, despite dead-looking fields.
    actor(3,2,1,0,0,0,1,101);player(3,"B",99,0);refresh();original(3);
    for(int i=1;i<=18;++i){actor(i,2,0,100,0,0,0,100);player(i,"Human",100+i,0);}refresh();nativeColor(16,presets[0]);original(17); // 16 slots including local.
    for(int i=3;i<=18;++i)present(i,0);player(2,"Human",102,0);refresh();
    configure({{"nick","自定义"},{"nick-rgb","#A1B2C3"},{"always",true}});nativeColor(2,RGB(161,178,195),1);
    mode(2);paint();nativeColor(2,RGB(161,178,195));require(value("cl_glow_brightness")==9,"relative scope handoff");
    text("mp_gamemode","realism");paint();original(2);require(value("cl_glow_brightness")==6&&close(value("cl_glow_item_r"),0x12/255.f),"realism renderer original, states independent");
    text("mp_gamemode","coop");retarget("cl_glow_brightness",7,1<<14);refresh();require(value("cl_glow_brightness")==7,"restricted remote cvar preserved");mode(1);paint();require(value("cl_glow_brightness")==10.5f&&sym<int(__cdecl*)(const char*)>(vars,"FixtureFlags")("cl_glow_brightness")==1<<14,"local cvar with flags restored");
    invoke("reset-render");paint();require(value("cl_glow_brightness")==7&&value("cl_glow_blur_scale")==4,"render reset");nativeColor(2,RGB(161,178,195));
    invoke("reset-states");paint();require(close(value("cl_glow_item_r"),.1f),"state reset");invoke("reset-roles");paint();original(2);
    for(int i=65;i<75;++i)laser(i,200,0,0);configure({{"laser",true}});
    for(int i=65;i<73;++i){raw(i,fields,rgb);require(fields[0]==3&&fields[1]==32767&&fields[3]==RGB(255,70,70),"laser cap native fields");}raw(73,fields,rgb);require(fields[0]==0,"laser cap eight");
    laser(65,200,0x1001,0);refresh();raw(65,fields,rgb);require(fields[0]==0&&fields[1]==40&&fields[2]==7,"pickup restored");raw(73,fields,rgb);require(fields[0]==3,"next laser fills slot");
    laser(66,200,~0u,32);refresh();raw(66,fields,rgb);require(fields[0]==0,"NODRAW restored");raw(74,fields,rgb);require(fields[0]==3,"unowned handle sentinel");
    laser(67,201,0,0);refresh();raw(67,fields,rgb);require(fields[0]==0,"wrong model restored");external(68,2,555,10,0x334455);refresh();raw(68,fields,rgb);require(fields[0]==2&&fields[1]==555&&fields[3]==0x334455,"foreign outline preserved");
    resource="skeeto.hud.hide-world";paint();raw(69,fields,rgb);require(fields[0]==0,"hide world restores");resource="";refresh();raw(69,fields,rgb);require(fields[0]==3,"hide release resumes");
    resource="skeeto.hud.pause-sampling";paint();raw(69,fields,rgb);require(fields[0]==0,"pause restores");resource="";refresh();
    actor(1,2,1,0,0,0,0,100);paint();raw(69,fields,rgb);require(fields[0]==0,"local death restores");actor(1,2,0,100,0,0,0,100);refresh();
    for(auto boundary:{"round_end","map_transition","mission_lost","finale_vehicle_leaving","finale_win"}){event(boundary);paint();raw(69,fields,rgb);require(fields[0]==0,"mission quiet");event("round_start");paint();raw(69,fields,rgb);require(fields[0]==3,"round resumes");}
    mode(2);paint();raw(69,fields,rgb);require(fields[0]==0,"remote releases local laser");mode(1);paint();
    configure({{"laser",false}});for(int i=65;i<75;++i)present(i,0);laser(2047,200,0,0);configure({{"laser",true}});raw(2047,fields,rgb);require(fields[0]==0,"high index scan bounded");
    for(int i=0;i<17;++i)refresh();raw(2047,fields,rgb);require(fields[0]==3,"high index eventual discovery");
    configure({{"nick","角色预设"},{"brightness",150}});feature.shutdown();paint();original(2);raw(2047,fields,rgb);require(fields[0]==0&&value("cl_glow_brightness")==7,"shutdown both subscriptions restored");
    require(fs::exists(root/L"skeeto.team-glow-style/config.json"),"independent config saved");source.unsubscribe(probe);sourcePlugin.shutdown();paint();
    std::cout<<"PASS: full team glow DLL, eight roles/cast/dedup, 15 channels, relative baselines, local gates, laser lifecycle, settings and cleanup\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
