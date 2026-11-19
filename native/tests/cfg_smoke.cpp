#define NOMINMAX
#include <windows.h>
#include "l4p_cvar.h"
#include "owned_input.hpp"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <functional>
#include <stdexcept>
using nlohmann::json;namespace fs=std::filesystem;
void require(bool v,const char* why){if(!v)throw std::runtime_error(why);}
template<class T>T sym(HMODULE h,const char* name){auto p=reinterpret_cast<T>(GetProcAddress(h,name));require(p,name);return p;}
void L4P_CALL log(void*,uint32_t,const char*){}
DWORD now=1000;DWORD WINAPI clockValue(){return now;}
std::map<std::string,std::function<void()>> programs;
void __cdecl execute(const char* command){auto i=programs.find(command);if(i!=programs.end())i->second();}
L4P_CvarApiV4 api{{{4,sizeof(api)}}};L4P_CvarApiV1 old{1,sizeof(old)};uint32_t probe=0,local=0,op=0,result=0;int frames=0;const char* variable="test_value";
void L4P_CALL frame(void*,const L4P_SourceFrameV1*){++frames;
    if(op==1)result=api.checkpoint(probe,variable);if(op==2)result=api.checkpoint(local,variable);if(op==3)result=api.restore_checkpoints(probe);if(op==4)result=api.restore_checkpoints(local);
    if(op==5)result=old.pin(probe,variable,88);if(op==6)result=old.pin(local,variable,88);if(op==7)result=api.checkpoint(0,variable);
}
void L4P_CALL noop(void*,const L4P_SourceFrameV1*){}
int wmain(int argc,wchar_t** argv){try{
    require(argc==4,"cfg_smoke <dist plugins> <source fixtures> <fresh root>");auto dist=fs::absolute(argv[1]),fixture=fs::absolute(argv[2]),root=fs::absolute(argv[3]);require(!fs::exists(root),"fresh root");auto packs=root/L"bin/l4p/plugins",cfg=root/L"left4dead2/cfg";fs::create_directories(cfg);
    auto write=[&](std::string file,std::string text){std::ofstream stream(cfg/fs::u8path(file),std::ios::binary);stream<<text;require(bool(stream),"fixture CFG");};
    write("autoexec.cfg","echo untouched; alias own_alias \"echo a;b\"\n");write("skeeto_b.cfg","beta 25\nalpha 30\n");write("Skeeto_A.CFG","\xef\xbb\xbf// 原样说明\r\n\r\nalpha 10; gamma 22\r\nskt_cvar beta 20\nSKeeTO_CVAR restricted 9\nalias my_alias \"delta 33\"\nexec nested.cfg\n# ignored 2\nalpha\n");
    write("not_a_preset.cfg","ignored 1\n");write("skeeto_.cfg","ignored 1\n");fs::create_directories(cfg/L"skeeto_directory.cfg");
    auto load=[](fs::path path){auto h=LoadLibraryExW(fs::absolute(path).c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(h,"DLL load");return h;};
    auto engine=load(fixture/L"engine.dll"),vars=load(fixture/L"vstdlib.dll");auto paint=sym<void(__cdecl*)()>(engine,"FixturePaint");auto mode=sym<void(__cdecl*)(int)>(engine,"FixtureMode");auto event=sym<void(__cdecl*)(const char*)>(engine,"FixtureEvent");auto commands=sym<int(__cdecl*)()>(engine,"FixtureCommands");auto last=sym<const char*(__cdecl*)()>(engine,"FixtureLastCommand");
    auto setVar=sym<void(__cdecl*)(const char*,float,int)>(vars,"FixtureSet");auto value=sym<float(__cdecl*)(const char*)>(vars,"FixtureValue");auto flags=sym<int(__cdecl*)(const char*)>(vars,"FixtureFlags");auto retarget=sym<void(__cdecl*)(const char*,float,int)>(vars,"FixtureRetarget");auto reject=sym<void(__cdecl*)(const char*,int)>(vars,"FixtureReject");
    sym<void(__cdecl*)(void(__cdecl*)(const char*))>(engine,"FixtureCommandSink")(execute);
    auto init=[&](const wchar_t* id,const char* config){auto path=packs/id;fs::create_directories(path);fs::copy_file(dist/id/L"plugin.dll",path/L"plugin.dll");auto module=load(path/L"plugin.dll");L4P_PluginApiV1 p{1,sizeof(p)};require(!sym<L4P_GetPluginApiFn>(module,"L4P_GetPluginApi")(1,&p),"plugin ABI");
        if(!wcscmp(id,L"beacon.source"))require(owned_input::replace(module,"GetTickCount",reinterpret_cast<void*>(&clockValue)),"isolated clock");auto directory=path.u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,directory.c_str(),config};require(!p.init(&host),"init");return std::make_pair(module,p);};
    mode(1);auto source=init(L"beacon.source","{}");L4P_SourceApiV1 sdk{1,sizeof(sdk)};sym<L4P_GetSourceApiFn>(source.first,"L4P_GetSourceApi")(1,&sdk);
    auto get=sym<L4P_GetCvarApiFn>(source.first,"L4P_GetCvarApi");require(!get(4,reinterpret_cast<L4P_CvarApiV1*>(&api))&&!get(1,&old),"Cvar1/4 negotiation");L4P_CvarApiV3 v3{{3,sizeof(v3)}};require(!get(3,reinterpret_cast<L4P_CvarApiV1*>(&v3)),"Cvar3 prefix preserved");
    sdk.subscribe("fixture.cfg",0,"",nullptr,frame,nullptr,&probe);sdk.subscribe("fixture.cfg.local",1,"",nullptr,noop,nullptr,&local);for(int i=0;i<100&&!frames;++i){Sleep(20);paint();}require(frames,"Paint ready");
    auto tick=[&](unsigned n=1){now+=n;paint();};auto run=[&](unsigned action){op=action;paint();op=0;return result;};
    setVar(variable,1,0);require(api.checkpoint(probe,variable)==L4P_BAD_ARGUMENT&&run(7)==L4P_BAD_ARGUMENT,"capture callback and live token gates");require(!run(1)&&value(variable)==1,"checkpoint leaves value unchanged");setVar(variable,2,0);require(!run(1),"repeated capture");require(run(5)==5&&run(6)==5,"checkpoint conflicts with own and foreign pin");require(!run(3)&&value(variable)==1,"first baseline retained");
    require(!run(5)&&value(variable)==88&&run(1)==5,"pin conflicts with checkpoint");require(!api.forget_checkpoints(probe)&&value(variable)==88,"forget leaves ordinary pins intact");old.release(probe,nullptr);tick();require(value(variable)==1,"ordinary V1 release unchanged");
    require(!run(1),"capture for forget");setVar(variable,3,0);api.forget_checkpoints(probe);require(!run(5),"forget frees name");old.release(probe,nullptr);tick();require(value(variable)==3,"forgotten baseline remains current");
    require(!run(1),"capture old variable");retarget(variable,17,0);require(!run(3)&&value(variable)==17,"recreated identity preserves new engine value");require(!run(1),"capture new identity");retarget(variable,18,0);require(!run(1),"recapture changed identity");setVar(variable,19,0);require(!run(3)&&value(variable)==18,"changed identity baseline refreshed");
    setVar(variable,4,1<<14);require(run(1)==6&&!run(2),"restricted capture LOCAL only");setVar(variable,9,1<<14);mode(2);tick();require(value(variable)==4&&flags(variable)==1<<14,"scope exit restores restricted checkpoint and flags");mode(1);
    setVar(variable,5,0);require(!run(1),"capture queue");setVar(variable,6,0);require(api.restore_checkpoints(probe)==L4P_ERROR&&value(variable)==6,"control-thread restore queues");tick();require(value(variable)==5&&!api.restore_checkpoints(probe),"queued restore completed");
    require(!run(1),"capture failure");setVar(variable,7,0);reject(variable,1);require(run(3)==L4P_ERROR&&value(variable)==7,"failed restore keeps baseline");reject(variable,0);tick();require(value(variable)==5&&!run(3),"retry restores original baseline");
    auto feature=init(L"skeeto.config-override","{\"file\":\"autoexec.cfg\",\"automatic\":false}");char output[65536]{};uint32_t size=0;
    auto invoke=[&](const char* action,json args=json::object()){auto text=args.dump();require(!feature.second.invoke(action,text.c_str(),output,sizeof(output),&size),action);return json::parse(output);};
    auto config=[&](const char* file,bool automatic,bool restore){invoke("configure",{{"file",file},{"automatic",automatic},{"restore",restore}});tick();};
    auto presets=invoke("presets");require(presets["presets"]==json::array({"Skeeto_A","skeeto_b"})&&presets["file"]=="autoexec.cfg","case-insensitive sorted loose presets without changing legacy selection");
    auto before=commands();invoke("apply");tick();require(commands()==before+1&&!strcmp(last(),"exec autoexec.cfg"),"legacy unrestricted complete file execution");
    programs["exec Skeeto_A.cfg"]=[&]{setVar("alpha",10,0);setVar("beta",20,0);setVar("restricted",9,1<<14);setVar("gamma",22,0);setVar("delta",33,0);};
    programs["exec skeeto_b.cfg"]=[&]{setVar("beta",25,0);setVar("alpha",30,0);};
    setVar("alpha",1,0);setVar("beta",2,0);setVar("restricted",3,1<<14);setVar("gamma",4,0);setVar("delta",5,0);
    config("autoexec.cfg",false,true);invoke("next-preset");require(invoke("status")["automatic"]==true,"cycle enables chapter execution");tick();auto status=invoke("status");require(status["tracked"]==3&&value("alpha")==10&&value("beta")==20&&value("restricted")==9,"first tokens and wrapper tracking before native exec");
    auto preview=invoke("preview");require(preview["preview"][0]=="// 原样说明"&&preview["preview"][1]=="alpha 10; gamma 22"&&!preview["previewTruncated"].get<bool>(),"BOM/CRLF/raw preview");std::ofstream(root/L"preview-report.json",std::ios::binary)<<preview.dump(2);
    auto previousFile=status["file"];char tiny[1]{};require(feature.second.invoke("next-preset","{}",tiny,1,&size)==L4P_BUFFER_TOO_SMALL&&invoke("status")["file"]==previousFile,"cycle capacity checked before saving/queue");
    invoke("next-preset");tick();require(value("alpha")==30&&invoke("status")["tracked"]==3,"same-chapter switch additive and first baseline retained");
    // Switch to the ordinary file without applying, then emulate a chapter edge.
    config("autoexec.cfg",true,true);event("game_newmap");tick();require(value("alpha")==1&&value("beta")==2&&value("restricted")==3&&value("gamma")==22&&value("delta")==33,"chapter restores first-token captures, leaves alias and same-line tail values");
    require(invoke("status")["tracked"]==0,"chapter captures cleared");invoke("previous-preset");tick();require(invoke("status")["file"]=="Skeeto_A.cfg","unlisted current starts first preset");invoke("previous-preset");tick();require(invoke("status")["file"]=="skeeto_b.cfg","previous wraps");invoke("select-preset",{{"id","sKeEtO_a.CfG"}});tick();require(invoke("status")["file"]=="Skeeto_A.cfg","case-insensitive selected preset suffix");
    config("Skeeto_A.cfg",false,true);require(value("alpha")==1&&value("beta")==2,"turning automatic off restores optional baselines");invoke("apply");tick();require(value("alpha")==10,"manual apply still available with automatic off");
    config("Skeeto_A.cfg",false,false);tick();feature.second.shutdown();tick();require(value("alpha")==10&&value("beta")==20,"restore option off forgets instead of undoing settings, including shutdown");
    // Reinitialize the same DLL via its existing entry point and saved settings.
    auto directory=(packs/L"skeeto.config-override").u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,directory.c_str(),"{\"file\":\"Skeeto_A.cfg\",\"automatic\":false,\"restore\":true}"};require(!feature.second.init(&host),"feature reinit");tick();
    mode(2);setVar("alpha",1,0);setVar("beta",2,0);setVar("restricted",3,1<<14);invoke("apply");tick();status=invoke("status");require(status["tracked"]==2&&status["skippedCount"]==1&&status["skipped"][0]["name"]=="restricted"&&status["skipped"][0]["code"]==6,"remote reports skipped restricted baseline");
    mode(3);tick();require(value("alpha")==1&&value("beta")==2&&value("restricted")==9,"environment exit restores owned ordinary baselines only");mode(1);tick();
    variable="alpha";require(!run(5),"another module owns alpha");invoke("apply");tick();status=invoke("status");require(status["skippedCount"]==1&&status["skipped"][0]["code"]==5,"other module ownership reported");old.release(probe,nullptr);tick();
    // Failed restoration holds the next chapter's exec until the saved value can land.
    config("autoexec.cfg",true,true);reject("beta",1);before=commands();event("game_newmap");tick();require(commands()==before&&invoke("status")["restorationPending"]==true,"restore failure blocks dependent exec");tick(100);require(commands()==before,"bounded retry timing");reject("beta",0);tick(250);require(commands()==before+1&&value("beta")==2,"retry then complete native exec");
    std::string many;for(int i=0;i<100;++i){auto name="many_"+std::to_string(i);setVar(name.c_str(),float(i),0);many+=name+" 1000\n";}write("skeeto_many.cfg",many);
    programs["exec skeeto_many.cfg"]=[&]{for(int i=0;i<100;++i)setVar(("many_"+std::to_string(i)).c_str(),1000,0);};invoke("select-preset",{{"id","skeeto_many"}});tick();require(invoke("status")["tracked"]==96,"96 baseline limit");config("autoexec.cfg",true,true);event("server_spawn");tick();require(value("many_0")==0&&value("many_95")==95&&value("many_96")==1000,"tracking capacity and original untracked tail semantics");
    std::string longFile="// "+std::string(400,'x')+"\n";for(int i=0;i<90;++i)longFile+="// 原文 "+std::to_string(i)+"\n";longFile+=std::string(66000,'z');write("skeeto_long.cfg",longFile);config("skeeto_long.cfg",false,false);preview=invoke("preview");require(preview["preview"].size()==64&&preview["preview"][0].get<std::string>().size()==239&&preview["previewTruncated"]==true,"64 lines/239 bytes/64KiB preview bounds");invoke("apply");tick();require(!strcmp(last(),"exec skeeto_long.cfg")&&fs::file_size(cfg/L"skeeto_long.cfg")==longFile.size(),"preview limit does not truncate native execution or source file");
    // Rescan is read-only and excludes redirected files outside the configured CFG root.
    auto outside=root/L"outside.cfg";std::ofstream(outside)<<"echo outside";require(CreateSymbolicLinkW((cfg/L"skeeto_escape.cfg").c_str(),outside.c_str(),SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE),"owned test symlink");presets=invoke("presets");require(std::find(presets["presets"].begin(),presets["presets"].end(),"skeeto_escape")==presets["presets"].end(),"out-of-root preset excluded");
    for(int i=0;i<20;++i)write("skeeto_extra"+std::to_string(i)+".cfg","// file\n");require(invoke("presets")["presets"].size()==16,"16 preset cap");
    config("skeeto_long.cfg",false,false);invoke("apply");fs::rename(cfg/L"skeeto_long.cfg",cfg/L"saved-long.cfg");before=commands();tick();require(commands()==before&&!invoke("status")["error"].get<std::string>().empty(),"execution-time file recheck");
    // Disabling automatic cancels only automatic requests; explicit manual work survives.
    config("autoexec.cfg",true,false);event("game_newmap");invoke("configure",{{"file","autoexec.cfg"},{"automatic",false}});before=commands();tick();require(commands()==before,"automatic pending canceled when disabled");invoke("apply");event("server_spawn");tick();require(commands()==before+1,"manual queue remains usable");
    // Shutdown while checkpoints are actively held returns them on the next Paint.
    config("Skeeto_A.cfg",false,true);setVar("alpha",11,0);setVar("beta",12,0);setVar("restricted",13,1<<14);invoke("apply");tick();feature.second.shutdown();tick();require(value("alpha")==11&&value("beta")==12&&value("restricted")==13,"active plugin shutdown restores captured values");
    sdk.unsubscribe(probe);sdk.unsubscribe(local);source.second.shutdown();paint();std::cout<<"PASS CFG: Cvar1/3/4 ABI, checkpoints/scope/identity/retry, native exec compatibility, scan/cycle/preview, optional chapter restore, 16/64/96 limits, rechecks and shutdown\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
