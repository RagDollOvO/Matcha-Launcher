// Owned silent PCM assets + real Media Foundation / waveOut; never starts a game.
#define NOMINMAX
#include <windows.h>
#include "l4p_entity.h"
#include "l4p_resource.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <iostream>
#include <vector>
#include <stdexcept>
namespace fs=std::filesystem;using nlohmann::json;
void require(bool value,const char* why){if(!value)throw std::runtime_error(why);}
void L4P_CALL log(void*,uint32_t,const char*){}
template<class T>T symbol(HMODULE m,const char* name){auto p=reinterpret_cast<T>(GetProcAddress(m,name));require(p,name);return p;}
L4P_EntityApiV2 entity{{2,sizeof(entity)}};L4P_ResourceApiV1 resource{1,sizeof(resource)};uint32_t token=0;int frames=0,op=0,result=0,value=0;L4P_EntityInfoV1 player{sizeof(player)};
void L4P_CALL frame(void*,const L4P_SourceFrameV1*){++frames;L4P_EntityRefV1 ref{};switch(op){
case 1:require(entity.base.reference(70,&ref)==0,"roster reference");result=entity.read_index(&ref,"m_iTeam",1,&value);break;
case 2:entity.base.reference(70,&ref);result=entity.read_index(&ref,"m_bAlive",1,&value);break;
case 3:entity.base.reference(70,&ref);result=entity.read_index(&ref,"m_isIncapacitated",1,&value);break;
case 4:entity.base.reference(70,&ref);result=entity.read_index(&ref,"m_iTeam",65,&value);break;
case 5:result=entity.player_info(2,&player);break;
case 6:resource.claim(token,"skeeto.hud.hide-all");break;
case 7:resource.release(token,"skeeto.hud.hide-all");break;
default:break;}}
std::vector<unsigned char> silence(){std::vector<unsigned char> data(44+22050*2*4);memcpy(data.data(),"RIFF",4);memcpy(data.data()+8,"WAVEfmt ",8);memcpy(data.data()+36,"data",4);
 auto put32=[&](int at,uint32_t n){memcpy(data.data()+at,&n,4);};auto put16=[&](int at,uint16_t n){memcpy(data.data()+at,&n,2);};put32(4,data.size()-8);put32(16,16);put16(20,1);put16(22,1);put32(24,22050);put32(28,44100);put16(32,2);put16(34,16);put32(40,data.size()-44);return data;}
