// GPL-3.0. VFileSystem018 layout from Skeeto's skeeto_filesystem.h.
struct FileLease{uint32_t token=0,id=0,size=0,offset=0;void* base=nullptr;void* handle=nullptr;bool closing=false;};
struct FileSearch{uint32_t token=0,id=0;void* fs=nullptr;int handle=-1;bool closing=false,open=false;char current[260]{};};
struct FileMount{void* fs=nullptr;std::string path;bool closing=false;};
struct FileService{std::map<uint32_t,FileLease> files;std::map<uint32_t,FileSearch> searches;std::map<uint32_t,FileMount> mounts;uint32_t next=1;};
FileService& files(){static auto* f=new FileService;return *f;}
bool file_path(const char* text,bool glob){
    if(!text||!*text)return false;const size_t n=strnlen(text,513);if(n>512||text[0]=='/'||text[n-1]=='/')return false;
    if(!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text,int(n),nullptr,0))return false;
    size_t start=0;for(size_t i=0;i<=n;++i){auto c=static_cast<unsigned char>(text[i]);
        if(i<n&&(c<32||c==127||strchr("\\:\"<>|",c)))return false;
        if(i<n&&(c=='*'||c=='?')&&(!glob||strchr(text+i,'/')))return false;
        if(!c||c=='/'){const size_t size=i-start;if(!size||(size==1&&text[start]=='.')||(size==2&&text[start]=='.'&&text[start+1]=='.'))return false;start=i+1;}}
    return true;
}
uint32_t file_scope(uint32_t token){auto& s=service();auto sub=s.subs.find(token);
    if(!paintCallback||!s.running||sub==s.subs.end()||!sub->second->active)return L4P_BAD_ARGUMENT;
    if(s.frame.loading)return L4P_ENTITY_SCOPE;
    return sub->second->scope==L4P_SOURCE_ANY?L4P_OK:effects_scope(token);
}
bool file_owner(uint32_t token){auto& s=service();auto sub=s.subs.find(token);return s.running&&sub!=s.subs.end()&&sub->second->active;}
void files_pump(){auto& f=files();using Close=void(__thiscall*)(void*,void*);using FindClose=void(__thiscall*)(void*,int);
    for(auto i=f.mounts.begin();i!=f.mounts.end();){auto& l=i->second;if(l.closing||!file_owner(i->first)||file_scope(i->first)!=L4P_OK){
        // Loading pauses the native filesystem. Scope cleanup resumes afterward.
        if(service().running&&service().frame.loading){++i;continue;}
        using Remove=bool(__thiscall*)(void*,const char*,const char*);auto remove=method<Remove>(l.fs,8);
        l.closing=true;if(remove&&remove(l.fs,l.path.c_str(),"GAME")){i=f.mounts.erase(i);continue;}}++i;}
    for(auto i=f.files.begin();i!=f.files.end();){auto& l=i->second;if(l.closing||!file_owner(l.token)){auto close=method<Close>(l.base,3);if(close)close(l.base,l.handle);i=f.files.erase(i);}else ++i;}
    for(auto i=f.searches.begin();i!=f.searches.end();){auto& l=i->second;if(l.closing||!file_owner(l.token)){auto close=method<FindClose>(l.fs,31);if(l.open&&close)close(l.fs,l.handle);i=f.searches.erase(i);}else ++i;}
}
uint32_t file_id(){auto& f=files();do{if(++f.next==0)++f.next;}while(f.files.count(f.next)||f.searches.count(f.next));return f.next;}
uint32_t L4P_CALL file_open(uint32_t token,const char* path,uint32_t limit,uint32_t* handle,uint32_t* size){
    if(!handle||!size||!limit||limit>1024u*1024u*1024u||!file_path(path,false))return L4P_BAD_ARGUMENT;
    auto result=file_scope(token);if(result!=L4P_OK)return result;auto& f=files();if(f.files.size()>=64)return L4P_ERROR;
    auto fs=static_cast<unsigned char*>(iface(L"filesystem_stdio.dll","VFileSystem018"));if(!fs)return L4P_ENTITY_MISSING;void* base=fs+4;
    using Open=void*(__thiscall*)(void*,const char*,const char*,const char*);using Size=uint32_t(__thiscall*)(void*,void*);using Close=void(__thiscall*)(void*,void*);
    auto open=method<Open>(base,2);auto getSize=method<Size>(base,6);auto close=method<Close>(base,3);if(!open||!getSize||!close)return L4P_ENTITY_MISSING;
    auto native=open(base,path,"rb","GAME");if(!native)return L4P_ENTITY_MISSING;const auto bytes=getSize(base,native);if(bytes>limit){close(base,native);return L4P_ERROR;}
    const auto id=file_id();try{f.files.emplace(id,FileLease{token,id,bytes,0,base,native,false});}catch(...){close(base,native);return L4P_ERROR;}
    *handle=id;*size=bytes;return L4P_OK;
}
uint32_t L4P_CALL file_read(uint32_t token,uint32_t id,void* out,uint32_t capacity,uint32_t* count){
    if(!out||!count||!capacity||capacity>256u*1024u)return L4P_BAD_ARGUMENT;auto result=file_scope(token);if(result!=L4P_OK)return result;
    auto& f=files();auto i=f.files.find(id);if(i==f.files.end()||i->second.token!=token||i->second.closing)return L4P_BAD_ARGUMENT;auto& l=i->second;
    const auto wanted=std::min(capacity,l.size-l.offset);if(!wanted){*count=0;return L4P_OK;}
    using Read=int(__thiscall*)(void*,void*,int,void*);auto read=method<Read>(l.base,0);if(!read)return L4P_ENTITY_MISSING;
    const int got=read(l.base,out,int(wanted),l.handle);if(got<=0||uint32_t(got)>wanted)return L4P_ERROR;
    l.offset+=uint32_t(got);*count=uint32_t(got);return L4P_OK;
}
uint32_t L4P_CALL file_close(uint32_t token,uint32_t id){
    auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);auto& f=files();auto i=f.files.find(id);if(i==f.files.end()||i->second.token!=token)return L4P_BAD_ARGUMENT;
    i->second.closing=true;if(paintCallback)files_pump();return L4P_OK;
}
uint32_t L4P_CALL file_find_open(uint32_t token,const char* glob,uint32_t* handle){
    if(!handle||!file_path(glob,true))return L4P_BAD_ARGUMENT;auto result=file_scope(token);if(result!=L4P_OK)return result;auto& f=files();if(f.searches.size()>=64)return L4P_ERROR;
    auto fs=iface(L"filesystem_stdio.dll","VFileSystem018");using First=const char*(__thiscall*)(void*,const char*,const char*,int*);using Close=void(__thiscall*)(void*,int);
    auto first=method<First>(fs,32);auto close=method<Close>(fs,31);if(!first||!close)return L4P_ENTITY_MISSING;
    FileSearch search{};search.token=token;search.fs=fs;const auto name=first(fs,glob,"GAME",&search.handle);search.open=search.handle!=-1;
    if(name){copy(search.current,name);if(!search.current[0]){if(search.open)close(fs,search.handle);return L4P_ERROR;}}
    const auto id=file_id();search.id=id;try{f.searches.emplace(id,search);}catch(...){if(search.open)close(fs,search.handle);return L4P_ERROR;}
    *handle=id;return L4P_OK;
}
uint32_t L4P_CALL file_find_next(uint32_t token,uint32_t id,L4P_FileEntryV1* out){
    if(!out||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;auto result=file_scope(token);if(result!=L4P_OK)return result;
    auto& f=files();auto i=f.searches.find(id);if(i==f.searches.end()||i->second.token!=token||i->second.closing)return L4P_BAD_ARGUMENT;auto& l=i->second;
    L4P_FileEntryV1 entry{sizeof(entry)};if(!l.current[0]){entry.done=1;*out=entry;return L4P_OK;}
    using Next=const char*(__thiscall*)(void*,int);using Directory=bool(__thiscall*)(void*,int);auto next=method<Next>(l.fs,29);auto dir=method<Directory>(l.fs,30);if(!next||!dir)return L4P_ENTITY_MISSING;
    memcpy(entry.name,l.current,sizeof(entry.name));entry.is_directory=dir(l.fs,l.handle);const auto name=next(l.fs,l.handle);l.current[0]=0;if(name){copy(l.current,name);if(!l.current[0])return L4P_ERROR;}
    *out=entry;return L4P_OK;
}
uint32_t L4P_CALL file_find_close(uint32_t token,uint32_t id){
    auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);auto& f=files();auto i=f.searches.find(id);if(i==f.searches.end()||i->second.token!=token)return L4P_BAD_ARGUMENT;
    i->second.closing=true;if(paintCallback)files_pump();return L4P_OK;
}
bool file_directory(const std::filesystem::path& p){auto flags=GetFileAttributesW(p.c_str());return flags!=INVALID_FILE_ATTRIBUTES&&(flags&FILE_ATTRIBUTE_DIRECTORY)&&!(flags&FILE_ATTRIBUTE_REPARSE_POINT);}
uint32_t L4P_CALL file_mount_assets(uint32_t token){
    auto result=file_scope(token);if(result)return result;auto& f=files();auto held=f.mounts.find(token);if(held!=f.mounts.end())return held->second.closing?L4P_ERROR:L4P_OK;
    auto& s=service();const auto& id=s.subs.at(token)->id;
    if(id.empty()||id.front()<'a'||id.front()>'z'||id.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789._-")!=std::string::npos||s.packageRoot.empty())return L4P_BAD_ARGUMENT;
    try{auto dir=s.packageRoot/std::filesystem::u8path(id),assets=dir/L"assets";
        if(!file_directory(s.packageRoot)||!file_directory(dir)||!file_directory(assets))return L4P_ENTITY_MISSING;
        auto path=assets.u8string();auto fs=iface(L"filesystem_stdio.dll","VFileSystem018");
        using Add=void(__thiscall*)(void*,const char*,const char*,int,int);auto add=method<Add>(fs,7);if(!add||!slot(fs,8))return L4P_ENTITY_MISSING;
        auto i=f.mounts.emplace(token,FileMount{fs,std::move(path)}).first;add(fs,i->second.path.c_str(),"GAME",1,0);return L4P_OK;
    }catch(...){return L4P_ERROR;}
}
uint32_t L4P_CALL file_unmount_assets(uint32_t token){
    if(!token)return L4P_BAD_ARGUMENT;auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);auto i=files().mounts.find(token);if(i!=files().mounts.end())i->second.closing=true;
    if(paintCallback)files_pump();return L4P_OK;
}

uint32_t L4P_CALL file_path_revision(uint32_t token,uint32_t* revision){
    if(!revision)return L4P_BAD_ARGUMENT;auto result=file_scope(token);if(result)return result;
    auto fs=iface(L"filesystem_stdio.dll","VFileSystem018");
    using SearchPath=int(__thiscall*)(void*,const char*,bool,char*,int);
    auto read=method<SearchPath>(fs,13);if(!read)return L4P_ENTITY_MISSING;
    char paths[4096]{};read(fs,"GAME",true,paths,int(sizeof(paths)-1));paths[sizeof(paths)-1]=0;
    uint32_t fingerprint=2166136261u;for(auto p=paths;*p;++p){fingerprint^=static_cast<unsigned char>(*p);fingerprint*=16777619u;}
    *revision=fingerprint?fingerprint:1;return L4P_OK;
}
