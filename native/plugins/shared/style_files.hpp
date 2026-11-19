// GPL-3.0. SDK-only adapter for the extracted Skeeto style catalog.
#pragma once
#include "l4p_file.h"
#include <algorithm>
#include <cstring>
#include <map>

using FileHandle_t = uint32_t;
using FileFindHandle_t = uint32_t;
#define SKEETO_FS_INVALID_HANDLE 0u

class IFileSystem {
    L4P_FileApiV3 api_{};
    uint32_t token_=0, revision_=0;
    bool ready_=false;
    std::map<uint32_t,uint32_t> files_;
    std::map<uint32_t,L4P_FileEntryV1> searches_;
public:
    void bind(const L4P_FileApiV3* api,uint32_t token){
        release();if(api&&api->base.base.api_version==3&&api->base.base.struct_size==sizeof(*api)&&token){api_=*api;token_=token;}
    }
    void release(){
        if(token_){for(auto& f:files_)api_.base.base.close(token_,f.first);for(auto& f:searches_)api_.base.base.find_close(token_,f.first);}
        files_.clear();searches_.clear();api_={};token_=revision_=0;ready_=false;
    }
    bool refresh(){
        ready_=token_&&api_.path_revision&&api_.path_revision(token_,&revision_)==L4P_OK;
        return ready_;
    }
    bool available()const{return ready_;}
    uint32_t revision()const{return ready_?revision_:0;}
    FileHandle_t Open(const char* path,const char* mode,const char* pathId){
        if(!ready_||!mode||strcmp(mode,"rb")||!pathId||strcmp(pathId,"GAME"))return 0;
        uint32_t handle=0,size=0;if(api_.base.base.open(token_,path,1024u*1024u*1024u,&handle,&size))return 0;
        try{files_.emplace(handle,size);}catch(...){api_.base.base.close(token_,handle);return 0;}return handle;
    }
    unsigned Size(FileHandle_t handle)const{auto i=files_.find(handle);return i==files_.end()?0:i->second;}
    int Read(void* data,int size,FileHandle_t handle){
        if(!ready_||!data||size<0||!files_.count(handle))return -1;
        uint32_t total=0;while(total<uint32_t(size)){uint32_t got=0;
            if(api_.base.base.read(token_,handle,static_cast<unsigned char*>(data)+total,std::min(uint32_t(size)-total,256u*1024u),&got))return -1;
            if(!got)break;total+=got;
        }return int(total);
    }
    void Close(FileHandle_t handle){if(files_.erase(handle))api_.base.base.close(token_,handle);}
    const char* FindFirstEx(const char* glob,const char* pathId,FileFindHandle_t* handle){
        if(!handle)return nullptr;*handle=0;if(!ready_||!pathId||strcmp(pathId,"GAME"))return nullptr;
        uint32_t id=0;if(api_.base.base.find_open(token_,glob,&id))return nullptr;
        try{searches_.emplace(id,L4P_FileEntryV1{sizeof(L4P_FileEntryV1)});}catch(...){api_.base.base.find_close(token_,id);return nullptr;}
        *handle=id;auto name=FindNext(id);if(!name){FindClose(id);*handle=0;}return name;
    }
    const char* FindNext(FileFindHandle_t handle){
        auto i=searches_.find(handle);if(!ready_||i==searches_.end())return nullptr;
        auto& entry=i->second;if(api_.base.base.find_next(token_,handle,&entry)||entry.done)return nullptr;return entry.name;
    }
    bool FindIsDirectory(FileFindHandle_t handle)const{auto i=searches_.find(handle);return i!=searches_.end()&&i->second.is_directory;}
    void FindClose(FileFindHandle_t handle){if(searches_.erase(handle))api_.base.base.find_close(token_,handle);}
};
