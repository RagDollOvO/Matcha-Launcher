// GPL-3.0. Skeeto 2.2.19 viewmodel profiles, independent Flare consumer.
#define NOMINMAX
#include <windows.h>
#include "l4p_source.h"
#include "l4p_viewmodel.h"
#include "feature_config.hpp"
#include "viewmodel_profile.hpp"
#include "definition.hpp"
#include <mutex>
#include <atomic>
#include <memory>
#include <vector>
using nlohmann::json;namespace fs=std::filesystem;
namespace {
constexpr char kId[]="skeeto.viewmodel";
L4P_SourceApiV1 source{1,sizeof(source)};L4P_ViewmodelApiV1 viewmodel{1,sizeof(viewmodel)};uint32_t token=0;
// Control actions serialize IO. Paint only takes the short publication lock.
std::mutex controlMutex,stateMutex;std::atomic<bool> ready{false};
fs::path configFile,profileFile;json fields,settings;
std::shared_ptr<const skviewmodel::Store> profiles=std::make_shared<skviewmodel::Store>();
L4P_ViewmodelSnapshotV1 snapshot{sizeof(snapshot)};
L4P_ViewmodelStatusV1 nativeStatus{sizeof(nativeStatus)};
std::string state="等待游戏帧",profileState;uint32_t stateCode=0;
bool profileWritable=false,diskPresent=false;std::string diskText;DWORD fileError=0;uint64_t saveSequence=0;std::string fileOperation;

struct Disk {bool valid=false,present=false;std::string text;};
Disk read_disk(){
    fileOperation="读取模型配置";fileError=0;Disk result;HANDLE file=CreateFileW(profileFile.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);
    if(file==INVALID_HANDLE_VALUE){auto error=GetLastError();fileError=error;result.valid=error==ERROR_FILE_NOT_FOUND||error==ERROR_PATH_NOT_FOUND;return result;}
    result.present=true;LARGE_INTEGER size{};
    if(GetFileSizeEx(file,&size)&&size.QuadPart>=0&&size.QuadPart<=256*1024){result.text.resize(size_t(size.QuadPart));DWORD count=0;
        result.valid=ReadFile(file,result.text.data(),DWORD(result.text.size()),&count,nullptr)&&count==result.text.size();}
    if(!result.valid)fileError=GetLastError();CloseHandle(file);return result;
}
bool load_profiles(std::shared_ptr<skviewmodel::Store>& output,Disk& disk){
    disk=read_disk();output=std::make_shared<skviewmodel::Store>();
    return disk.valid&&(!disk.present||skviewmodel::Parse(disk.text.data(),disk.text.size(),output.get()));
}
enum class SaveResult {ok,changed,error};
SaveResult save_profiles(const skviewmodel::Store& next,std::string& text){
    std::vector<char> buffer(256*1024+1);auto length=skviewmodel::Format(next,buffer.data(),buffer.size());if(!length)return SaveResult::error;
    text.assign(buffer.data(),length);auto current=read_disk();
    if(!current.valid)return SaveResult::error;if(current.present!=diskPresent||current.text!=diskText)return SaveResult::changed;
    std::error_code ec;fs::create_directories(profileFile.parent_path(),ec);if(ec){fileError=DWORD(ec.value());return SaveResult::error;}
    // CREATE_NEW staging never overwrites an existing draft/pending file.
    auto temp=profileFile;temp+=L".pending-"+std::to_wstring(GetCurrentProcessId())+L"-"+std::to_wstring(GetTickCount64())+L"-"+std::to_wstring(++saveSequence);
    fileOperation="创建暂存文件";HANDLE file=CreateFileW(temp.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);if(file==INVALID_HANDLE_VALUE){fileError=GetLastError();return SaveResult::error;}
    fileOperation="写入暂存文件";DWORD written=0;bool ok=WriteFile(file,text.data(),DWORD(text.size()),&written,nullptr)&&written==text.size()&&FlushFileBuffers(file);if(!ok)fileError=GetLastError();CloseHandle(file);
    if(ok){current=read_disk();if(!current.valid||current.present!=diskPresent||current.text!=diskText){DeleteFileW(temp.c_str());return current.valid?SaveResult::changed:SaveResult::error;}
        fileOperation="替换模型配置";ok=MoveFileExW(temp.c_str(),profileFile.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)!=0;if(!ok)fileError=GetLastError();}
    if(!ok)DeleteFileW(temp.c_str());return ok?SaveResult::ok:SaveResult::error;
}
void publish_state(std::string message,uint32_t code,const L4P_ViewmodelSnapshotV1& bindings,const L4P_ViewmodelStatusV1& status){
    std::lock_guard<std::mutex> lock(stateMutex);state=std::move(message);stateCode=code;snapshot=bindings;nativeStatus=status;
}
void L4P_CALL frame(void*,const L4P_SourceFrameV1* f){if(!ready)return;
    json config;std::shared_ptr<const skviewmodel::Store> store;
    {std::lock_guard<std::mutex> lock(stateMutex);config=settings;store=profiles;}
    L4P_ViewmodelSnapshotV1 bindings{sizeof(bindings)};L4P_ViewmodelStatusV1 status{sizeof(status)};
    if(!source.allowed(f,L4P_SOURCE_ANY)){viewmodel.release(token);viewmodel.status(&status);publish_state("等待进入对局",0,bindings,status);return;}
    auto code=viewmodel.snapshot(token,&bindings);
    if(code){viewmodel.release(token);viewmodel.status(&status);publish_state("等待持枪模型接口",code,bindings,status);return;}
    if(!config["active"].get<bool>()){viewmodel.release(token);viewmodel.status(&status);publish_state("已关闭；模型配置保留",0,bindings,status);return;}
    L4P_ViewmodelPoseV1 poses[2]{};bool bound=false;
    for(int i=0;i<2;++i){const auto& b=bindings.slots[i];auto& out=poses[i];out.binding_id=b.binding_id;out.scale=1;if(!b.binding_id)continue;bound=true;
        int index=store->Find(b.model,b.checksum);skviewmodel::Pose p{};if(index>=0)p=store->records[index].pose;
        out.position[0]=p.position.x;out.position[1]=p.position.y;out.position[2]=p.position.z;
        out.rotation[0]=p.rotation.x;out.rotation[1]=p.rotation.y;out.rotation[2]=p.rotation.z;
        out.pivot[0]=p.pivot.x;out.pivot[1]=p.pivot.y;out.pivot[2]=p.pivot.z;out.scale=p.scale;
        out.mirror=config["per-model-mirror"].get<bool>()?p.mirror:config["global-mirror"].get<bool>();
    }
    if(bound)code=viewmodel.set(token,poses);else viewmodel.release(token);viewmodel.status(&status);
    std::string message=!bound?"拿起需要调整的武器或物品":code?"持枪视角接口暂不可用":"按模型应用已保存配置";
    if(status.pose_state==2)message="位置 / 旋转接口待适配";
    if(status.pose_state==3)message="原生姿态接口故障，已停止本次运行的调整";
    if(status.pose_state==5)message="姿态入口由其他模块占用";
    if(status.mirror_state==2)message+="；镜像接口待适配";
    if(status.mirror_state==3)message+="；镜像接口故障";
    if(status.mirror_state==5)message+="；共用武器脚本的镜像设置冲突，镜像暂停";
    if(status.scale_state==2)message+="；缩放接口待适配";
    if(status.scale_state==5)message+="；骨骼入口由其他模块占用";
    publish_state(message,code,bindings,status);
}
json vector_json(const skviewmodel::Vec& v){return json::array({v.x,v.y,v.z});}
json pose_json(const skviewmodel::Pose& p){return {{"position",vector_json(p.position)},{"rotation",vector_json(p.rotation)},{"pivot",vector_json(p.pivot)},{"scale",p.scale},{"mirror",p.mirror}};}
std::string checksum(uint32_t value){char text[9];snprintf(text,sizeof(text),"%08x",value);return text;}
json report(const json& config,const skviewmodel::Store& store,const std::string& message,bool all){
    L4P_ViewmodelSnapshotV1 bindings;L4P_ViewmodelStatusV1 status;std::string runtime,profile;uint32_t code;
    {std::lock_guard<std::mutex> lock(stateMutex);bindings=snapshot;status=nativeStatus;runtime=state;code=stateCode;profile=profileState;}
    json slots=json::array(),items=json::array();
    for(int i=0;i<2;++i){const auto& b=bindings.slots[i];skviewmodel::Pose p{};int index=b.binding_id?store.Find(b.model,b.checksum):-1;if(index>=0)p=store.records[index].pose;
        slots.push_back({{"slot",i},{"bindingId",b.binding_id},{"model",b.model},{"checksum",checksum(b.checksum)},{"saved",index>=0},{"pose",pose_json(p)}});
        items.push_back({{"label",i?"模型槽 1":"模型槽 0"},{"value",b.binding_id?std::string(b.model)+" · "+checksum(b.checksum):"等待持枪模型"}});
    }
    int selected=config["edit-slot"].get<int>();auto selectedPose=slots[selected]["pose"];
    items.push_back({{"label","正在编辑"},{"value",selected}});items.push_back({{"label","位置 X / Y / Z"},{"value",selectedPose["position"].dump()}});
    items.push_back({{"label","旋转 Pitch / Yaw / Roll"},{"value",selectedPose["rotation"].dump()}});items.push_back({{"label","旋转原点 X / Y / Z"},{"value",selectedPose["pivot"].dump()}});
    items.push_back({{"label","比例"},{"value",selectedPose["scale"]}});items.push_back({{"label","此模型镜像"},{"value",selectedPose["mirror"].get<bool>()?"开启":"关闭"}});
    json sections=json::array({{{"title","运行状态"},{"layout","list"},{"items",json::array({{{"label","状态"},{"value",runtime},{"code",code}},{{"label","模型配置"},{"value",profile}},{{"label","保存数量"},{"value",store.count}}})}},{{"title","模型与调整"},{"layout","list"},{"items",items}}});
    if(all){json rows=json::array();for(int i=0;i<store.count;++i){const auto& r=store.records[i];rows.push_back({{"label",std::string(r.model)+" · "+checksum(r.checksum)},{"value",pose_json(r.pose).dump()}});}
        sections.push_back({{"title","全部模型配置"},{"layout","list"},{"items",rows}});}
    return {{"format","flare.report.v1"},{"title","持枪视角与镜像"},{"summary",message},{"settings",config},{"slots",slots},{"profileCount",store.count},{"profileWritable",profileWritable},
        {"native",{{"pose",status.pose_state},{"mirror",status.mirror_state},{"scale",status.scale_state},{"calls",status.calls},{"applied",status.applied},{"builds",status.builds},{"matrices",status.matrices},{"conflicts",status.conflicts},{"failures",status.failures}}},{"sections",sections}};
}
float* axis(skviewmodel::Pose& p,const std::string& name){
    if(name=="position-x")return &p.position.x;if(name=="position-y")return &p.position.y;if(name=="position-z")return &p.position.z;
    if(name=="pitch")return &p.rotation.x;if(name=="yaw")return &p.rotation.y;if(name=="roll")return &p.rotation.z;
    if(name=="pivot-x")return &p.pivot.x;if(name=="pivot-y")return &p.pivot.y;if(name=="pivot-z")return &p.pivot.z;
    if(name=="scale")return &p.scale;return nullptr;
}
bool keys(const json& args,std::initializer_list<const char*> allowed){for(const auto& p:args.items()){bool found=false;for(auto key:allowed)if(p.key()==key)found=true;if(!found)return false;}return true;}
bool angle_axis(const std::string& name){return name=="pitch"||name=="yaw"||name=="roll";}
bool switch_value(const json& args,bool before,bool& after){auto mode=args.at("mode").get<std::string>();if(mode!="on"&&mode!="off"&&mode!="toggle")return false;after=mode=="toggle"?!before:mode=="on";return true;}
uint32_t L4P_CALL invoke(const char* action,const char* parameters,char* out,uint32_t capacity,uint32_t* size){
    if(!action||!parameters||!out||!size)return L4P_BAD_ARGUMENT;std::lock_guard<std::mutex> control(controlMutex);if(!ready)return L4P_BAD_ARGUMENT;
    try{auto args=json::parse(parameters);if(!args.is_object())return L4P_BAD_ARGUMENT;std::string verb=action;json config;std::shared_ptr<const skviewmodel::Store> old;
        L4P_ViewmodelSlotV1 selected{};{std::lock_guard<std::mutex> lock(stateMutex);config=settings;old=profiles;selected=snapshot.slots[config["edit-slot"].get<int>()];}
        auto next=std::make_shared<skviewmodel::Store>(*old);bool configEdit=false,profileEdit=false,reload=false;Disk loaded;std::string summary="按模型保存位置、旋转、旋转原点、比例与镜像。";
        if(verb=="status"||verb=="profiles"){if(!args.empty())return L4P_BAD_ARGUMENT;}
        else if(verb=="configure"){for(const auto& p:args.items())config[p.key()]=p.value();json checked;if(!flare_feature::validate(fields,config,checked))return L4P_BAD_ARGUMENT;config=checked;configEdit=true;}
        else if(verb=="global-mirror"){if(!keys(args,{"mode"}))return L4P_BAD_ARGUMENT;bool value;if(!switch_value(args,!config["per-model-mirror"].get<bool>()&&config["global-mirror"].get<bool>(),value))return L4P_BAD_ARGUMENT;
            config["global-mirror"]=value;config["per-model-mirror"]=false;if(value)config["active"]=true;configEdit=true;}
        else if(verb=="cycle-step"){if(!keys(args,{"kind"}))return L4P_BAD_ARGUMENT;auto kind=args.at("kind").get<std::string>();if(kind!="move"&&kind!="angle")return L4P_BAD_ARGUMENT;
            const double moves[]={.001,.002,.01,.02,.1,.5,1,5},angles[]={.01,.04,.1,.4,1,5,15};bool angle=kind=="angle";
            const auto* values=angle?angles:moves;int count=angle?7:8,index=0;auto key=angle?"angle-step":"move-step";float value=config[key].get<float>();
            while(index<count&&values[index]<=value+.000001f)++index;config[key]=values[index==count?0:index];configEdit=true;}
        else if(verb=="reload-profiles"){if(!args.empty())return L4P_BAD_ARGUMENT;if(!load_profiles(next,loaded)){std::lock_guard<std::mutex> lock(stateMutex);profileWritable=false;profileState="配置读取失败；原文件和当前副本保留，修正后重新读取";return L4P_ERROR;}reload=true;summary="模型配置已重新读取";}
        else if(verb=="set-axis"||verb=="adjust"||verb=="reset-current"||verb=="model-mirror"){
            if(!profileWritable||!selected.binding_id)return L4P_ERROR;
            char normalized[260];if(!skviewmodel::NormalizeModel(selected.model,normalized))return L4P_ERROR;
            int index=next->Ensure(normalized,selected.checksum);if(index<0){std::lock_guard<std::mutex> lock(stateMutex);profileState="已达到 256 个模型配置上限";return L4P_ERROR;}auto& p=next->records[index].pose;
            if(verb=="model-mirror"){if(!keys(args,{"mode"})||!switch_value(args,p.mirror,p.mirror))return L4P_BAD_ARGUMENT;}
            else if(verb=="reset-current"){if(!keys(args,{"part"}))return L4P_BAD_ARGUMENT;auto part=args.at("part").get<std::string>();
                if(part=="position")p.position={};else if(part=="rotation")p.rotation={};else if(part=="all")p={};else return L4P_BAD_ARGUMENT;}
            else {if(!keys(args,verb=="set-axis"?std::initializer_list<const char*>{"axis","value"}:std::initializer_list<const char*>{"axis","direction","fine"}))return L4P_BAD_ARGUMENT;
                auto name=args.at("axis").get<std::string>();float* value=axis(p,name);if(!value)return L4P_BAD_ARGUMENT;double low=name=="scale"?.1:angle_axis(name)?-180:-100,high=name=="scale"?5:-low;
                if(verb=="set-axis"){if(!args.at("value").is_number())return L4P_BAD_ARGUMENT;double n=args["value"].get<double>();if(!std::isfinite(n)||n<low||n>high)return L4P_BAD_ARGUMENT;*value=float(n);}
                else {auto direction=args.at("direction").get<std::string>();if(direction!="increase"&&direction!="decrease")return L4P_BAD_ARGUMENT;bool fine=args.value("fine",false);
                    double step=name=="scale"?.05:config[angle_axis(name)?"angle-step":"move-step"].get<double>();step*=fine?.1:1;
                    *value=float(std::clamp(double(*value)+(direction=="increase"?step:-step),low,high));}}
            p.Rebuild();profileEdit=true;summary=std::string("已保存模型 ")+next->records[index].model+" · "+checksum(selected.checksum)+"；下一游戏帧应用";
        }else return L4P_BAD_ARGUMENT;
        if(configEdit)summary="设置已保存，下一游戏帧应用";
        auto body=report(config,*next,summary,verb=="profiles");
        if(profileEdit){body["editedModel"]={{"model",selected.model},{"checksum",checksum(selected.checksum)}};body["sections"][0]["items"][1]["value"]="模型配置已保存";}
        if(reload){body["profileWritable"]=true;body["sections"][0]["items"][1]["value"]="模型配置已重新读取";}
        auto text=body.dump();*size=uint32_t(text.size()+1);if(capacity<*size)return L4P_BUFFER_TOO_SMALL;
        if(configEdit){if(!flare_feature::save(configFile,config))return L4P_ERROR;std::lock_guard<std::mutex> lock(stateMutex);settings=config;}
        if(profileEdit){std::string persisted;auto result=save_profiles(*next,persisted);if(result!=SaveResult::ok){std::lock_guard<std::mutex> lock(stateMutex);
                profileState=result==SaveResult::changed?"模型文件已被外部修改，请重新读取后编辑":"保存失败；旧文件和当前配置保留，请排除文件占用后重试";
                if(result==SaveResult::changed)profileWritable=false;else profileState+="（"+fileOperation+"，Windows 错误 "+std::to_string(fileError)+"）";return L4P_ERROR;}
            diskPresent=true;diskText=std::move(persisted);std::lock_guard<std::mutex> lock(stateMutex);profiles=next;profileState="模型配置已保存";}
        if(reload){diskPresent=loaded.present;diskText=std::move(loaded.text);std::lock_guard<std::mutex> lock(stateMutex);profiles=next;profileWritable=true;profileState="模型配置已重新读取";}
        memcpy(out,text.c_str(),*size);return L4P_OK;
    }catch(...){return L4P_BAD_ARGUMENT;}
}
void L4P_CALL shutdown(){std::lock_guard<std::mutex> control(controlMutex);ready=false;if(token){viewmodel.release(token);source.unsubscribe(token);token=0;}}
uint32_t L4P_CALL init(const L4P_HostApiV1* host){std::lock_guard<std::mutex> control(controlMutex);
    if(!host||host->api_version!=1||host->struct_size!=sizeof(*host)||!host->plugin_directory||!host->config_json||ready)return L4P_BAD_ARGUMENT;
    try{fields=json::parse(kFields);json config;if(!flare_feature::validate(fields,json::parse(host->config_json),config))return L4P_BAD_ARGUMENT;
        auto directory=fs::u8path(host->plugin_directory);configFile=directory/L"config.json";profileFile=directory.parent_path().parent_path().parent_path().parent_path()/L"left4dead2/skeeto/viewmodel/profiles.ini";
        auto module=GetModuleHandleW((directory.parent_path()/L"beacon.source/plugin.dll").c_str());if(!module)return L4P_ERROR;
        auto getSource=reinterpret_cast<L4P_GetSourceApiFn>(GetProcAddress(module,"L4P_GetSourceApi"));auto getVm=reinterpret_cast<L4P_GetViewmodelApiFn>(GetProcAddress(module,"L4P_GetViewmodelApi"));
        if(!getSource||!getVm||getSource(1,&source)||getVm(1,&viewmodel))return L4P_ERROR;
        std::shared_ptr<skviewmodel::Store> loaded;Disk disk;profileWritable=load_profiles(loaded,disk);diskPresent=disk.present;diskText=std::move(disk.text);
        {std::lock_guard<std::mutex> lock(stateMutex);settings=config;profiles=profileWritable?loaded:std::make_shared<skviewmodel::Store>();snapshot={sizeof(snapshot)};nativeStatus={sizeof(nativeStatus)};state="等待游戏帧";stateCode=0;
            profileState=profileWritable?(diskPresent?"模型配置已读取":"首次编辑时创建模型配置"):"配置读取失败；原文件保留，修正后重新读取";}
        if(source.subscribe(kId,L4P_SOURCE_ANY,"",nullptr,frame,nullptr,&token))return L4P_ERROR;ready=true;return L4P_OK;
    }catch(...){return L4P_BAD_ARGUMENT;}
}
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetPluginApi(uint32_t version,L4P_PluginApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),kId,"0.1.0",init,invoke,shutdown};return L4P_OK;
}