struct DrawCounts{int begins,ends,pushes,pops,flushes,shapes,texts,textures,errors,root;};
int wmain(int argc,wchar_t** argv){try{
 require(argc==4,"music_smoke <dist plugins> <fixture DLL directory> <fresh root>");fs::path dist=fs::absolute(argv[1]),fake=fs::absolute(argv[2]),root=fs::absolute(argv[3]);require(!fs::exists(root),"fresh root");
 auto loadDll=[](const fs::path& p){auto m=LoadLibraryExW(p.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(m,"DLL load");return m;};
 auto engine=loadDll(fake/L"engine.dll"),client=loadDll(fake/L"client.dll"),vars=loadDll(fake/L"vstdlib.dll"),file=loadDll(fake/L"filesystem_stdio.dll"),surface=loadDll(fake/L"vguimatsurface.dll");
 auto paint=symbol<void(__cdecl*)()>(engine,"FixturePaint");auto mode=symbol<void(__cdecl*)(int)>(engine,"FixtureMode");auto event=symbol<void(__cdecl*)(const char*)>(engine,"FixtureEvent");auto emit=symbol<float(__cdecl*)(const char*,float)>(engine,"FixtureEmit");
 auto gameMode=symbol<void(__cdecl*)(const char*,const char*)>(vars,"FixtureString");gameMode("mp_gamemode","coop");symbol<void(__cdecl*)(int)>(engine,"FixturePlayerLimit")(2);
 auto roster=symbol<void(__cdecl*)(int,int,int,int,int,int,int)>(client,"FixtureRoster");auto missing=symbol<void(__cdecl*)(int)>(client,"FixtureRosterMissing");auto hanging=symbol<void(__cdecl*)(int,int)>(client,"FixtureRosterHanging");
 auto add=symbol<void(__cdecl*)(const char*,const void*,unsigned,int)>(file,"FixtureFsAdd");auto stats=symbol<void(__cdecl*)(int*)>(file,"FixtureFsStats");auto save=symbol<int(__cdecl*)(const wchar_t*)>(surface,"FixtureDrawSave");auto clear=symbol<void(__cdecl*)()>(surface,"FixtureDrawClear");auto counts=symbol<void(__cdecl*)(void*)>(surface,"FixtureDrawCounts");
 auto load=[&](const wchar_t* id){auto dir=root/L"bin/l4p/plugins"/id;fs::create_directories(dir);fs::copy_file(dist/id/L"plugin.dll",dir/L"plugin.dll");auto m=loadDll(dir/L"plugin.dll");L4P_PluginApiV1 api{1,sizeof(api)};require(symbol<L4P_GetPluginApiFn>(m,"L4P_GetPluginApi")(1,&api)==0,"plugin API");return std::make_pair(m,api);};
 auto bridge=load(L"beacon.source");auto base=(root/L"bin/l4p/plugins/beacon.source").u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,base.c_str(),"{}"};require(bridge.second.init(&host)==0,"Source init");L4P_SourceApiV1 source{1,sizeof(source)};
 symbol<L4P_GetSourceApiFn>(bridge.first,"L4P_GetSourceApi")(1,&source);require(symbol<L4P_GetEntityApiFn>(bridge.first,"L4P_GetEntityApi")(2,&entity.base)==0,"Entity API2");symbol<L4P_GetResourceApiFn>(bridge.first,"L4P_GetResourceApi")(1,&resource);source.subscribe("fixture.music",0,"",nullptr,frame,nullptr,&token);
 auto step=[&](int ms=20){Sleep(ms);paint();};auto run=[&](int n){op=n;step();op=0;return result;};mode(1);for(int i=0;i<100&&!frames;++i)step();require(frames,"Paint hook");
 roster(1,2,255,-123,2,1,0);require(run(1)==0&&value==2,"int32 array");require(run(2)==0&&value==255,"uint8 array");require(run(3)==0&&value==-123,"int16 array");value=123;require(run(4)==L4P_BAD_ARGUMENT&&value==123,"array bounds and output");missing(1);require(run(5)==0&&!player.ref.index&&player.user_id==8&&player.player_name[0],"player info outside PVS");missing(0);roster(1,2,1,0,2,1,0);
 auto bytes=silence();add("sound/skeeto/safe/中文.wav",bytes.data(),bytes.size(),0);add("sound/skeeto/safe/Another.mp3",bytes.data(),bytes.size(),0);add("sound/skeeto/safe/folder.wav",nullptr,0,1);add("sound/skeeto/the last man/Rainie_Love.mp3",bytes.data(),bytes.size(),0);
 auto music=load(L"skeeto.endgame-music");base=(root/L"bin/l4p/plugins/skeeto.endgame-music").u8string();host.plugin_directory=base.c_str();host.config_json="{\"safe_volume\":0,\"last_volume\":0}";require(music.second.init(&host)==0,"Music init");
 std::vector<char> output(65536);uint32_t size=0;auto call=[&](const char* action,const json& args=json::object()){auto text=args.dump();require(music.second.invoke(action,text.c_str(),output.data(),output.size(),&size)==0,action);return json::parse(output.data());};
 auto configure=[&](const json& config){call("configure",config);step();};auto state=[&](const char* name){auto j=call("playback");for(auto& i:j["sections"][0]["items"])if(i["label"]==name)return std::stoi(i["value"].get<std::string>());throw std::runtime_error(name);};
 auto wait=[&](auto predicate,int timeout,const char* why){auto until=GetTickCount()+timeout;do{step();if(predicate())return;}while(int32_t(until-GetTickCount())>0);std::cerr<<call("playback").dump()<<'\n';throw std::runtime_error(why);};
 require(emit("music/safe/themonsterswithout.wav",.7f)==.7f,"disabled original");configure({{"safe_enabled",true},{"safe_track","中文.wav"}});
 require(emit("music/safe/themonsterswithout.wav",.7f)==.7f,"unprepared original");wait([&]{return state("safeState")==1;},7000,"safe ready from mounted WAV");
 auto tracks=call("tracks");require(tracks["sections"][0]["items"].size()==2,"WAV+MP3 catalog excludes directory");require(emit(")MUSIC\\SAFE\\THEMONSTERSWITHOUT.WAV",.7f)==0,"native endgame match");wait([&]{return state("safeStarts")==1;},1500,"safe real waveOut start");
 require(emit("music/safe/unrelated.wav",.7f)==.7f,"unrelated original");require(emit("music/safe/themonsterswithout_l4d1.wav",.7f)==0,"one chapter replacement");step(150);require(state("safeStarts")==1,"one playback per chapter");
 call("stop");step();require(state("safeState")!=2,"explicit stop");event("round_start");wait([&]{return state("safeState")==1;},5000,"round prepare");event("map_transition");wait([&]{return state("safeStarts")==2;},1500,"event fallback with hooked ABI");
 gameMode("mp_gamemode","scavenge");step(1100);require(emit("music/safe/themonsterswithout.wav",.7f)==.7f,"scavenge original");gameMode("mp_gamemode","coop");
 configure({{"safe_enabled",false}});mode(0);step();call("preview");wait([&]{return state("safeStarts")==3;},6000,"menu preview while automatic disabled");call("stop");step();configure({{"safe_track","missing.wav"},{"safe_enabled",true}});mode(1);wait([&]{return state("safeState")==-1;},4000,"missing selection state");require(emit("music/safe/themonsterswithout.wav",.7f)==.7f,"missing selection original");
 configure({{"safe_track","Another.mp3"}});wait([&]{return state("safeState")==1;},5000,"media content probing");configure({{"safe_random",true}});call("rescan");wait([&]{return state("safeState")==1;},5000,"random rescan ready");configure({{"safe_enabled",false}});
 require(music.second.invoke("configure","{\"safe_track\":\"../x.wav\"}",output.data(),output.size(),&size)==L4P_BAD_ARGUMENT,"basename constraint");require(music.second.invoke("configure","{\"notice_scale\":201}",output.data(),output.size(),&size)==L4P_BAD_ARGUMENT,"notice bounds");char tiny='!';require(music.second.invoke("preview","{}",&tiny,1,&size)==L4P_BUFFER_TOO_SMALL,"capacity before preview");step(150);require(state("safeStarts")==3,"tiny action no side effect");
 call("adjust-volume",{{"channel","safe"},{"direction",1}});require(call("status")["settings"]["safe_volume"]==5,"volume step");configure({{"safe_volume",0},{"last_enabled",true},{"last_mode","仅一人未倒地"}});wait([&]{return state("lastState")==1;},5000,"last track ready");
 auto settle=[&](){step(1100);step(100);};settle();require(state("lastStarts")==0,"both standing");missing(1);roster(1,2,1,0,2,1,1);wait([&]{return state("lastStarts")==1;},2500,"outside PVS incapacitated roster triggers last");missing(0);step(150);clear();paint();DrawCounts drawn{};counts(&drawn);require(drawn.texts>0&&!drawn.errors,"native notice drawn");require(save((root/L"notice.bmp").c_str()),"notice render");
 run(6);auto before=drawn.texts;counts(&drawn);before=drawn.texts;step();counts(&drawn);require(drawn.texts==before,"shared hide-all gate");run(7);
 roster(1,2,1,0,2,1,0);wait([&]{return state("lastState")!=2;},1600,"auto stop");
 configure({{"last_mode","仅一人存活"}});roster(1,2,1,0,2,0,0);wait([&]{return state("lastStarts")==2;},1600,"one alive mode");roster(1,2,1,0,2,1,0);settle();
 configure({{"last_mode","仅自己存活"}});roster(1,2,0,0,2,1,0);settle();require(state("lastStarts")==2,"other survivor excludes self-alive mode");roster(1,2,1,0,2,0,0);wait([&]{return state("lastStarts")==3;},1600,"self alive mode");roster(1,2,1,0,2,1,0);settle();
 configure({{"last_mode","仅自己未倒地"},{"last_auto_stop",false}});hanging(2,1);wait([&]{return state("lastStarts")==4;},1600,"hanging leaves self standing");hanging(2,0);settle();require(state("lastState")==2,"auto stop off holds playback");call("stop");step();require(state("lastState")!=2,"manual last stop");
 configure({{"last_mode","团灭后"},{"last_auto_stop",true}});settle();event("mission_lost");wait([&]{return state("lastStarts")==5;},1600,"mission lost mode");event("round_start");step();require(state("lastState")!=2,"round resets last");roster(1,2,0,0,2,0,0);wait([&]{return state("lastStarts")==6;},1700,"zero alive mode");
 event("round_start");roster(0,2,1,0,2,0,0);configure({{"last_mode","仅一人存活"}});wait([&]{return state("lastStarts")==7;},2500,"entity fallback roster");roster(0,2,1,0,1,0,0);wait([&]{return state("lastState")!=2;},1600,"one survivor below minimum");
 configure({{"last_enabled",false}});call("preview-notice");step();step(150);counts(&drawn);before=drawn.texts;paint();counts(&drawn);require(drawn.texts>before,"explicit notice preview when music disabled");
 const char corrupt[]="invalid audio";add("sound/skeeto/safe/broken.wav",corrupt,sizeof(corrupt),0);configure({{"safe_enabled",true},{"safe_random",false},{"safe_track","broken.wav"}});call("rescan");wait([&]{return state("safeState")==-1;},4000,"decoder failure surfaced");require(emit("music/safe/themonsterswithout.wav",.7f)==.7f,"decoder failure preserves original");
 configure({{"active",false}});step(150);int fstats[5]{};stats(fstats);require(!fstats[0]&&!fstats[1]&&!fstats[2],"all native files/searches closed");
 music.second.shutdown();paint();const auto cache=root/L"bin/l4p/plugins/skeeto.endgame-music/media-cache";require(!fs::exists(cache)||fs::is_empty(cache),"private extracted cache removed after workers stop");source.unsubscribe(token);bridge.second.shutdown();paint();
 std::cout<<"PASS: mounted music, real MF/waveOut, native replacement, chapter/menu/mode gates, five roster conditions, PVS/arrays, notice, config and owned cleanup\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
