// GPL-3.0. Bounded resource adapters for the extracted Skeeto music workers.
// Source handles stay on Paint; decoder workers only receive private native paths.
#include <map>
#include <filesystem>
#include <algorithm>
namespace {
L4P_FileApiV1 musicFiles{};const uint32_t* musicToken=nullptr;std::wstring musicCache;
std::map<std::string,std::wstring> completedMusicFiles;std::vector<std::wstring> retiredMusicFiles;
struct DlcGameGlobScan{uint32_t handle=0;int visited=0;};
struct DlcCacheExtract{uint32_t handle=0,size=0,offset=0;HANDLE output=INVALID_HANDLE_VALUE;std::string source;std::wstring temporary,final;bool complete=false,failed=false;};
void DlcGameGlobScanCancel(DlcGameGlobScan* scan){if(!scan)return;if(scan->handle)musicFiles.find_close(*musicToken,scan->handle);delete scan;}
void DlcGameGlobScanAbandon(DlcGameGlobScan* scan){DlcGameGlobScanCancel(scan);}
DlcGameGlobScan* DlcGameGlobScanBegin(const char* pattern){uint32_t handle=0;if(musicFiles.find_open(*musicToken,pattern,&handle)!=L4P_OK)return nullptr;
    auto scan=new(std::nothrow) DlcGameGlobScan{handle,0};if(!scan)musicFiles.find_close(*musicToken,handle);return scan;}
int DlcGameGlobScanPump(DlcGameGlobScan* scan,int budget,void(*fn)(const char*,void*),void* context){
    if(!scan||!fn||budget<1)return -1;budget=std::min(budget,64);for(int i=0;i<budget;++i){L4P_FileEntryV1 entry{sizeof(entry)};
        if(musicFiles.find_next(*musicToken,scan->handle,&entry)!=L4P_OK)return -1;if(entry.done)return 1;if(++scan->visited>4096)return 2;if(!entry.is_directory)fn(entry.name,context);}return 0;
}
void DlcCacheExtractCancel(DlcCacheExtract* e){if(!e)return;if(e->handle)musicFiles.close(*musicToken,e->handle);if(e->output!=INVALID_HANDLE_VALUE)CloseHandle(e->output);
    if(!e->complete&&!e->temporary.empty())DeleteFileW(e->temporary.c_str());delete e;}
void DlcCacheExtractAbandon(DlcCacheExtract* e){DlcCacheExtractCancel(e);}
DlcCacheExtract* DlcCacheExtractBegin(const char* relative,const wchar_t* extension,unsigned limit){
    if(!relative||!extension||(wcscmp(extension,L".wav")&&wcscmp(extension,L".mp3"))||musicCache.empty())return nullptr;
    uint32_t handle=0,size=0;if(musicFiles.open(*musicToken,relative,limit,&handle,&size)!=L4P_OK)return nullptr;if(!size){musicFiles.close(*musicToken,handle);return nullptr;}
    auto e=new(std::nothrow) DlcCacheExtract;if(!e){musicFiles.close(*musicToken,handle);return nullptr;}e->handle=handle;e->size=size;e->source=relative;
    if(!CreateDirectoryW(musicCache.c_str(),nullptr)&&GetLastError()!=ERROR_ALREADY_EXISTS){DlcCacheExtractCancel(e);return nullptr;}
    wchar_t path[MAX_PATH]{};if(!GetTempFileNameW(musicCache.c_str(),L"mus",0,path)){DlcCacheExtractCancel(e);return nullptr;}
    e->temporary=path;e->final=e->temporary+extension;e->output=CreateFileW(path,GENERIC_WRITE,0,nullptr,TRUNCATE_EXISTING,FILE_ATTRIBUTE_TEMPORARY|FILE_FLAG_SEQUENTIAL_SCAN,nullptr);
    if(e->output==INVALID_HANDLE_VALUE){DlcCacheExtractCancel(e);return nullptr;}return e;
}
int DlcCacheExtractPump(DlcCacheExtract* e,unsigned budget,wchar_t* out,size_t capacity){
    if(!e||e->failed||!out||capacity<=e->final.size())return -1;out[0]=0;if(e->complete){wcscpy_s(out,capacity,e->final.c_str());return 1;}
    unsigned char buffer[256*1024];const auto wanted=std::min(budget,unsigned(sizeof(buffer)));if(!wanted)return -1;uint32_t read=0;
    if(musicFiles.read(*musicToken,e->handle,buffer,wanted,&read)!=L4P_OK||!read){e->failed=true;return -1;}DWORD written=0;
    if(!WriteFile(e->output,buffer,read,&written,nullptr)||written!=read){e->failed=true;return -1;}e->offset+=read;if(e->offset<e->size)return 0;
    const bool flushed=FlushFileBuffers(e->output)!=FALSE;CloseHandle(e->output);e->output=INVALID_HANDLE_VALUE;musicFiles.close(*musicToken,e->handle);e->handle=0;
    if(!flushed||!MoveFileExW(e->temporary.c_str(),e->final.c_str(),MOVEFILE_WRITE_THROUGH)){e->failed=true;return -1;}
    auto previous=completedMusicFiles.find(e->source);if(previous!=completedMusicFiles.end()&&previous->second!=e->final)retiredMusicFiles.push_back(previous->second);
    completedMusicFiles[e->source]=e->final;e->complete=true;wcscpy_s(out,capacity,e->final.c_str());return 1;
}
void musicPruneFiles(const wchar_t* safe,const wchar_t* last){
    for(auto i=completedMusicFiles.begin();i!=completedMusicFiles.end();){if(i->second!=safe&&i->second!=last){retiredMusicFiles.push_back(i->second);i=completedMusicFiles.erase(i);}else ++i;}
    for(auto i=retiredMusicFiles.begin();i!=retiredMusicFiles.end();){if(DeleteFileW(i->c_str())||GetLastError()==ERROR_FILE_NOT_FOUND)i=retiredMusicFiles.erase(i);else ++i;}
}
}
void SkeetoMusicBind(const L4P_FileApiV1& api,const uint32_t* token,const wchar_t* cacheDirectory){musicFiles=api;musicToken=token;musicCache=cacheDirectory;}
void SkeetoMusicClearCache(){musicPruneFiles(L"",L"");}
