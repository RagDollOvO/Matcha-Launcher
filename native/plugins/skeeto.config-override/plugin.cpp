// GPL-3.0. Skeeto CfgOvScan/Load/Extract/Apply/Cycle; see SOURCE.md.
#define NOMINMAX
#include <windows.h>
#include "l4p_source.h"
#include "l4p_cvar.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <atomic>
#include <cstring>
#include <string>
#include <vector>
#include <set>
#include <algorithm>
using nlohmann::json;namespace fs=std::filesystem;
namespace {
L4P_SourceApiV1 source{1,sizeof(source)};L4P_CvarApiV4 cvar{{{4,sizeof(cvar)}}};uint32_t token=0,localToken=0;
std::recursive_mutex mutex;std::atomic<bool> ready{false};std::string selected,lastApplied,lastError;
fs::path configFile,cfgRoot;bool automatic=true,restoreOld=false,manualPending=false,chapterPending=false,wasInGame=false,restorePending=false,forgetPending=false,applying=false;
uint32_t executions=0,lastSequence=0,restoreAt=0,skippedCount=0;std::set<std::string> touched;
json skipped=json::array();
std::string lower(std::string value){for(auto& c:value)if(c>='A'&&c<='Z')c+=32;return value;}
bool filename(const std::string& name){return name.size()>=5&&name.size()<=160&&name.substr(name.size()-4)==".cfg"&&name.front()!='/'&&name.find("..")==std::string::npos&&name.find("//")==std::string::npos&&name.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-/.")==std::string::npos;}
bool available(const std::string& name){if(!filename(name))return false;std::error_code ec;auto root=fs::canonical(cfgRoot,ec);if(ec)return false;
    auto file=fs::canonical(cfgRoot/fs::u8path(name),ec);if(ec||!fs::is_regular_file(file,ec)||ec)return false;auto rel=file.lexically_relative(root);if(rel.empty()||rel.is_absolute())return false;
    for(const auto& part:rel)if(part==L"..")return false;return true;}
bool preset_file(const std::string& leaf){auto name=lower(leaf);if(name.size()<=11||name.size()>=52||name.compare(0,7,"skeeto_")||name.substr(name.size()-4)!=".cfg")return false;
    return name.substr(0,name.size()-4).find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789_-")==std::string::npos;}
std::vector<std::string> scan(){std::vector<std::string> ids;std::error_code ec;fs::directory_iterator it(cfgRoot,ec),end;if(ec)return ids;
    for(;it!=end&&ids.size()<16;it.increment(ec)){if(ec)break;auto name=it->path().filename().u8string();if(!preset_file(name))continue;
        auto id=name.substr(0,name.size()-4);if(!available(id+".cfg")||std::any_of(ids.begin(),ids.end(),[&](const auto& v){return lower(v)==lower(id);}))continue;ids.push_back(id);}
    std::sort(ids.begin(),ids.end(),[](const auto& a,const auto& b){return lower(a)<lower(b);});return ids;}
struct Contents{std::string text;bool read=false,truncated=false;};
Contents read_prefix(const std::string& file){Contents out;if(!available(file))return out;std::ifstream stream(cfgRoot/fs::u8path(file),std::ios::binary);if(!stream)return out;
    out.text.resize(65536);stream.read(out.text.data(),out.text.size());auto n=stream.gcount();if(stream.bad())return {};out.text.resize(size_t(n));out.read=true;out.truncated=n==65536&&stream.peek()!=std::char_traits<char>::eof();
    if(out.text.compare(0,3,"\xef\xbb\xbf")==0)out.text.erase(0,3);return out;}
struct Line{unsigned number;std::string text;};
std::vector<Line> lines(const std::string& text){std::vector<Line> out;size_t cursor=0;unsigned number=0;while(cursor<text.size()){
    auto start=cursor;while(cursor<text.size()&&text[cursor]!='\r'&&text[cursor]!='\n')++cursor;auto line=text.substr(start,cursor-start);++number;
    if(cursor<text.size()&&text[cursor]=='\r')++cursor;if(cursor<text.size()&&text[cursor]=='\n')++cursor;if(!line.empty())out.push_back({number,std::move(line)});}return out;}
std::string cvar_name(std::string line){if(line.empty()||line.size()>=240)return {};auto first=line.find_first_not_of(" \t");if(first==std::string::npos||line[first]=='#'||line.compare(first,2,"//")==0)return {};
    auto end=line.find_first_of(" \t",first);if(end==std::string::npos)return {};auto command=lower(line.substr(first,end-first));
    if(command=="skt_cvar"||command=="skeeto_cvar"){first=line.find_first_not_of(" \t",end);if(first==std::string::npos)return {};end=line.find_first_of(" \t",first);command=lower(line.substr(first,end-first));}
    if(command.empty()||command.size()>=64||command.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789_")!=std::string::npos)return {};return command;}
bool save(const std::string& file,bool automaticValue,bool restoreValue){auto stage=configFile;stage+=L".pending";{std::ofstream out(stage,std::ios::binary|std::ios::trunc);out<<json{{"file",file},{"automatic",automaticValue},{"restore",restoreValue}}.dump(2);out.flush();if(!out)return false;}
    return MoveFileExW(stage.c_str(),configFile.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)!=0;}
void forget(){cvar.forget_checkpoints(token);cvar.forget_checkpoints(localToken);touched.clear();skipped=json::array();skippedCount=0;restorePending=false;forgetPending=false;}
bool restore(){auto a=cvar.restore_checkpoints(token),b=cvar.restore_checkpoints(localToken);restorePending=a||b;if(!restorePending){touched.clear();restoreAt=0;}return !restorePending;}
void capture(const Contents& content){skipped=json::array();skippedCount=0;if(!content.read){lastError="CFG 已提交；读取基线清单失败";return;}
    for(const auto& line:lines(content.text)){if(touched.size()>=96)break;auto name=cvar_name(line.text);if(name.empty()||touched.count(name))continue;
        float baseline=0;if(cvar.base.base.read(name.c_str(),&baseline))continue;auto code=cvar.checkpoint(token,name.c_str());if(code==L4P_CVAR_SCOPE)code=cvar.checkpoint(localToken,name.c_str());
        if(!code)touched.insert(name);else{++skippedCount;if(skipped.size()<16)skipped.push_back({{"name",name},{"code",code}});}}
    if(skippedCount)lastError="CFG 已提交；部分参数基线因环境或其他模块占用而跳过";
}
void L4P_CALL noop(void*,const L4P_SourceFrameV1*){}
void L4P_CALL onEvent(void*,const L4P_SourceFrameV1*,const char* name,void*){if(!ready)return;std::lock_guard<std::recursive_mutex> lock(mutex);
    if(automatic&&(!strcmp(name,"game_newmap")||!strcmp(name,"server_spawn")))chapterPending=true;}
void L4P_CALL onFrame(void*,const L4P_SourceFrameV1* f){if(!ready)return;std::lock_guard<std::recursive_mutex> lock(mutex);if(applying)return;
    const bool active=source.allowed(f,L4P_SOURCE_ANY)!=0;
    if(!f->connected){manualPending=chapterPending=false;lastApplied.clear();}
    if(!active&&wasInGame&&restoreOld)restorePending=true;
    if(active&&!wasInGame&&automatic)chapterPending=true;wasInGame=active;
    if(forgetPending)forget();
    if(restorePending){if(restoreAt&&int32_t(f->time_ms-restoreAt)<0)return;restoreAt=f->time_ms+250;if(!restore()){lastError="等待恢复旧参数；本次 CFG 保持排队";return;}lastError.clear();}
    if(!active||(!manualPending&&!chapterPending)||f->local_user<=0||f->sequence==lastSequence)return;
    // Preserve legacy arbitrary-file native exec. New preview/tracking limits do
    // not truncate or reject the file sent to the engine.
    if(!available(selected)){manualPending=chapterPending=false;lastError="所选 CFG 已缺失或路径无效";return;}
    if(chapterPending&&restoreOld&&!restore()){restoreAt=f->time_ms+250;lastError="等待恢复旧参数；本次 CFG 保持排队";return;}
    lastError.clear();if(restoreOld)capture(read_prefix(selected));
    const auto file=selected;manualPending=chapterPending=false;lastSequence=f->sequence;applying=true;
    auto code=source.exec_cfg(file.c_str());applying=false;
    if(!code){lastApplied=file;++executions;}else lastError="游戏命令接口尚未就绪";
}
void L4P_CALL shutdown(){ready=false;bool shouldRestore=false;{std::lock_guard<std::recursive_mutex> lock(mutex);shouldRestore=restoreOld;}
    // Clear opt-out checkpoints before unsubscribe can queue restoration.
    if(token){if(shouldRestore)cvar.restore_checkpoints(token);else cvar.forget_checkpoints(token);source.unsubscribe(token);}
    if(localToken){if(shouldRestore)cvar.restore_checkpoints(localToken);else cvar.forget_checkpoints(localToken);source.unsubscribe(localToken);}
    std::lock_guard<std::recursive_mutex> lock(mutex);token=localToken=0;manualPending=chapterPending=wasInGame=restorePending=forgetPending=false;touched.clear();}
uint32_t L4P_CALL init(const L4P_HostApiV1* host){if(!host||host->api_version!=1||host->struct_size!=sizeof(*host)||!host->plugin_directory||!host->config_json||ready)return L4P_BAD_ARGUMENT;
    try{auto config=json::parse(host->config_json);if(!config.is_object())return L4P_BAD_ARGUMENT;for(const auto& p:config.items())if(p.key()!="file"&&p.key()!="automatic"&&p.key()!="restore")return L4P_BAD_ARGUMENT;
        selected=config.value("file",std::string("autoexec.cfg"));automatic=config.value("automatic",true);restoreOld=config.value("restore",false);if(!filename(selected))return L4P_BAD_ARGUMENT;
        auto dir=fs::u8path(host->plugin_directory);configFile=dir/L"config.json";cfgRoot=dir.parent_path().parent_path().parent_path().parent_path()/L"left4dead2/cfg";
        auto module=GetModuleHandleW((dir.parent_path()/L"beacon.source/plugin.dll").c_str());if(!module)return L4P_ERROR;
        auto get=reinterpret_cast<L4P_GetSourceApiFn>(GetProcAddress(module,"L4P_GetSourceApi"));auto getCvar=reinterpret_cast<L4P_GetCvarApiFn>(GetProcAddress(module,"L4P_GetCvarApi"));
        if(!get||!getCvar||get(1,&source)||getCvar(4,reinterpret_cast<L4P_CvarApiV1*>(&cvar)))return L4P_ERROR;
        executions=lastSequence=restoreAt=skippedCount=0;lastApplied.clear();lastError.clear();touched.clear();skipped=json::array();manualPending=chapterPending=wasInGame=restorePending=forgetPending=applying=false;
        if(source.subscribe("skeeto.config-override.local",L4P_SOURCE_LOCAL,"",nullptr,noop,nullptr,&localToken))return L4P_ERROR;
        if(source.subscribe("skeeto.config-override",L4P_SOURCE_ANY,"game_newmap,server_spawn",nullptr,onFrame,onEvent,&token)){source.unsubscribe(localToken);localToken=0;return L4P_ERROR;}
        ready=true;return L4P_OK;
    }catch(...){shutdown();return L4P_BAD_ARGUMENT;}}
json report(const std::string& file,bool autoValue,bool restoreValue,bool queued){
    json items=json::array({{{"label","当前 CFG"},{"value",file}},{{"label","章节自动执行"},{"value",autoValue?"开启":"关闭"}},{{"label","过关恢复旧参数"},{"value",restoreValue?"开启":"关闭"}},{{"label","排队执行"},{"value",queued?"等待游戏帧":"空闲"}},{{"label","已提交次数"},{"value",executions}},{{"label","已保存基线"},{"value",touched.size()}},{{"label","状态"},{"value",lastError.empty()?"就绪":lastError}}});
    return {{"file",file},{"automatic",autoValue},{"restore",restoreValue},{"pending",queued},{"lastApplied",lastApplied},{"submissions",executions},{"error",lastError},{"scope","engine-exec-cfg"},{"tracked",touched.size()},{"skipped",skipped},{"skippedCount",skippedCount},{"restorationPending",restorePending},
        {"format","flare.report.v1"},{"title","过关自动执行 CFG"},{"summary","原生执行完整 CFG；同章切换保持叠加，按需在章节边缘恢复旧参数。"},{"sections",json::array({{{"title","执行状态"},{"layout","list"},{"items",items}}})}};
}
uint32_t L4P_CALL invoke(const char* action,const char* params,char* output,uint32_t capacity,uint32_t* size){if(!ready||!action||!params||!output||!size)return L4P_BAD_ARGUMENT;
    try{auto args=json::parse(params);if(!args.is_object())return L4P_BAD_ARGUMENT;std::lock_guard<std::recursive_mutex> lock(mutex);
        const std::string verb=action;bool configure=verb=="configure",apply=verb=="apply",cycle=verb=="next-preset"||verb=="previous-preset",choose=verb=="select-preset",presets=verb=="presets",preview=verb=="preview";
        if(!configure&&!apply&&!cycle&&!choose&&!presets&&!preview&&verb!="status")return L4P_BAD_ARGUMENT;
        if(!configure&&!choose&&!args.empty())return L4P_BAD_ARGUMENT;
        std::string next=selected;bool nextAuto=automatic,nextRestore=restoreOld;std::vector<std::string> ids;
        if(configure){for(const auto& p:args.items())if(p.key()!="file"&&p.key()!="automatic"&&p.key()!="restore")return L4P_BAD_ARGUMENT;
            // Old configure calls still supply file/automatic only.
            next=args.at("file").get<std::string>();nextAuto=args.at("automatic").get<bool>();nextRestore=args.value("restore",restoreOld);if(!available(next))return L4P_BAD_ARGUMENT;}
        if(presets||cycle||choose)ids=scan();
        if(cycle||choose){if(ids.empty())return L4P_BAD_ARGUMENT;int index=-1;
            if(choose){if(args.size()!=1||!args.contains("id")||!args["id"].is_string())return L4P_BAD_ARGUMENT;auto id=args["id"].get<std::string>();if(id.size()>4&&lower(id.substr(id.size()-4))==".cfg")id.resize(id.size()-4);
                for(size_t i=0;i<ids.size();++i)if(lower(ids[i])==lower(id))index=int(i);if(index<0)return L4P_BAD_ARGUMENT;
            }else{for(size_t i=0;i<ids.size();++i)if(lower(selected)==lower(ids[i]+".cfg"))index=int(i);
                index=index<0?0:(index+(verb=="next-preset"?1:int(ids.size())-1))%int(ids.size());}
            next=ids[size_t(index)]+".cfg";nextAuto=true;
        }
        if((apply||cycle||choose)&&!available(next))return L4P_BAD_ARGUMENT;
        auto result=report(next,nextAuto,nextRestore,apply||cycle||choose||manualPending||(chapterPending&&nextAuto));
        if(presets){result["presets"]=ids;json rows=json::array();for(const auto& id:ids)rows.push_back({{"label",id},{"value",lower(selected)==lower(id+".cfg")?"当前选择":"可选择"}});
            result["sections"].push_back({{"title","松散 CFG 预设"},{"layout","list"},{"note","扫描 cfg/skeeto_*.cfg，最多 16 套；切换动作会启用章节自动执行并立即排队。"},{"items",rows}});}
        if(preview){auto content=read_prefix(selected);if(!content.read)return L4P_BAD_ARGUMENT;auto all=lines(content.text);json rows=json::array();json raw=json::array();bool cut=content.truncated||all.size()>64;
            for(size_t i=0;i<all.size()&&i<64;++i){auto value=all[i].text;if(value.size()>239){value.resize(239);cut=true;}raw.push_back(value);rows.push_back({{"label","第 "+std::to_string(all[i].number)+" 行"},{"value",value}});}
            result["preview"]=raw;result["previewTruncated"]=cut;result["sections"].push_back({{"title","当前文件预览"},{"layout","list"},{"note",cut?"预览达到显示上限；执行时仍由游戏读取完整文件。":"原样显示非空行；CFG 内容交给游戏解释器。"},{"items",rows}});}
        auto body=result.dump(-1,' ',false,json::error_handler_t::replace);*size=uint32_t(body.size()+1);if(capacity<*size)return L4P_BUFFER_TOO_SMALL;
        if(configure||cycle||choose){if(!save(next,nextAuto,nextRestore))return L4P_ERROR;
            if(restoreOld&&!nextRestore){forgetPending=true;restorePending=false;}
            if(automatic&&!nextAuto){chapterPending=false;if(nextRestore)restorePending=true;}
            selected=next;automatic=nextAuto;restoreOld=nextRestore;}
        if(apply||cycle||choose)manualPending=true;memcpy(output,body.c_str(),*size);return L4P_OK;
    }catch(...){return L4P_BAD_ARGUMENT;}}
}
extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetPluginApi(uint32_t version,L4P_PluginApiV1* out){
    if(version!=1)return L4P_UNSUPPORTED_VERSION;if(!out||out->api_version!=1||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={1,sizeof(*out),"skeeto.config-override","0.2.0",init,invoke,shutdown};return L4P_OK;
}
