#pragma once
// Discovery and rendering only. Fixed storage, no route or trace callbacks.
static Candidate published[2048];
static unsigned scanAt,highest,phase,publishedCount;
// Entries only retain copied display data. Inspect re-resolves every live entity;
// no cached entity/class/function pointer is dereferenced across callbacks.
static unsigned short trackedSlot[2048],refreshIndices[2048];
static unsigned refreshAt,refreshCount,nextRefresh,nextDiscovery;
// Refresh scheduling is still bounded by the existing 16-item work slice, but
// cached items outside the active range are checked less often.  The buffer
// keeps items just beyond the HUD range warm while the two-second discovery
// pass remains responsible for finding newly created entities.
static unsigned refreshLastAt[2048];
static constexpr unsigned NearRefreshPauseMs=250,FarRefreshPauseMs=1000;
static constexpr float RefreshBufferUnits=5.f*39.3701f;
L4N_COUNTERS(static unsigned aggregatePasses;)
static bool discoveryReady,refreshFirst;
static constexpr unsigned DiscoveryPauseMs=2000,RefreshPauseMs=250,WorkBudgetUs=250;
L4N_COUNTERS(static unsigned discoveryPasses,refreshPasses,discoveryIndices,refreshChecks;)
static float range;
static unsigned lastUiPaint;static int paintReason;
struct Row {unsigned count;float distance;Vec point;bool unlimited;unsigned nearest;};
static Row rows[unsigned(items::Label::Count)];static unsigned totalVisible;
static Vec aggregatePosition;static float aggregateRange;static bool aggregateValid,aggregateDirty=true;
static bool SameAggregatePosition(Vec a,Vec b){return a.x==b.x&&a.y==b.y&&a.z==b.z;}
static int metadataMode=-1;
static void ResetWork(){phase=scanAt=refreshAt=refreshCount=nextRefresh=nextDiscovery=0;discoveryReady=refreshFirst=false;memset(refreshLastAt,0,sizeof refreshLastAt);}
// A changed filter requests a new discovery pass without discarding targets
// still needed by the other display or interrupting the refresh due list.
static void RequestDiscovery(unsigned now){phase=0;nextDiscovery=now;}
static void ResetDisplay(){ReleaseClientGlow();if(publishedCount)memset(trackedSlot,0,sizeof trackedSlot);memset(rows,0,sizeof rows);for(auto& d:displayedDistances)d={};ResetDirection();totalVisible=publishedCount=0;aggregateValid=false;aggregateDirty=true;ResetWork();}
static bool DisplayItem(unsigned id){return id<unsigned(items::Label::Count)&&options::Enabled(items::Label(id))&&(layout::active||rows[id].count);}
static void SetActiveSource(const RadarSource& next,unsigned now){
    if(activeSource.object!=next.object||activeSource.index!=next.index||activeSource.roaming!=next.roaming||activeSource.spectating!=next.spectating){ResetDisplay();}
    activeSource=next;activeSourceAt=now;viewOrigin=next.position;
}
static map_supply::Parser supplyParser;
static void CloseSupplyMap(){supplyParser.Cancel();if(supplyFile&&filesystem)VCall<void(__thiscall*)(void*,void*)>(filesystem,3)(filesystem,supplyFile);supplyFile=nullptr;supplyBytes.Clear();supplyRead=0;supplyHints.Clear();}
static void ClearMap(){ResetDisplay();scan_profile::Reset();propertyCount=0;CloseSupplyMap();mapName[0]=0;metadataMode=-1;}
static void OpenSupplyMap(const char* path){
    
    if(!filesystem||!MethodOK(filesystem,4)||!MethodOK(filesystem,5))return;
    auto file=VCall<void*(__thiscall*)(void*,const char*,const char*,const char*)>(filesystem,2)(filesystem,path,"rb","GAME");if(!file)return;
    unsigned bytes=VCall<unsigned(__thiscall*)(void*,void*)>(filesystem,7)(filesystem,file);unsigned char header[1036]{};
    int got=VCall<int(__thiscall*)(void*,void*,int,void*)>(filesystem,0)(filesystem,header,sizeof header,file);
    bool valid=bytes>=sizeof header&&got==sizeof header&&*(unsigned*)header==0x50534256u&&(*(unsigned*)(header+4)==20||*(unsigned*)(header+4)==21);
    int offset=*(int*)(header+8),length=*(int*)(header+12);if(offset<int(sizeof header)){offset=*(int*)(header+12);length=*(int*)(header+16);}
    valid=valid&&offset>=int(sizeof header)&&length>0&&unsigned(length)<=map_supply::MaxBytes&&unsigned(offset)<=bytes&&unsigned(length)<=bytes-unsigned(offset)&&!*(unsigned*)(header+20);
    if(valid&&supplyBytes.Allocate(unsigned(length))){VCall<void(__thiscall*)(void*,void*,int,int)>(filesystem,4)(filesystem,file,offset,0);valid=VCall<unsigned(__thiscall*)(void*,void*)>(filesystem,5)(filesystem,file)==unsigned(offset);if(valid){supplyFile=file;supplyRead=0;return;}}
    VCall<void(__thiscall*)(void*,void*)>(filesystem,3)(filesystem,file);supplyBytes.Clear();
}
static void SyncMetadata(){
    int mode=(options::values[options::MapMetadata]?1:0)|(options::values[options::Safehouse]?2:0);if(metadataMode==mode)return;metadataMode=mode;
    CloseSupplyMap();ResetDisplay();
    if(!mode||!mapName[0])return;char path[256];unsigned n=TextLength(mapName),at=0;
    if(!(n>5&&mapName[0]=='m'&&mapName[1]=='a'&&mapName[2]=='p'&&mapName[3]=='s'&&mapName[4]=='/')){CopyText(path,sizeof path,"maps/");at=5;}
    unsigned length=n;if(n>=4&&Same(mapName+n-4,".bsp"))length-=4;if(at+length+5>=sizeof path)return;
    for(unsigned i=0;i<length;++i)path[at++]=mapName[i];CopyText(path+at,sizeof(path)-at,".bsp");OpenSupplyMap(path);
}
static void StartMap(const char* name){
    ClearMap();if(!CopySafe(mapName,sizeof mapName,name))return;
    for(unsigned i=0;mapName[i];++i){if(mapName[i]=='\\')mapName[i]='/';if(mapName[i]==':'||(mapName[i]=='.'&&mapName[i+1]=='.')){mapName[0]=0;return;}}
    if(options::AnyTracked())SyncMetadata();else if(!options::values[options::MapMetadata])metadataMode=0;
}
static void ReadSupplyMap(){
    if(!supplyFile&&!supplyParser.Active())return;
    
    if(supplyFile){
        unsigned size=supplyBytes.size-supplyRead;if(size>64*1024)size=64*1024;
        int got=VCall<int(__thiscall*)(void*,void*,int,void*)>(filesystem,0)(filesystem,supplyBytes.data+supplyRead,int(size),supplyFile);
        if(got<=0||unsigned(got)>size){CloseSupplyMap();return;}
        supplyRead+=unsigned(got);if(supplyRead<supplyBytes.size)return;
        VCall<void(__thiscall*)(void*,void*)>(filesystem,3)(filesystem,supplyFile);supplyFile=nullptr;
        if(!supplyParser.Begin(supplyHints,supplyBytes.data,supplyBytes.size,options::values[options::MapMetadata]!=0)){CloseSupplyMap();return;}
    }
    if(!supplyParser.Step())return;
    bool parsed=supplyHints.loaded;if(parsed){supplyHints.checkpoint.Resolve(mapName);}supplyParser.Cancel();supplyBytes.Clear();
    
    ResetDisplay();
}
static void Aggregate(Vec player){
    
    L4N_OBSERVE(++aggregatePasses);
    unsigned oldNearest[unsigned(items::Label::Count)];for(unsigned id=0;id<unsigned(items::Label::Count);++id)oldNearest[id]=rows[id].nearest;
    memset(rows,0,sizeof rows);totalVisible=0;
    // Positions come from the bounded survey. No per-frame entity/property or
    // model lookup for each HUD icon; only camera/local position is live.
    for(unsigned i=0;i<publishedCount;++i){auto& c=published[i];c.direct=Distance(player,c.position);
        if(!c.valid||c.direct>range||!options::values[options::Enable]||!options::Enabled(c.label))continue;auto& r=rows[unsigned(c.label)];
        if(!r.count||c.direct<r.distance){r.distance=c.direct;r.point=c.position;r.nearest=i+1;}++r.count;r.unlimited=r.unlimited||c.unlimited;++totalVisible;}
    if(options::values[options::Enable]&&options::values[options::Safehouse]&&supplyHints.loaded&&supplyHints.checkpoint.valid){auto& r=rows[unsigned(items::Label::Safehouse)];r={1,Distance(player,supplyHints.checkpoint.point),supplyHints.checkpoint.point,false,0};++totalVisible;}
    const float margin=.75f*39.3701f;
    for(unsigned id=1;id<unsigned(items::Label::Count);++id){auto& r=rows[id];unsigned at=oldNearest[id];if(r.count&&at&&at<=publishedCount){const auto& c=published[at-1];if(c.valid&&unsigned(c.label)==id&&c.direct<=range&&c.direct<=r.distance+margin){r.distance=c.direct;r.point=c.position;r.nearest=at;}}}
    aggregatePosition=player;aggregateRange=range;aggregateValid=true;aggregateDirty=false;
}
// Reuse copied distances only while both the source and display inputs are
// unchanged. Discovery/refresh scheduling and live entity validation still run.
static void AggregateIfNeeded(Vec player){if(!aggregateValid||aggregateDirty||range!=aggregateRange||!SameAggregatePosition(player,aggregatePosition))Aggregate(player);}
// Dense display storage, with an index-to-slot map. Removing a picked/destroyed
// item repairs the moved entry's slot and nearest-item hysteresis references.
static void StoreTracked(unsigned index,const Candidate* live){
    unsigned slot=trackedSlot[index];
    if(live){
        if(!slot){if(publishedCount>=2048)return;slot=++publishedCount;trackedSlot[index]=(unsigned short)slot;aggregateDirty=true;published[slot-1]=*live;return;}
        auto& old=published[slot-1];float direct=old.direct;
        if(old.index!=live->index||old.serialKey!=live->serialKey||old.label!=live->label||old.valid!=live->valid||
           old.unlimited!=live->unlimited||!SameAggregatePosition(old.position,live->position))aggregateDirty=true;
        // Keep newly resolved identity metadata, but do not discard the cached
        // distance just because Inspect initializes a fresh candidate to zero.
        old=*live;old.direct=direct;return;
    }
    if(!slot)return;
    unsigned last=publishedCount;
    for(auto& row:rows){if(row.nearest==slot)row.nearest=0;else if(row.nearest==last)row.nearest=slot;}
    if(slot!=last){published[slot-1]=published[last-1];trackedSlot[published[slot-1].index]=(unsigned short)slot;}
    trackedSlot[index]=0;refreshLastAt[index]=0;--publishedCount;aggregateDirty=true;
}
static void Publish(unsigned now){
    
    L4N_OBSERVE(++discoveryPasses);
    if(!discoveryReady)nextRefresh=now;
    discoveryReady=true;phase=0;nextDiscovery=now+DiscoveryPauseMs;
}
// Each pass runs incrementally under one shared soft budget. Alternating which
// pass goes first prevents either discovery or refresh from starving the other.
static bool RefreshTracked(unsigned now,const budget_clock::Budget& budget){
    bool changed=false;
    unsigned stop=refreshAt+16;if(stop>refreshCount)stop=refreshCount;
    while(refreshAt<stop){
        unsigned index=refreshIndices[refreshAt++];
        if(trackedSlot[index]){
            L4N_OBSERVE(++refreshChecks);Candidate live{};
            bool valid=Inspect(int(index),live);refreshLastAt[index]=now;StoreTracked(index,valid?&live:nullptr);changed=true;
        }
        if(budget.Expired())break;
    }
    if(refreshAt==refreshCount){refreshAt=refreshCount=0;nextRefresh=now+RefreshPauseMs;L4N_OBSERVE(++refreshPasses);}
    return changed;
}
static bool DiscoverTracked(unsigned now,Vec player,const budget_clock::Budget& budget){
    bool changed=false;
    unsigned stop=scanAt+96;if(stop>highest+1)stop=highest+1;
    while(scanAt<stop){
        unsigned index=scanAt++;L4N_OBSERVE(++discoveryIndices);
        if(!trackedSlot[index]){
            Candidate live{};
            if(Inspect(int(index),live)){
                
                
                
                StoreTracked(index,&live);refreshLastAt[index]=now;changed=true;
            }
        }
        if(budget.Expired())break;
    }
    if(scanAt>highest){Publish(now);changed=true;}
    return changed;
}
static bool Work(unsigned now,Vec player,void*){
    range=float(options::values[options::Range])*39.3701f;
    if(!phase&&(!discoveryReady||(int)(now-nextDiscovery)>=0)){
        scanAt=1;
        highest=unsigned(Limit(VCall<int(__thiscall*)(void*)>(entities,6)(entities),0,2047));
        phase=1;
    }
    if(discoveryReady&&!refreshCount&&(int)(now-nextRefresh)>=0){
        refreshAt=0;refreshCount=0;
        // Build a due list every near tick.  Items in the active HUD range
        // (plus a small buffer) use the 250ms cadence; distant cached items
        // are admitted once per second.  Discovery remains independent.
        float nearRange=range+RefreshBufferUnits;
        // Cheap squared comparison uses the current source position even if
        // it teleported since the previous Aggregate. The selected target is
        // always fast until the next Aggregate chooses a replacement.
        for(unsigned i=0;i<publishedCount;++i){const auto& c=published[i];unsigned index=unsigned(c.index);if(index>=2048)continue;
            Vec delta=player-c.position;bool target=rows[unsigned(c.label)].nearest==i+1;
            unsigned pause=target||delta.Dot(delta)<=nearRange*nearRange?NearRefreshPauseMs:FarRefreshPauseMs;
            if(now-refreshLastAt[index]>=pause)refreshIndices[refreshCount++]=(unsigned short)index;}
        if(!refreshCount)nextRefresh=now+RefreshPauseMs;
    }
    if(!phase&&!refreshCount){AggregateIfNeeded(player);return false;}
    budget_clock::Budget budget(WorkBudgetUs);bool changed=false;
    bool both=phase&&refreshCount,first=refreshCount&&(!phase||refreshFirst);
    if(both)refreshFirst=!refreshFirst;
    if(first)changed=RefreshTracked(now,budget);else changed=DiscoverTracked(now,player,budget);
    if(both&&!budget.Expired()){
        if(first){if(phase)changed=DiscoverTracked(now,player,budget)||changed;}
        else if(refreshCount)changed=RefreshTracked(now,budget)||changed;
    }
    // Moving/teleporting the source still updates every active timer tick;
    // stationary ticks with unchanged copied supplies reuse the previous rows.
    AggregateIfNeeded(player);return changed;
}

