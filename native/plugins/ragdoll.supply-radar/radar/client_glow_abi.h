#pragma once
#include "client_glow_core.h"
#include "controls.h"

namespace client_glow {
// Actual installed CGlowProperty layout, including the native color cache.
// The owner is the main IClientEntity base returned by EntityList slot 3.
struct Block {
    void** vtable;int type,maximum,minimum;unsigned color;
    unsigned char flashing,padding[3];Vec rgb;int renderIndex;
    unsigned char active,padding2[3];void* owner;
};
static_assert(sizeof(Block)==48&&__builtin_offsetof(Block,owner)==44&&__builtin_offsetof(Block,rgb)==24,"CGlowProperty ABI");
static_assert(__builtin_offsetof(Block,maximum)==8&&__builtin_offsetof(Block,minimum)==12,"Native range precedes range minimum");
using SetTypeFn=void(__thiscall*)(Block*,int);
struct Native {
    unsigned char* base=nullptr;SetTypeFn setType=nullptr;
    static bool Layout(int type,int maximum,int minimum,int color,int flashing){
        int start=type-4;
        return start>=0&&maximum==start+8&&minimum==start+12&&color==start+16&&flashing==start+20;
    }
    static bool Tables(unsigned char* image){
        // Live C_BaseEntity embeds a network wrapper, not the plain standalone
        // CGlowProperty table. Both have the same native glow-owner layout.
        return Readable(image+0x56d474,12)&&Readable(image+0x5445ec,12)&&
            *(void**)(image+0x56d474)==image+0x109c10&&*(void**)(image+0x56d478)==image+0x109c00&&
            *(void**)(image+0x56d47c)==image+0x109860&&
            *(void**)(image+0x5445ec)==image+0x45860&&*(void**)(image+0x5445f0)==image+0x45850&&
            *(void**)(image+0x5445f4)==image+0x109860&&
            Readable(image+0x45860,3)&&image[0x45860]==0xc2&&image[0x45861]==4&&image[0x45862]==0&&
            Readable(image+0x45850,1)&&image[0x45850]==0xc3;
    }
    static bool Accept(unsigned char* image){
        if(!Readable(image,4096)||*(unsigned short*)image!=0x5a4d)return false;
        unsigned nt=*(unsigned*)(image+60);
        if(nt>0xe00||*(unsigned*)(image+nt)!=0x4550||*(unsigned short*)(image+nt+4)!=0x14c||
            *(unsigned*)(image+nt+8)!=0x6a440ecfu||*(unsigned*)(image+nt+80)!=0x963000)return false;
        const unsigned char setter[]={0x55,0x8b,0xec,0x53,0x8b,0x5d,0x08,0x56,0x57,0x8b,0xf9,0x39,0x5f,0x04,0x8d,0x77,0x04,0x74,0x0d,0x8b,0x46,0xfc,0x8b,0x10,0x8d,0x4e,0xfc,0x56,0xff,0xd2,0x89,0x1e};
        const unsigned char add[]={0x55,0x8b,0xec,0x53,0x8b,0x5d,0x08,0x85,0xdb,0x74,0x75,0x56,0x8d,0x71,0x0c};
        const unsigned char remove[]={0x55,0x8b,0xec,0x83,0x7d,0x08,0,0x74,0x0c,0x8d,0x45,0x08,0x50,0x83,0xc1,0x0c};
        auto getter=image+0x1091e0;
        return Executable(image+0x109a20)&&controls::EqualBytes(image+0x109a20,setter,sizeof setter)&&
            controls::EqualBytes(image+0x109750,add,sizeof add)&&controls::EqualBytes(image+0x1096c0,remove,sizeof remove)&&
            Readable(getter,6)&&getter[0]==0xa1&&*(unsigned*)(getter+1)==unsigned(image+0x7572c0)&&getter[5]==0xc3&&
            Tables(image);
    }
    bool Configure(){
        auto image=(unsigned char*)GetModuleHandleW(L"client.dll");
        if(!Accept(image))return false;base=image;setType=(SetTypeFn)(base+0x109a20);return true;
    }
    bool Ready()const{
        // The native manager is initialized by the game; never create or patch it.
        return base&&setType&&Readable(base+0x7572c0,4)&&Readable(*(void**)(base+0x7572c0),40);
    }
    static bool Writable(const void* address,unsigned size){
        MemoryInfo memory{};unsigned at=unsigned(address),end=at+size;
        if(!address||end<at||!VirtualQuery(address,&memory,sizeof memory)||memory.state!=0x1000||
            (memory.protect&0x101)||!(memory.protect&0xcc))return false;
        unsigned last=unsigned(memory.base)+memory.size;return last>=end&&last>at;
    }
    Block* Property(void* object,int offset)const{
        if(!Ready()||offset<0||offset>65536-int(sizeof(Block)))return nullptr;
        unsigned at=unsigned(object)+unsigned(offset);if(at<unsigned(object))return nullptr;
        auto block=(Block*)at;
        bool table=Writable(block,sizeof *block)&&(block->vtable==(void**)(base+0x56d474)||block->vtable==(void**)(base+0x5445ec));
        return table&&block->owner==object&&
            block->type>=0&&block->type<=3?block:nullptr;
    }
    static State Capture(const Block& block){return {block.type,block.minimum,block.maximum,block.color,block.flashing!=0,block.rgb};}
    bool Set(Block& block,const State& value,bool forceType)const{
        if(!Ready()||!Writable(&block,sizeof block)||value.type<0||value.type>3)return false;
        if(block.minimum!=value.minimum)block.minimum=value.minimum;
        if(block.maximum!=value.maximum)block.maximum=value.maximum;
        if(block.color!=value.color||!SameRgb(block.rgb,value.rgb)){block.color=value.color;block.rgb=value.rgb;}
        if(bool(block.flashing)!=value.flashing)block.flashing=static_cast<unsigned char>(value.flashing);
        // SetGlowType maintains the game's existing registration list. Writing
        // m_iGlowType directly would skip registration and can show no effect.
        if(forceType||block.type!=value.type)setType(&block,value.type);
        return true;
    }
};
}
