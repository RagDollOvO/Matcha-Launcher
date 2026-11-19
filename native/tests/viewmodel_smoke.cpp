// Real Source + feature DLL in an owned x86 host. No game process or files.
#define NOMINMAX
#include <windows.h>
#include "l4p_source.h"
#include "l4p_viewmodel.h"
#include "../plugins/shared/viewmodel_profile.hpp"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <memory>
#include <thread>
using nlohmann::json;namespace fs=std::filesystem;
extern "C" int __cdecl FixtureCatchNative(void(__cdecl*)(void*),void*);
void require(bool value,const char* message){if(!value)throw std::runtime_error(message);}
template<class T>T sym(HMODULE h,const char* n){auto p=reinterpret_cast<T>(GetProcAddress(h,n));require(p,n);return p;}
void L4P_CALL log(void*,uint32_t,const char*){}
L4P_ViewmodelApiV1 vm{1,sizeof(vm)};L4P_ViewmodelSnapshotV1 snap{sizeof(snap)};L4P_ViewmodelPoseV1 poses[2]{};
uint32_t probe=0,other=0,operation=0,result=0,frames=0;
void L4P_CALL callback(void*,const L4P_SourceFrameV1*){++frames;if(operation==1)result=vm.snapshot(probe,&snap);if(operation==2)result=vm.set(probe,poses);if(operation==3)result=vm.set(other,poses);if(operation==4)result=vm.release(probe);}
void L4P_CALL noop(void*,const L4P_SourceFrameV1*){}
std::string read(const fs::path& file){std::ifstream stream(file,std::ios::binary);return {std::istreambuf_iterator<char>(stream),{}};}
void write(const fs::path& file,const std::string& body){fs::create_directories(file.parent_path());std::ofstream stream(file,std::ios::binary|std::ios::trunc);stream<<body;require(bool(stream),"write fixture");}
bool close_to(float a,float b){return std::abs(a-b)<.0002f;}
void diagram(const fs::path& file,float (*bone)(int,int,int,int)){
    constexpr int width=1000,height=520;BITMAPINFO bi{};bi.bmiHeader={sizeof(BITMAPINFOHEADER),width,-height,1,32,BI_RGB};void* pixels=nullptr;
    HDC dc=CreateCompatibleDC(nullptr);auto bitmap=CreateDIBSection(dc,&bi,DIB_RGB_COLORS,&pixels,nullptr,0);auto previous=SelectObject(dc,bitmap);
    RECT canvas{0,0,width,height};auto background=CreateSolidBrush(RGB(247,244,236));FillRect(dc,&canvas,background);DeleteObject(background);SetBkMode(dc,TRANSPARENT);SetTextColor(dc,RGB(38,42,44));
    auto font=CreateFontW(22,0,0,0,400,FALSE,FALSE,FALSE,DEFAULT_CHARSET,0,0,0,0,L"Segoe UI");auto oldFont=SelectObject(dc,font);
    const wchar_t* title=L"Viewmodel SDK | actual x86 fixture bone matrices";TextOutW(dc,36,25,title,lstrlenW(title));
    const wchar_t* subtitle=L"2x centroid scale + camera-plane mirror; gray bone excluded by mask";TextOutW(dc,36,58,subtitle,lstrlenW(subtitle));
    auto line=[&](int x,int y,int x2,int y2,COLORREF color,int thick){auto pen=CreatePen(PS_SOLID,thick,color);auto old=SelectObject(dc,pen);MoveToEx(dc,x,y,nullptr);LineTo(dc,x2,y2);SelectObject(dc,old);DeleteObject(pen);};
    line(500,110,500,480,RGB(195,181,155),1);line(90,390,910,390,RGB(195,181,155),1);
    for(int b=0;b<3;++b){float y=bone(0,b,1,3),z=bone(0,b,2,3);int x=500+int(y*12),up=390-int((z-25)*18);COLORREF color=b==1?RGB(150,150,150):RGB(35,94,142);
        auto brush=CreateSolidBrush(color);auto old=SelectObject(dc,brush);Ellipse(dc,x-6,up-6,x+6,up+6);SelectObject(dc,old);DeleteObject(brush);
        for(int axis=0;axis<3;++axis){int x2=x+int(bone(0,b,1,axis)*24),y2=up-int(bone(0,b,2,axis)*24);line(x,up,x2,y2,axis==2?RGB(184,119,34):color,3);}
        std::wstring label=L"bone "+std::to_wstring(b);TextOutW(dc,x+12,up+12,label.c_str(),int(label.size()));}
    const wchar_t* labels[]={L"mirrored",L"native / mask excluded"};TextOutW(dc,150,440,labels[0],lstrlenW(labels[0]));TextOutW(dc,690,440,labels[1],lstrlenW(labels[1]));
    BITMAPFILEHEADER header{};header.bfType=0x4d42;header.bfOffBits=sizeof(header)+sizeof(BITMAPINFOHEADER);header.bfSize=header.bfOffBits+width*height*4;
    std::ofstream stream(file,std::ios::binary);stream.write(reinterpret_cast<char*>(&header),sizeof(header));stream.write(reinterpret_cast<char*>(&bi.bmiHeader),sizeof(bi.bmiHeader));stream.write(static_cast<char*>(pixels),width*height*4);
    SelectObject(dc,oldFont);DeleteObject(font);SelectObject(dc,previous);DeleteObject(bitmap);DeleteDC(dc);require(bool(stream),"bone diagram saved");
}
int wmain(int argc,wchar_t** argv){try{
    require(argc==5,"viewmodel_smoke <dist> <fixtures> <fresh root> <normal|unsupported|fault-setter|fault-mirror|fault-camera>");
    auto dist=fs::absolute(argv[1]),fixtures=fs::absolute(argv[2]),root=fs::absolute(argv[3]);std::wstring variant=argv[4];require(!fs::exists(root),"fresh root");auto plugins=root/L"bin/l4p/plugins";
    for(auto id:{L"beacon.source",L"skeeto.viewmodel"}){fs::create_directories(plugins/id);fs::copy_file(dist/id/L"plugin.dll",plugins/id/L"plugin.dll");}
    auto load=[](const fs::path& path){auto h=LoadLibraryExW(path.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);require(h,"load DLL");return h;};
    auto engine=load(fixtures/L"source/engine.dll"),client=load(fixtures/L"viewmodel/client.dll"),vars=load(fixtures/L"source/vstdlib.dll");
    auto paint=sym<void(__cdecl*)()>(engine,"FixturePaint");auto mode=sym<void(__cdecl*)(int)>(engine,"FixtureMode");
    auto model=sym<void(__cdecl*)(int,const char*)>(engine,"FixtureModelName");model(10,"Models\\Weapons\\v_rifle_ncl2.mdl");model(11,"models/weapons/v_pistol.mdl");
    auto set=sym<void(__cdecl*)(int,int,uint32_t)>(client,"FixtureVmSet");set(0,0,0xaabb0000);
    auto calc=sym<void(__cdecl*)(int)>(client,"FixtureVmCalc"),build=sym<void(__cdecl*)(int)>(client,"FixtureVmBuild"),fault=sym<void(__cdecl*)(int)>(client,"FixtureVmFault");
    auto value=sym<float(__cdecl*)(int,int)>(client,"FixtureVmValue");auto bone=sym<float(__cdecl*)(int,int,int,int)>(client,"FixtureVmBone");
    auto cull=sym<int(__cdecl*)(int,int)>(client,"FixtureVmCull");auto stats=sym<int(__cdecl*)(int)>(client,"FixtureVmStats");
    auto event=sym<void(__cdecl*)(const char*)>(engine,"FixtureEvent");
    if(variant==L"unsupported")sym<void(__cdecl*)()>(client,"FixtureVmUnsupported")();
    auto init=[&](const wchar_t* id,const char* config){auto module=load(plugins/id/L"plugin.dll");L4P_PluginApiV1 api{1,sizeof(api)};require(!sym<L4P_GetPluginApiFn>(module,"L4P_GetPluginApi")(1,&api),"plugin ABI");
        auto directory=(plugins/id).u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,directory.c_str(),config};require(!api.init(&host),"plugin init");return std::make_pair(module,api);};
    mode(1);auto source=init(L"beacon.source","{}");L4P_SourceApiV1 sdk{1,sizeof(sdk)};sym<L4P_GetSourceApiFn>(source.first,"L4P_GetSourceApi")(1,&sdk);
    auto get=sym<L4P_GetViewmodelApiFn>(source.first,"L4P_GetViewmodelApi");require(get(2,&vm)==L4P_UNSUPPORTED_VERSION&&!get(1,&vm),"Viewmodel API negotiation");
    sdk.subscribe("fixture.vm",0,"",nullptr,callback,nullptr,&probe);sdk.subscribe("fixture.vm.other",0,"",nullptr,noop,nullptr,&other);for(int i=0;i<100&&!frames;++i){Sleep(20);paint();}require(frames,"Paint ready");
    auto run=[&](uint32_t op){operation=op;paint();operation=0;return result;};auto status=[&]{L4P_ViewmodelStatusV1 s{sizeof(s)};require(!vm.status(&s),"SDK status");return s;};
    require(vm.snapshot(probe,&snap)==L4P_BAD_ARGUMENT&&vm.set(probe,poses)==L4P_BAD_ARGUMENT,"Paint-only interface");
    require(!run(1)&&snap.slots[0].binding_id&&snap.slots[1].binding_id,"two copied model bindings");
    require(!strcmp(snap.slots[0].model,"models/weapons/v_rifle_ncl2.mdl")&&snap.slots[0].checksum==0xaabb0000,"normalized copied model + checksum");
    for(int i=0;i<2;++i){poses[i].binding_id=snap.slots[i].binding_id;poses[i].scale=1;}poses[0].position[0]=2;poses[0].position[1]=3;poses[0].position[2]=4;
    if(variant==L"unsupported"){require(run(2)==L4P_ENTITY_MISSING&&status().pose_state==2,"signature mismatch visible");calc(0);require(value(0,0)==10&&value(0,6)==1.5f,"unsupported leaves native values");source.second.shutdown();paint();std::cout<<"PASS viewmodel unsupported\n";return 0;}
    require(!run(2),"publish two poses");calc(0);require(close_to(value(0,0),13)&&close_to(value(0,1),18)&&close_to(value(0,2),34),"native-first camera-relative translation");
    require(run(3)==L4P_VIEWMODEL_CONFLICT,"single subscription owner");
    if(variant==L"fault-setter"){fault(1);calc(0);paint();require(status().pose_state==3&&close_to(value(0,6),1.5f),"real setter fault disables and restores scale");source.second.shutdown();paint();std::cout<<"PASS viewmodel native setter fault\n";return 0;}
    poses[0].mirror=poses[1].mirror=1;poses[0].scale=2;
    if(variant==L"fault-mirror")fault(2);require(!run(2),"scale and mirror publication");
    if(variant==L"fault-mirror"){require(status().mirror_state==3,"real metadata fault stopped");source.second.shutdown();paint();std::cout<<"PASS viewmodel native mirror fault\n";return 0;}
    require(status().mirror_state==1&&status().scale_state==1&&cull(0,0)==1&&cull(1,0)==1,"native culling ownership");
    if(variant==L"fault-camera")fault(3);if(variant==L"fault-bones")set(0,4,129);build(0);
    if(variant==L"fault-camera"){require(status().mirror_state==3&&cull(0,0)==0,"real renderer fault restores culling in same render call");source.second.shutdown();paint();std::cout<<"PASS viewmodel native camera fault\n";return 0;}
    if(variant==L"fault-bones"){require(status().mirror_state==3&&status().scale_state==3&&cull(0,0)==0,"invalid bones restore culling in same render call");source.second.shutdown();paint();std::cout<<"PASS viewmodel invalid bone header\n";return 0;}
    require(cull(0,1)==0&&cull(0,0)==1,"native build temporarily sees original culling");
    require(close_to(bone(0,0,0,3),10)&&close_to(bone(0,2,0,3),14)&&close_to(bone(0,0,1,3),-20)&&close_to(bone(0,2,1,3),-24),"centroid scale plus camera-plane reflection");
    require(close_to(bone(0,0,0,0),2)&&close_to(bone(0,0,1,1),-2)&&close_to(bone(0,1,1,3),22),"basis and bone mask preserved");
    diagram(root/L"viewmodel-bones.bmp",bone);
    fault(4);struct NativeBuild{decltype(build) call;};NativeBuild nativeBuild{build};auto callBuild=[](void* p){static_cast<NativeBuild*>(p)->call(0);};
    require(FixtureCatchNative(callBuild,&nativeBuild)==1&&cull(0,0)==1,"native SEH propagates after finally restoring culling");fault(0);
    poses[1].mirror=0;set(1,2,7);require(!run(2)&&status().mirror_state==5&&cull(0,0)==0,"mixed states sharing script pause mirror");build(0);require(close_to(bone(0,0,1,3),20),"scale continues in mirror conflict");
    set(1,2,8);poses[0].rotation[1]=90;poses[0].pivot[0]=1;require(!run(2),"pivot pose");calc(0);require(close_to(value(0,0),12)&&close_to(value(0,1),17)&&close_to(value(0,4),90),"rotation with pivot correction");
    set(0,3,225);paint();require(value(0,6)==1,"updated native scale retained beneath lease");require(!run(4)&&close_to(value(0,6),2.25f)&&cull(0,0)==0,"release restores latest baseline and culling");
    calc(0);require(close_to(value(0,0),10),"released Calc passthrough");
    poses[0].binding_id++;require(run(2)==L4P_ENTITY_STALE&&close_to(value(0,6),2.25f),"stale publication has no write");poses[0].binding_id--;
    require(!run(2),"reacquire");set(0,8,1);require(!run(4)&&status().scale_state==3,"readonly restore queued");set(0,8,0);paint();require(close_to(value(0,6),2.25f),"restore retries after protection returns");
    auto binding=snap.slots[0].binding_id;set(0,0,0xaabb0011);require(!run(1)&&snap.slots[0].binding_id!=binding&&snap.slots[0].checksum==0xaabb0011,"same header changed checksum rebinds");
    require(run(2)==L4P_ENTITY_STALE,"old binding rejected after model replacement");set(0,0,0xaabb0000);run(1);
    for(int i=0;i<2;++i)poses[i].binding_id=snap.slots[i].binding_id;require(!run(2),"new binding acquired");set(0,3,275);event("game_newmap");require(!run(1),"map refresh");
    require(close_to(value(0,6),2.75f)&&run(2)==L4P_ENTITY_STALE,"new map same address keeps new native field");set(0,3,225);
    // Consumer: original profile import, per-model edits and durable shutdown.
    auto profile=root/L"left4dead2/skeeto/viewmodel/profiles.ini";
    const std::string imported="# Skeeto viewmodel profiles v2\n[models/weapons/v_rifle_ncl7.mdl|aabb0000]\nposition=1 2 3\nrotation=0 0 0\npivot=0 0 0\nmirror=0\n";
    auto formatStore=std::make_unique<skviewmodel::Store>();require(skviewmodel::Parse(imported.data(),imported.size(),formatStore.get()),"original v2 parser");
    for(int i=1;i<256;++i){auto name="models/custom/item"+std::to_string(i)+".mdl";require(formatStore->Ensure(name.c_str(),i)==i,"bounded record insert");}
    require(formatStore->Ensure("models/custom/overflow.mdl",999)==-1,"256 profile capacity");std::vector<char> formatted(256*1024+1);
    auto formattedSize=skviewmodel::Format(*formatStore,formatted.data(),formatted.size());require(formattedSize>0,"full profile format");
    auto parsed=std::make_unique<skviewmodel::Store>();require(skviewmodel::Parse(formatted.data(),formattedSize,parsed.get())&&parsed->count==256,"full bounded roundtrip");
    require(!skviewmodel::Parse("bad",3,parsed.get())&&parsed->count==256,"parse failure transactional");
    write(profile,imported);auto feature=init(L"skeeto.viewmodel","{}");paint();std::vector<char> out(256*1024);uint32_t size=0;
    auto invoke=[&](const char* action,json args=json::object()){auto parameters=args.dump();auto code=feature.second.invoke(action,parameters.c_str(),out.data(),uint32_t(out.size()),&size);if(code){std::cerr<<"invoke "<<action<<" "<<parameters<<" code="<<code<<"\n";feature.second.invoke("status","{}",out.data(),uint32_t(out.size()),&size);std::cerr<<out.data()<<"\n";}require(!code,action);return json::parse(out.data());};
    auto configure=[&](json args){invoke("configure",args);paint();};
    auto current=invoke("status");require(current["profileCount"]==1&&current["slots"][0]["pose"]["scale"]==1&&current["slots"][0]["pose"]["position"][0]==1,"legacy profile import + Necola grouping");
    require(read(profile)==imported&&!fs::exists(plugins/L"skeeto.viewmodel/config.json"),"initialization remains read-only");
    require(feature.second.invoke("set-axis","{\"axis\":\"position-x\",\"value\":8}",out.data(),1,&size)==L4P_BUFFER_TOO_SMALL&&read(profile)==imported,"small output causes no save");
    configure({{"active",true}});calc(0);require(close_to(value(0,0),12)&&close_to(value(0,1),19)&&close_to(value(0,2),33),"consumer uses imported profile");
    invoke("set-axis",{{"axis","position-x"},{"value",8}});paint();calc(0);require(close_to(value(0,1),12),"axis edit applied");
    invoke("adjust",{{"axis","position-x"},{"direction","increase"},{"fine",true}});auto edited=invoke("status");require(close_to(edited["slots"][0]["pose"]["position"][0].get<float>(),8.01f),"fine movement step");
    invoke("adjust",{{"axis","scale"},{"direction","decrease"},{"fine",true}});require(close_to(invoke("status")["slots"][0]["pose"]["scale"].get<float>(),.995f),"fine scale step");
    invoke("set-axis",{{"axis","pitch"},{"value",180}});invoke("adjust",{{"axis","pitch"},{"direction","increase"}});require(invoke("status")["slots"][0]["pose"]["rotation"][0]==180,"angular limit clamped");
    auto before=read(profile);require(feature.second.invoke("set-axis","{\"axis\":\"scale\",\"value\":0}",out.data(),out.size(),&size)==L4P_BAD_ARGUMENT&&read(profile)==before,"axis-specific range rejects");
    invoke("reset-current",{{"part","rotation"}});require(invoke("status")["slots"][0]["pose"]["position"][0]>8,"partial reset preserves position");
    invoke("cycle-step",{{"kind","move"}});require(close_to(invoke("status")["settings"]["move-step"].get<float>(),.5f),"original move cycle");
    configure({{"angle-step",15}});invoke("cycle-step",{{"kind","angle"}});require(close_to(invoke("status")["settings"]["angle-step"].get<float>(),.01f),"original angle cycle wraps");
    invoke("model-mirror",{{"mode","on"}});configure({{"per-model-mirror",true}});require(cull(0,0)==1&&cull(1,0)==0,"per-model mirror selects saved profile");
    invoke("global-mirror",{{"mode","on"}});paint();require(cull(0,0)==1&&cull(1,0)==1,"global mode covers both models");
    configure({{"edit-slot",1}});invoke("set-axis",{{"axis","pivot-z"},{"value",5}});require(invoke("profiles")["profileCount"]==2,"second model stored independently");
    invoke("reset-current",{{"part","all"}});auto reset=invoke("status");require(reset["slots"][1]["pose"]["pivot"][2]==0&&reset["slots"][0]["pose"]["mirror"]==true,"whole selected reset preserves other model");
    // Preserve external drafts and offer explicit reload rather than overwriting.
    before=read(profile);write(profile,"external draft");require(feature.second.invoke("set-axis","{\"axis\":\"position-z\",\"value\":3}",out.data(),out.size(),&size)==L4P_ERROR&&read(profile)=="external draft","external edit preserved");
    require(!invoke("status")["profileWritable"].get<bool>(),"external conflict blocks save");
    require(feature.second.invoke("reload-profiles","{}",out.data(),out.size(),&size)==L4P_ERROR&&invoke("status")["profileCount"]==2,"malformed reload preserves live copy");
    write(profile,before);invoke("reload-profiles");require(invoke("status")["profileWritable"]==true,"explicit valid reload resumes editing");
    HANDLE locked=CreateFileW(profile.c_str(),GENERIC_READ,0,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);require(locked!=INVALID_HANDLE_VALUE,"fixture exclusive file");
    require(feature.second.invoke("set-axis","{\"axis\":\"position-z\",\"value\":3}",out.data(),out.size(),&size)==L4P_ERROR,"locked save reported");CloseHandle(locked);require(read(profile)==before,"failed save keeps prior file");
    invoke("set-axis",{{"axis","position-z"},{"value",3}});configure({{"active",false}});require(cull(0,0)==0&&cull(1,0)==0&&close_to(value(0,6),2.25f),"consumer off restores fields");
    configure({{"active",true}});mode(3);paint();require(cull(0,0)==0&&cull(1,0)==0,"loading releases visuals");mode(2);paint();require(cull(0,0)==1,"ANY cosmetics on remote");
    mode(0);paint();require(!invoke("status")["slots"][0]["bindingId"].get<uint32_t>(),"disconnect clears copied bindings");set(0,3,225);set(1,3,150);mode(1);paint();
    feature.second.shutdown();paint();require(cull(0,0)==0&&close_to(value(0,6),2.25f),"independent shutdown restores baseline");
    run(1);for(int i=0;i<2;++i)poses[i].binding_id=snap.slots[i].binding_id;require(!run(2),"reacquire after consumer");
    std::thread worker([&]{calc(0);});worker.join();require(close_to(value(0,0),10),"native foreign thread passthrough");
    set(0,7,1);run(2);build(0);require(cull(0,0)==0&&stats(4)>0,"foreign build entry retained and original chain transparent");
    set(0,6,1);require(run(2)==L4P_VIEWMODEL_CONFLICT,"foreign Calc ownership diagnostic");calc(0);require(close_to(value(0,0),10),"retained Calc thunk transparent");
    vm.release(probe);paint();
    require(stats(0)==0,"native ABI checks");sdk.unsubscribe(probe);sdk.unsubscribe(other);source.second.shutdown();paint();
    std::cout<<"PASS viewmodel SDK/consumer: native pose, pivot, mirror/scale, two slots, ownership, restore, profiles and lifecycle\n";return 0;
}catch(const std::exception& e){std::cerr<<"FAIL "<<e.what()<<"\n";return 1;}}
