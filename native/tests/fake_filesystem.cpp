// Owned VFileSystem018 dual-vtable fixture for drawing and mounted assets.
#include <windows.h>
#include <cstring>
#include <string>
#include <vector>
#include <map>
#include <algorithm>
#include <filesystem>
#include <fstream>
namespace {
void* app[33]{};void* base[17]{};struct FileSystem{void** app;void** base;}object{app,base};
struct Asset{std::vector<unsigned char> bytes;bool directory=false;};std::map<std::string,Asset> assets;
struct Reader{std::string name;size_t offset=0;};std::vector<Reader*> readers;
struct Search{std::vector<std::pair<std::string,bool>> names;size_t index=0;};std::map<int,Search> searches;int next=0,errors=0,closed=0,findClosed=0;
std::vector<std::string> mounts;int added=0,removed=0,refuseRemove=0;
std::string gamePath="fixture/game;fixture/addons.vpk";
int __fastcall getSearchPath(void* self,void*,const char* id,bool packs,char* out,int capacity){
    if(self!=&object||strcmp(id,"GAME")||!packs||capacity<1){++errors;return 0;}
    const auto n=std::min(gamePath.size(),size_t(capacity-1));memcpy(out,gamePath.data(),n);out[n]=0;return int(gamePath.size()+1);
}
bool mounted_file(const char* file){for(const auto& root:mounts)if(std::filesystem::is_regular_file(std::filesystem::u8path(root)/std::filesystem::u8path(file)))return true;return false;}
void __fastcall addPath(void* self,void*,const char* path,const char* id,int type,int flags){if(self!=&object||strcmp(id,"GAME")||type!=1||flags){++errors;return;}mounts.push_back(path);++added;}
bool __fastcall removePath(void* self,void*,const char* path,const char* id){if(self!=&object||strcmp(id,"GAME")){++errors;return false;}if(refuseRemove){--refuseRemove;return false;}auto i=std::find(mounts.begin(),mounts.end(),path);if(i==mounts.end())return false;mounts.erase(i);++removed;return true;}
bool __fastcall exists(void* self,void*,const char* file,const char* path){return self==&object.base&&!strcmp(path,"GAME")&&!strcmp(file,"materials/fixture/icon.vmt");}
void* __fastcall fixture_open(void* self,void*,const char* path,const char* mode,const char* mount){if(self!=&object.base||strcmp(mode,"rb")||strcmp(mount,"GAME")){++errors;return nullptr;}
    auto a=assets.find(path);if(a==assets.end()){for(const auto& root:mounts){std::ifstream in(std::filesystem::u8path(root)/std::filesystem::u8path(path),std::ios::binary);if(in){auto& value=assets[path];value.bytes.assign(std::istreambuf_iterator<char>(in),{});a=assets.find(path);break;}}}if(a==assets.end()||a->second.directory)return nullptr;auto r=new Reader{path,0};readers.push_back(r);return r;}
unsigned __fastcall size(void* self,void*,void* handle){if(self!=&object.base)++errors;return unsigned(assets[static_cast<Reader*>(handle)->name].bytes.size());}
int __fastcall fixture_read(void* self,void*,void* out,int count,void* handle){if(self!=&object.base||count<0||count>256*1024){++errors;return -1;}
    auto r=static_cast<Reader*>(handle);auto& b=assets[r->name].bytes;const size_t n=std::min(size_t(count),r->offset<b.size()?b.size()-r->offset:0);memcpy(out,b.data()+std::min(r->offset,b.size()),n);r->offset+=n;return int(n);}
void __fastcall fixture_close(void* self,void*,void* handle){if(self!=&object.base)++errors;auto r=static_cast<Reader*>(handle);readers.erase(std::remove(readers.begin(),readers.end(),r),readers.end());delete r;++closed;}
const char* __fastcall first(void* self,void*,const char* glob,const char* mount,int* handle){if(self!=&object||strcmp(mount,"GAME")){++errors;return nullptr;}std::string pattern=glob;auto star=pattern.find('*');Search search;
    for(auto& a:assets){bool match=star==std::string::npos?a.first==pattern:a.first.substr(0,star)==pattern.substr(0,star)&&a.first.size()>=pattern.size()-1&&a.first.substr(a.first.size()-(pattern.size()-star-1))==pattern.substr(star+1);
        if(match){auto slash=a.first.find_last_of('/');search.names.emplace_back(a.first.substr(slash==std::string::npos?0:slash+1),a.second.directory);}}
    if(search.names.empty()){*handle=-1;return nullptr;}*handle=next++;auto& s=searches[*handle]=std::move(search);return s.names[0].first.c_str();}
const char* __fastcall nextFile(void* self,void*,int handle){if(self!=&object)++errors;auto& s=searches[handle];return ++s.index<s.names.size()?s.names[s.index].first.c_str():nullptr;}
bool __fastcall directory(void* self,void*,int handle){if(self!=&object)++errors;auto& s=searches[handle];return s.index<s.names.size()&&s.names[s.index].second;}
void __fastcall findClose(void* self,void*,int handle){if(self!=&object||!searches.count(handle))++errors;searches.erase(handle);++findClosed;}
}
extern "C" __declspec(dllexport) void* __cdecl CreateInterface(const char* name,int*){base[10]=reinterpret_cast<void*>(&exists);base[0]=reinterpret_cast<void*>(&fixture_read);base[2]=reinterpret_cast<void*>(&fixture_open);base[3]=reinterpret_cast<void*>(&fixture_close);base[6]=reinterpret_cast<void*>(&size);app[13]=reinterpret_cast<void*>(&getSearchPath);app[7]=reinterpret_cast<void*>(&addPath);app[8]=reinterpret_cast<void*>(&removePath);app[29]=reinterpret_cast<void*>(&nextFile);app[30]=reinterpret_cast<void*>(&directory);app[31]=reinterpret_cast<void*>(&findClose);app[32]=reinterpret_cast<void*>(&first);return !strcmp(name,"VFileSystem018")?&object:nullptr;}
extern "C" __declspec(dllexport) int __cdecl FixtureFsMounted(const char* file){return mounted_file(file);}
extern "C" __declspec(dllexport) void __cdecl FixtureFsSearchPath(const char* path){gamePath=path;app[13]=reinterpret_cast<void*>(&getSearchPath);}
extern "C" __declspec(dllexport) void __cdecl FixtureFsMountStats(int* out){out[0]=int(mounts.size());out[1]=added;out[2]=removed;out[3]=errors;}
extern "C" __declspec(dllexport) void __cdecl FixtureFsRefuseRemove(int count){refuseRemove=count;}
extern "C" __declspec(dllexport) void __cdecl FixtureFsAdd(const char* path,const void* bytes,unsigned size,int directory){auto& a=assets[path];a.directory=directory!=0;a.bytes.resize(size);if(size&&bytes)memcpy(a.bytes.data(),bytes,size);}
extern "C" __declspec(dllexport) void __cdecl FixtureFsStats(int* out){out[0]=int(readers.size());out[1]=int(searches.size());out[2]=errors;out[3]=closed;out[4]=findClosed;}
