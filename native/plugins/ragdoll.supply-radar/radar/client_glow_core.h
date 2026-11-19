#pragma once
#include "sdk.h"

namespace client_glow {
constexpr unsigned Capacity=128;
struct State {int type=0,minimum=0,maximum=0;unsigned color=0;bool flashing=false;Vec rgb{};};
struct Target {unsigned index=0,key=0,color=0;float distance=0;unsigned label=0;};
struct Entry {Target target;int offset=-1;State original,written;};
inline bool SameRgb(Vec a,Vec b){return a.x==b.x&&a.y==b.y&&a.z==b.z;}
inline bool StateEquals(const State& a,const State& b){
    return a.type==b.type&&a.minimum==b.minimum&&a.maximum==b.maximum&&
        a.color==b.color&&a.flashing==b.flashing&&SameRgb(a.rgb,b.rgb);
}
inline unsigned ScaleColor(unsigned rgb,int brightness){
    unsigned percent=unsigned(Limit(brightness,0,100)),result=0;
    for(unsigned shift=0;shift<24;shift+=8)result|=((((rgb>>shift)&255u)*percent+50)/100)<<shift;
    return result;
}
inline State Desired(unsigned color,int distance){
    constexpr float normalize=1.f/255.f;
    return {3,0,distance,color,false,{float(color&255u)*normalize,float((color>>8)&255u)*normalize,float((color>>16)&255u)*normalize}};
}
// Preserve newer server values observed while this local effect was active.
inline void Observe(Entry& entry,const State& current){
    if(current.type!=entry.written.type)entry.original.type=current.type;
    if(current.minimum!=entry.written.minimum)entry.original.minimum=current.minimum;
    if(current.maximum!=entry.written.maximum)entry.original.maximum=current.maximum;
    if(current.flashing!=entry.written.flashing)entry.original.flashing=current.flashing;
    if(current.color!=entry.written.color||!SameRgb(current.rgb,entry.written.rgb)){
        entry.original.color=current.color;entry.original.rgb=current.rgb;
    }
}
struct Controller {
    Entry entries[Capacity]{};unsigned count=0,next=0;bool scheduled=false;
    void Remove(unsigned at){entries[at]=entries[--count];}
    template<class Host>void Release(Host& host,unsigned at){
        auto entry=entries[at];State current{};bool available=false;int offset=entry.offset;
        if(host.Read(entry.target,offset,current,available)){
            Observe(entry,current);host.Write(entry.target,offset,entry.original,false);
        }
        Remove(at);
    }
    template<class Host>void Stop(Host& host){while(count)Release(host,count-1);scheduled=false;next=0;}
    template<class Host,class Items>void Update(Host& host,const Items& items,unsigned now,int meters,unsigned limit){
        if(scheduled&&(int)(now-next)<0)return;
        scheduled=true;next=now+250u;limit=unsigned(Limit(int(limit),1,int(Capacity)));
        float radius=float(Limit(meters,5,120))*39.3701f;
        Target chosen[Capacity]{};unsigned selected=0;
        // Only copied radar data is surveyed. No extra entity discovery or trace.
        for(unsigned i=0;i<items.Size();++i){
            Target target{};if(!items.Get(i,target)||!target.key||target.index<1||target.index>=2048||
                !Finite(target.distance)||target.distance<0||target.distance>radius)continue;
            if(selected==limit&&target.distance>=chosen[selected-1].distance)continue;
            unsigned at=selected;if(at==limit)--at;
            while(at&&target.distance<chosen[at-1].distance){if(at<limit)chosen[at]=chosen[at-1];--at;}
            chosen[at]=target;if(selected<limit)++selected;
        }
        // Restore departed targets first, so replacing the nearest set never
        // temporarily doubles the configured number of local registrations.
        for(unsigned i=0;i<count;){
            bool wanted=false;for(unsigned j=0;j<selected;++j)if(entries[i].target.key==chosen[j].key&&entries[i].target.index==chosen[j].index){wanted=true;break;}
            if(!wanted)Release(host,i);else ++i;
        }
        for(unsigned i=0;i<selected;++i){
            auto target=chosen[i];unsigned at=0;
            while(at<count&&(entries[at].target.key!=target.key||entries[at].target.index!=target.index))++at;
            bool existing=at<count,available=false;int offset=existing?entries[at].offset:-1;State current{};
            if(!host.Read(target,offset,current,available)){if(existing)Remove(at);continue;}
            if(!available){if(existing)Release(host,at);continue;}
            State wanted=Desired(target.color,int(radius));
            Entry entry=existing?entries[at]:Entry{target,offset,current,{}};
            if(existing)Observe(entry,current);
            // Still observe live ownership and server changes on every update.
            // Stable targets need no write-side validation, but newly adopted
            // targets always need native registration even if values match.
            if((!existing||!StateEquals(current,wanted))&&!host.Write(target,offset,wanted,!existing)){if(existing)Release(host,at);continue;}
            entry.target=target;entry.offset=offset;entry.written=wanted;
            if(!existing)at=count++;
            entries[at]=entry;
        }
    }
};
}
