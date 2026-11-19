#pragma once
#include "sdk.h"
namespace safe_string {
// Query once per mapped region, then inspect only the validated span. A NUL
// just before a guard/unmapped page is valid; never read across that boundary.
inline unsigned Span(const char* text,unsigned maximum){
    if(!text||!maximum)return 0;MemoryInfo info{};unsigned at=unsigned(text);
    if(!VirtualQuery(text,&info,sizeof info)||info.state!=0x1000||(info.protect&0x101))return 0;
    unsigned end=unsigned(info.base)+info.size;if(end<=at)return 0;
    return end-at<maximum?end-at:maximum;
}
inline bool Equal(const char* a,const char* trusted){
    unsigned i=0;while(i<160){unsigned n=Span(a? a+i:nullptr,160-i);if(!n)return false;
        for(unsigned j=0;j<n;++j,++i){if(a[i]!=trusted[i])return false;if(!trusted[i])return true;}}
    return false;
}
inline bool Copy(char* to,unsigned cap,const char* from){
    if(!from||!cap)return false;unsigned i=0;
    while(i<cap){unsigned n=Span(from+i,cap-i);if(!n)return false;
        for(unsigned j=0;j<n;++j,++i){to[i]=from[i];if(!to[i])return true;}}
    to[cap-1]=0;return false;
}
}
