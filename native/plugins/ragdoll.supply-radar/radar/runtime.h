#pragma once
#include "sdk.h"
extern "C" int _fltused=0;
extern "C" void* memcpy(void* out,const void* in,SIZE_T n){auto d=(unsigned char*)out;auto s=(const unsigned char*)in;for(unsigned i=0;i<n;++i)d[i]=s[i];return out;}
extern "C" void* memset(void* out,int value,SIZE_T n){auto d=(unsigned char*)out;for(unsigned i=0;i<n;++i)d[i]=(unsigned char)value;return out;}
void operator delete(void*) noexcept{}
struct Blob {
    unsigned char* data=nullptr;unsigned size=0;
    void Clear(){if(data)HeapFree(GetProcessHeap(),0,data);data=nullptr;size=0;}
    bool Allocate(unsigned n){Clear();if(!n||n>64u*1024*1024)return false;data=(unsigned char*)HeapAlloc(GetProcessHeap(),0,n);if(!data)return false;size=n;return true;}
    bool Load(const WCHAR* path){Clear();auto f=CreateFileW(path,0x80000000,3,nullptr,3,0x80,nullptr);if(f==(HANDLE)-1)return false;
        DWORD hi=0,n=GetFileSize(f,&hi),read=0;bool ok=!hi&&Allocate(n)&&ReadFile(f,data,n,&read,nullptr)&&read==n;CloseHandle(f);if(!ok)Clear();return ok;}
};
