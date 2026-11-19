#pragma once
#include "win32.h"
inline unsigned TextLength(const char* s){unsigned n=0;if(s)while(s[n])++n;return n;}
inline bool Same(const char* a,const char* b){if(!a||!b)return a==b;while(*a&&*a==*b){++a;++b;}return *a==*b;}
inline void WideCopy(WCHAR* out,unsigned cap,const WCHAR* text){unsigned i=0;while(text&&text[i]&&i+1<cap){out[i]=text[i];++i;}out[i]=0;}
inline void WideAppend(WCHAR* out,unsigned cap,const WCHAR* text){unsigned i=0;while(out[i]&&i<cap)++i;if(i<cap)WideCopy(out+i,cap-i,text);}
inline void CopyText(char* out,unsigned cap,const char* text){unsigned i=0;while(text&&text[i]&&i+1<cap){out[i]=text[i];++i;}out[i]=0;}
inline int Limit(int n,int lo,int hi){return n<lo?lo:n>hi?hi:n;}
inline float Limit(float n,float lo,float hi){return n<lo?lo:n>hi?hi:n;}
inline bool Finite(float x){return x==x&&x>-1e20f&&x<1e20f;}
inline bool Readable(const void* ptr,unsigned bytes){
    if(!ptr||!bytes)return false;
    unsigned at=(unsigned)ptr,end=at+bytes;if(end<at)return false;
    while(at<end){MemoryInfo m{};
        if(!VirtualQuery((void*)at,&m,sizeof m)||m.state!=0x1000||(m.protect&0x101))return false;
        unsigned regionEnd=(unsigned)m.base+m.size;if(regionEnd<=at)return false;
        at=regionEnd<end?regionEnd:end;
    }
    return true;
}
inline bool Executable(const void* p){MemoryInfo m{};return p&&VirtualQuery(p,&m,sizeof m)&&m.state==0x1000&&(m.protect&0xf0)&&!(m.protect&0x100);}
template<class F>inline F VCall(void* obj,int index){return reinterpret_cast<F>((*reinterpret_cast<void***>(obj))[index]);}
inline bool MethodOK(void* obj,int index){return Readable(obj,4)&&Readable(*(void***)obj,(index+1)*4)&&Executable((*(void***)obj)[index]);}
inline void* GetInterface(const WCHAR* module,const char* name){auto dll=GetModuleHandleW(module);using Factory=void*(__cdecl*)(const char*,int*);auto fn=dll?(Factory)GetProcAddress(dll,"CreateInterface"):nullptr;return fn?fn(name,nullptr):nullptr;}
struct Vec {float x,y,z;Vec operator+(Vec b)const{return{x+b.x,y+b.y,z+b.z};}Vec operator-(Vec b)const{return{x-b.x,y-b.y,z-b.z};}Vec operator*(float a)const{return{x*a,y*a,z*a};}float Dot(Vec b)const{return x*b.x+y*b.y+z*b.z;}};
struct Matrix {float m[4][4];};
struct RecvTable;
struct RecvProp {const char* name;int type,flags,stringSize;bool inside;const void* extra;RecvProp* array;void* arrayLength;void* proxy;void* tableProxy;RecvTable* table;int offset,stride,count;const char* parentName;};
struct RecvTable {RecvProp* props;int count;void* decoder;const char* name;bool initialized,inList;};
struct ClientClass {void* create;void* createEvent;const char* name;RecvTable* table;ClientClass* next;int id;};
struct alignas(16) Vec4 {float x,y,z,w;};
struct alignas(16) Ray {Vec4 start,delta,offset,extents;const void* worldAxisTransform;bool isRay,isSwept;};
struct Trace {Vec start,end,normal;float planeDistance;unsigned char planeType,signBits,pad[2];float fraction;int contents;unsigned short flags;bool allSolid,startSolid;float leftSolid;const char* surfaceName;short surfaceProps;unsigned short surfaceFlags;int hitgroup;short physicsBone;unsigned short padding;void* entity;int hitbox;};
class TraceFilter {public:void* skip;virtual bool ShouldHitEntity(void* entity,int){return entity!=skip;}virtual int GetTraceType()const{return 0;}};
static_assert(sizeof(void*)==4,"Build with the 32-bit Microsoft C++ ABI");
static_assert(sizeof(RecvProp)==60&&sizeof(Trace)==84&&sizeof(Ray)==80,"L4D2 ABI sizes");
static_assert(__builtin_offsetof(Ray,worldAxisTransform)==64&&__builtin_offsetof(Ray,isRay)==68,"L4D2 Ray layout");




