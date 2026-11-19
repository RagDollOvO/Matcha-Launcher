#include "offline_counters.h"
#include "runtime.h"
#include "safe_string.h"
#include "settings.h"
#include "surface_abi.h"
#include "entity_identity_abi.h"
#include "hud_font_recovery.h"
#include "radar_math.h"
#include "classic_hud_artwork.h"
#include "fireworks_artwork.h"
#include "special_supply_artwork.h"
#include "classic_hud_style.h"
#include "classic_text_alignment.h"
#include "hud_numeric_alignment.h"
#include "direction_arrow_artwork.h"
#include "direction_math.h"
#include "rectangular_hud.h"
#include "b4b_hud_layout.h"
#include "budget_clock.h"
#include "layout.h"
#include "world_origin.h"
#include "camera_origin.h"
#include "map_supply.h"
#include "map_supply_parser.h"
#include "l4n_model_profile.h"
#include "l4p_game_ui.h"
#include "raster_filter.h"
#include "distance_presentation.h"
#include "rounded_panel.h"
#include "hud_digit_font.h"
#include "hud_numeric_font.h"
#include "hud_heart_font.h"
#include "hud_cat_font.h"
#include "client_glow_abi.h"

using radar_nav::Distance;
static HWND window;
static DWORD mainThread;
static L4P_GameUiApiV1 gameUi;
static uint32_t uiToken;
static L4P_LogFn hostLog;
static void* logContext;
static bool sessionAllowed, tracked, radarItems;
static unsigned nextTick, probeAt;
static WCHAR dataDirectory[1024], radarDirectory[1024];
static void *engine,*entities,*surface,*cvars,*filesystem,*modelInfo,*modeVar;
static bool ready,session;
static bool entitySerialReady;
static WCHAR iniPath[1024];static char mapName[240];
static unsigned lastMapCheck,saveAt,layoutSaveAt;
static unsigned settingsSaveFailures,layoutRetryFailures;
static bool saveError;
static map_supply::Map supplyHints;static Blob supplyBytes;static void* supplyFile;static unsigned supplyRead;static bool parentHandleReady;

static HudFontRecovery fontRecovery;static unsigned font;static unsigned fontBank[64],uiFontBank[64],radarFontBank[3][64];
static constexpr unsigned IconCount=unsigned(items::Label::Count),ArrowTexture=IconCount*2,TextureCount=ArrowTexture+1;
static_assert(classic_hud_artwork::Count==items::SpecialFirst&&special_supply_artwork::Count==items::SpecialCount,"HUD artwork mapping mismatch");
static constexpr unsigned FireworksIcon=unsigned(items::Label::Fireworks);
static classic_hud_artwork::Meta ArtworkMeta(unsigned id){
    auto meta=items::IsSpecial(id)?special_supply_artwork::meta[id-items::SpecialFirst]:classic_hud_artwork::meta[id];
    if(id==FireworksIcon)meta.sourceWidth=meta.sourceHeight=fireworks_artwork::Size;
    return meta;
}
static unsigned char* pixels;static int textures[TextureCount];static bool textureDirty=true;
static int textureWidths[TextureCount],textureHeights[TextureCount];static unsigned char resizedPixels[512*256*4];
// The panel artwork is identical for all items. Bound the shared size cache
// by the number of item kinds, so every visible custom size can remain warm.
struct PanelTexture {int texture=0,width=0,height=0;unsigned used=0,checked=0;};
static PanelTexture panelTextures[IconCount];static unsigned renderFrame;
static int frameArrowTexture;static bool frameArrowPrepared,renderStateActive;
L4N_COUNTERS(static unsigned textureUploads,fontCreates,fontResets,rowTextBuilds;)
static Vec viewOrigin;
static bool directionSurfaceReady;
static direction_math::Basis directionBasis;
static direction_math::State directionStates[unsigned(items::Label::Count)];
static void ResetDirection(){directionBasis.Reset();for(auto& state:directionStates)state.Reset();}
static distance_presentation::State displayedDistances[unsigned(items::Label::Count)];
static int gateState=-1;
static void Gate(int state){gateState=state;}
static bool SafeSame(const char* a,const char* b){return safe_string::Equal(a,b);}
static bool CopySafe(char* to,unsigned cap,const char* from){return safe_string::Copy(to,cap,from);}
static bool Profile(const WCHAR* name,unsigned stamp,unsigned size){auto p=(unsigned char*)GetModuleHandleW(name);if(!Readable(p,4096)||*(unsigned short*)p!=0x5a4d)return false;unsigned n=*(unsigned*)(p+60);return n<0xe00&&*(unsigned*)(p+n)==0x4550&&*(unsigned*)(p+n+8)==stamp&&*(unsigned*)(p+n+80)==size;}

struct Property {RecvTable* table;const char* name;int offset;};static Property properties[1024];static unsigned propertyCount;
static int FindOffset(RecvTable* table,const char* name,unsigned depth=0){if(depth>16||!Readable(table,sizeof *table)||table->count<1||table->count>4096||!Readable(table->props,table->count*sizeof(RecvProp)))return -1;for(int i=0;i<table->count;++i){auto& p=table->props[i];if(p.name&&SafeSame(p.name,name))return p.offset;}for(int i=0;i<table->count;++i){auto& p=table->props[i];if(p.type==6&&p.table){int o=FindOffset(p.table,name,depth+1);if(o>=0&&p.offset>=0&&p.offset<65536-o)return o+p.offset;}}return -1;}
static int TableOffset(RecvTable* table,const char* name){for(unsigned i=0;i<propertyCount;++i)if(properties[i].table==table&&Same(properties[i].name,name))return properties[i].offset;int off=FindOffset(table,name);if(propertyCount<1024)properties[propertyCount++]={table,name,off};return off;}
static int Offset(ClientClass* cls,const char* name){return Readable(cls,sizeof *cls)?TableOffset(cls->table,name):-1;}
// Class() validates the descriptor for this inspection. Capture its table once;
// keep range/readability checks on every actual entity field, with no lifetime cache.
template<class T>static bool ReadTable(void* entity,RecvTable* table,const char* name,T& value){int off=TableOffset(table,name);if(!entity||off<0||unsigned(off)>65536-sizeof(T)||!Readable((char*)entity+off,sizeof(T)))return false;value=*(T*)((char*)entity+off);return true;}
template<class T>static bool Read(void* entity,ClientClass* cls,const char* name,T& value){int off=Offset(cls,name);if(!entity||off<0||unsigned(off)>65536-sizeof(T)||!Readable((char*)entity+off,sizeof(T)))return false;value=*(T*)((char*)entity+off);return true;}
static void* Entity(int index){return VCall<void*(__thiscall*)(void*,int)>(entities,3)(entities,index);}
static ClientClass* Class(int index,bool& dormant){
    void* net=VCall<void*(__thiscall*)(void*,int)>(entities,0)(entities,index);
    if(!Readable(net,sizeof(void*)))return nullptr;
    auto methods=*(void***)net;
    // One checked span covers both slots; never cache a network object's vtable.
    if(!Readable(methods,8*sizeof(void*)))return nullptr;
    auto classMethod=methods[1],dormantMethod=methods[7];
    if(!Executable(classMethod)||!Executable(dormantMethod))return nullptr;
    dormant=((bool(__thiscall*)(void*))dormantMethod)(net);if(dormant)return nullptr;
    auto cls=((ClientClass*(__thiscall*)(void*))classMethod)(net);
    return Readable(cls,sizeof *cls)?cls:nullptr;
}
#include "scan_profile.h"
static client_glow::Native clientGlowNative;
static client_glow::Controller clientGlowController;
struct ClientGlowHost {
    bool Read(const client_glow::Target& target,int& offset,client_glow::State& state,bool& available){
        available=false;
        if(!entitySerialReady||!target.key||target.index<1||target.index>=2048)return false;
        void* object=Entity(int(target.index));
        if(!object||EntitySerialKey(entities,int(target.index),object)!=target.key)return false;
        bool dormant=false;auto cls=Class(int(target.index),dormant);
        auto table=cls?cls->table:nullptr;
        if(offset<0){
            if(!cls)return false;int type=TableOffset(table,"m_iGlowType");if(type<4)return false;offset=type-4;
            if(!client_glow::Native::Layout(type,TableOffset(table,"m_nGlowRange"),TableOffset(table,"m_nGlowRangeMin"),
                TableOffset(table,"m_glowColorOverride"),TableOffset(table,"m_bFlashing")))return false;
        }
        auto block=clientGlowNative.Property(object,offset);if(!block)return false;
        state=client_glow::Native::Capture(*block);
        if(cls&&!dormant){
            // Reuse a checked region only within this read. Every field keeps
            // its own offset, length and overflow checks; write guards stay live.
            scan_profile::Reader reader{object};
            unsigned owner=~0u,weaponOwner=~0u;int effects=32;
            bool valid=reader.Read(table,"m_hOwnerEntity",owner)&&reader.Read(table,"m_fEffects",effects);
            reader.Read(table,"m_hOwner",weaponOwner);
            available=valid&&(owner==0||owner==~0u)&&(weaponOwner==0||weaponOwner==~0u)&&!(effects&32);
            if(available&&target.label==32){int skin=0;if(reader.Read(table,"m_nSkin",skin)&&skin>0)available=false;}
        }
        return true;
    }
    bool Write(const client_glow::Target& target,int offset,const client_glow::State& value,bool forceType){
        void* object=Entity(int(target.index));
        if(!object||EntitySerialKey(entities,int(target.index),object)!=target.key)return false;
        auto block=clientGlowNative.Property(object,offset);
        return block&&clientGlowNative.Set(*block,value,forceType);
    }
};
static ClientGlowHost clientGlowHost;
static void ReleaseClientGlow(){if(clientGlowController.count)clientGlowController.Stop(clientGlowHost);else clientGlowController.scheduled=false;}
struct RadarSource {Vec position{};void* object=nullptr;int index=0;bool spectating=false,roaming=false;};
static RadarSource activeSource;static unsigned activeSourceAt;
static bool ValidSurvivor(int index,RadarSource& result,bool spectating){
    if(index<1||index>64)return false;
    bool dormant=false;auto cls=Class(index,dormant);void* entity=Entity(index);
    int team=0;unsigned char life=1;Vec p{};
    if(!cls||dormant||!entity||!Read(entity,cls,"m_iTeamNum",team)||team!=2||
       !Read(entity,cls,"m_lifeState",life)||life||
       !WorldPosition(entity,p)||!radar_nav::Position(p))return false;
    result={p,entity,index,spectating};return true;
}
static bool Player(RadarSource& result){
    int index=VCall<int(__thiscall*)(void*)>(engine,12)(engine);
    if(index<1||index>64)return false;
    if(ValidSurvivor(index,result,false))return true;
    if(!options::values[options::Spectator])return false;
    bool dormant=false;auto cls=Class(index,dormant);void* local=Entity(index);
    if(!cls||dormant||!local)return false;
    int mode=0;unsigned target=~0u;
    if(!Read(local,cls,"m_iObserverMode",mode))return false;
    if(mode==6){int team=0;unsigned char life=0;Vec camera{};
        if(!Read(local,cls,"m_iTeamNum",team)||!Read(local,cls,"m_lifeState",life)||
           !(team==1||(team==2&&life!=0))||!camera_origin::Read(engine,camera))return false;
        result={camera,local,index,true,true};return true;
    }
    // Source OBS_MODE_IN_EYE (4), OBS_MODE_CHASE (5). Both have a
    // survivor navigation origin. Free roaming (6) uses the view above.
    if(!parentHandleReady||(mode!=4&&mode!=5)||
       !Read(local,cls,"m_hObserverTarget",target)||target==~0u)return false;
    int targetIndex=int(target&2047u);
    if(targetIndex<1||targetIndex>64)return false;
    void* resolved=VCall<void*(__thiscall*)(void*,unsigned)>(entities,4)(entities,target);
    if(!resolved||Entity(targetIndex)!=resolved)return false; // serial/identity
    return ValidSurvivor(targetIndex,result,true)&&result.object==resolved;
}
static const void* LookupModel(short index){return modelInfo&&items::ValidModel(index)&&index>=-1?VCall<const void*(__thiscall*)(void*,int)>(modelInfo,1)(modelInfo,index):nullptr;}
static bool SupplyModelName(short index,char* copy,unsigned cap){auto model=LookupModel(index);return model&&CopySafe(copy,cap,VCall<const char*(__thiscall*)(void*,const void*)>(modelInfo,3)(modelInfo,model));}
static bool MapIdentity(void* e,ClientClass* cls,unsigned parent,Vec& networkOrigin,char* parentModel){
    if(!options::values[options::MapMetadata]||!supplyHints.loaded||!Read(e,cls,"m_vecOrigin",networkOrigin))return false;parentModel[0]=0;
    if(parent&&parent!=~0u){
        unsigned char attachment=255;if(!parentHandleReady||!modelInfo||!Read(e,cls,"m_iParentAttachment",attachment)||attachment)return false;
        void* object=VCall<void*(__thiscall*)(void*,unsigned)>(entities,4)(entities,parent);unsigned index=parent&4095u;if(!object||!index||index>=2048||Entity(int(index))!=object)return false;
        bool dormant=false;auto pc=Class(int(index),dormant);unsigned grandparent=~0u;short model=0;
        if(!pc||dormant||!Read(object,pc,"moveparent",grandparent)||(grandparent&&grandparent!=~0u)||!Read(object,pc,"m_nModelIndex",model)||!items::ValidModel(model))return false;
        auto m=LookupModel(model);if(!m)return false;auto name=VCall<const char*(__thiscall*)(void*,const void*)>(modelInfo,3)(modelInfo,m);if(!CopySafe(parentModel,32,name)||!map_supply::Brush(parentModel))return false;
    }
    return true;
}
static map_supply::Hint MapHint(void* e,ClientClass* cls,items::Label label,unsigned parent,bool displayOnly=false){Vec p{};char model[32];return MapIdentity(e,cls,parent,p,model)?supplyHints.Find({unsigned(label),p,model},displayOnly):map_supply::Unknown;}
static items::Label MapDisplayLabel(void* e,ClientClass* cls,unsigned parent){Vec p{};char model[32];return MapIdentity(e,cls,parent,p,model)?items::Label(supplyHints.DisplayLabel({0,p,model})):items::Label::None;}
static bool MapUnlimited(void* e,ClientClass* cls,items::Label label,bool spawn,unsigned parent){return spawn&&MapHint(e,cls,label,parent)==map_supply::Unlimited;}
struct Candidate {int index;void* object;ClientClass* cls;items::Label label;Vec position;float direct;bool unlimited,valid;unsigned serialKey;};
#include "scan_inspect.h"
#include "lite_scan.h"
struct CachedGlowItems {
    unsigned Size()const{return publishedCount;}
    bool Get(unsigned index,client_glow::Target& target)const{
        const auto& item=published[index];unsigned label=unsigned(item.label);
        if(!options::GlowActive()||!item.valid||!item.serialKey||label>=IconCount||!options::GlowEnabled(label))return false;
        auto color=ArtworkMeta(label);
        unsigned originalColor=unsigned(color.red)|(unsigned(color.green)<<8)|(unsigned(color.blue)<<16);
        unsigned rgb=client_glow::ScaleColor(options::GlowColor(label,originalColor),options::values[options::GlowBrightness]);
        target={unsigned(item.index),item.serialKey,rgb,item.direct,label};
        return true;
    }
};
static void UpdateClientGlow(unsigned now){
    if(!options::GlowActive()){ReleaseClientGlow();return;}
    clientGlowController.Update(clientGlowHost,CachedGlowItems{},now,options::values[options::GlowRange],unsigned(options::values[options::GlowLimit]));
}

static void Color(int r,int g,int b,int a=255){VCall<void(__thiscall*)(void*,int,int,int,int)>(surface,11)(surface,r,g,b,a);}
static void Rect(int x,int y,int w,int h,int r,int g,int b,int a=220){Color(r,g,b,a);VCall<void(__thiscall*)(void*,int,int,int,int)>(surface,12)(surface,x,y,x+w,y+h);}
static void Text(int x,int y,const WCHAR* text,int r=235,int g=237,int b=240){if(!font)return;VCall<void(__thiscall*)(void*,unsigned)>(surface,17)(surface,font);VCall<void(__thiscall*)(void*,int,int,int,int)>(surface,19)(surface,r,g,b,255);VCall<void(__thiscall*)(void*,int,int)>(surface,20)(surface,x,y);int len=0;while(text[len])++len;VCall<void(__thiscall*)(void*,const WCHAR*,int,int)>(surface,22)(surface,text,len,0);}
static int CachedTexture(unsigned label,const unsigned char* source,int sw,int sh,int w,int h,bool panel=false){
    if(!source||label>=TextureCount||w<1||h<1)return 0;
    int& t=textures[label];int tw=Limit(w,1,512),th=Limit(h,1,256);
    bool valid=t&&VCall<bool(__thiscall*)(void*,int)>(surface,32)(surface,t);
    if(valid&&(textureWidths[label]!=tw||textureHeights[label]!=th)){VCall<bool(__thiscall*)(void*,int)>(surface,33)(surface,t);t=0;valid=false;}
    if(!valid){t=VCall<int(__thiscall*)(void*,bool)>(surface,34)(surface,true);textureWidths[label]=textureHeights[label]=0;}
    if(!t)return 0;
    if(textureWidths[label]!=tw||textureHeights[label]!=th){if(!raster_filter::Resize(source,sw,sh,resizedPixels,tw,th))return 0;if(panel)rounded_panel::Apply(resizedPixels,tw,th);UploadTextureRGBA(surface,t,resizedPixels,tw,th);L4N_OBSERVE(++textureUploads);textureWidths[label]=tw;textureHeights[label]=th;}
    return t;
}
static int CachedPanelTexture(int w,int h){
    if(!pixels||w<1||h<1)return 0;
    int tw=Limit(w,1,512),th=Limit(h,1,256);PanelTexture* chosen=nullptr;
    for(auto& entry:panelTextures)if(entry.texture&&entry.width==tw&&entry.height==th){chosen=&entry;break;}
    if(!chosen){
        for(auto& entry:panelTextures)if(!chosen||!entry.texture||entry.used<chosen->used){chosen=&entry;if(!entry.texture)break;}
        if(chosen->texture&&VCall<bool(__thiscall*)(void*,int)>(surface,32)(surface,chosen->texture))VCall<bool(__thiscall*)(void*,int)>(surface,33)(surface,chosen->texture);
        *chosen={};
    }
    auto& entry=*chosen;entry.used=renderFrame;
    if(entry.texture&&entry.checked==renderFrame)return entry.texture;
    entry.checked=renderFrame;
    if(entry.texture&&!VCall<bool(__thiscall*)(void*,int)>(surface,32)(surface,entry.texture)){entry.texture=0;entry.width=entry.height=0;}
    if(!entry.texture){
        entry.texture=VCall<int(__thiscall*)(void*,bool)>(surface,34)(surface,true);if(!entry.texture)return 0;
        auto source=classic_hud_artwork::meta[0];
        if(!raster_filter::Resize(pixels,source.sourceWidth,source.sourceHeight,resizedPixels,tw,th))return 0;
        rounded_panel::Apply(resizedPixels,tw,th);UploadTextureRGBA(surface,entry.texture,resizedPixels,tw,th);L4N_OBSERVE(++textureUploads);entry.width=tw;entry.height=th;
    }
    return entry.texture;
}
static void Icon(unsigned label,int x,int y,int w,int h,int alpha=255){
    if(!pixels||label>=ArrowTexture||w<1||h<1||!alpha)return;
    int texture=0;
    if(label>=IconCount)texture=CachedPanelTexture(w,h);
    else{
        auto m=ArtworkMeta(label);
        const auto* source=label==FireworksIcon?fireworks_artwork::rgba:items::IsSpecial(label)?special_supply_artwork::rgba[label-items::SpecialFirst]:pixels+label*classic_hud_artwork::Stride;
        texture=CachedTexture(label,source,m.sourceWidth,m.sourceHeight,w,h);
    }
    if(!texture)return;
    Color(255,255,255,alpha);VCall<void(__thiscall*)(void*,int)>(surface,29)(surface,texture);VCall<void(__thiscall*)(void*,int,int,int,int)>(surface,31)(surface,x,y,x+w,y+h);
}
static bool DecodeArtwork(){
    constexpr unsigned size=classic_hud_artwork::Count*classic_hud_artwork::Stride;
    auto decoded=(unsigned char*)HeapAlloc(GetProcessHeap(),0,size);if(!decoded)return false;unsigned at=0;
    bool valid=sizeof classic_hud_artwork::packed%6==0;
    for(unsigned i=0;valid&&i<sizeof classic_hud_artwork::packed;i+=6){auto run=classic_hud_artwork::packed+i;unsigned n=run[0]|(unsigned(run[1])<<8);if(!n||n>(size-at)/4){valid=false;break;}for(unsigned j=0;j<n;++j){for(unsigned c=0;c<4;++c)decoded[at+c]=run[2+c];at+=4;}}
    if(!valid||at!=size){HeapFree(GetProcessHeap(),0,decoded);return false;}pixels=decoded;return true;
}
static void DirectionArrow(layout::Box card,float unit,const direction_math::Result& result,classic_hud_artwork::Meta color){
    if(!directionSurfaceReady||!result.horizontal)return;
    SurfaceVertex vertices[4];if(!rectangular_hud::ArrowQuad(card,b4b_hud::ArrowGap*unit,classic_hud::ArrowHalf*unit,result,vertices))return;
    if(!frameArrowPrepared){frameArrowTexture=CachedTexture(ArrowTexture,direction_arrow_artwork::rgba,32,32,32,32);frameArrowPrepared=true;}
    int texture=frameArrowTexture;if(!texture)return;
    Color(color.red,color.green,color.blue);VCall<void(__thiscall*)(void*,int)>(surface,29)(surface,texture);DrawDirectionQuad(surface,vertices);
}

static const WCHAR* ItemName(unsigned id){static const WCHAR* names[]={L"",L"医疗包",L"电击器",L"止痛药",L"肾上腺素",L"燃烧瓶",L"土制炸弹",L"胆汁",L"弹药堆",L"镭射",L"武器",L"AK47",L"M16",L"军用狙击枪",L"猎枪",L"消音冲锋枪",L"UZI",L"AWP",L"Scout",L"SCAR",L"榴弹发射器",L"M60",L"手枪",L"沙鹰",L"木喷",L"铁喷",L"连喷",L"SPAS",L"MP5",L"SG552",L"近战",L"电锯",L"油桶",L"烟花盒",L"终点安全屋",L"可乐",L"侏儒",L"高爆弹",L"燃烧弹"};static_assert(sizeof(names)/sizeof(names[0])==IconCount,"Editor name mapping");return id<IconCount?names[id]:L"";}
static const char* DigitFamily(){static const char* names[]={"L4N_Radar_Digits","20HUD_Kudo","20HUD_MeowMoe"};return names[options::DigitStyle()];}
static void UseFont(int pixels,bool ui=false,bool radarNumber=false){pixels=Limit(pixels,7,48);auto& handle=ui?uiFontBank[pixels]:radarNumber?radarFontBank[options::DigitStyle()][pixels]:fontBank[pixels];if(!handle){L4N_OBSERVE(++fontCreates);handle=VCall<unsigned(__thiscall*)(void*)>(surface,63)(surface);if(handle){auto set=VCall<bool(__thiscall*)(void*,unsigned,const char*,int,int,int,int,int,int,int)>(surface,64);const char* name=ui?"Microsoft YaHei":radarNumber?DigitFamily():options::fontName;int weight=ui?700:Same(name,"20HUD_Torus_SemiBold")?600:400;int flags=ui?0x10:0x210;if(!set(surface,handle,name,pixels,weight,0,0,flags,0,0xffff))set(surface,handle,ui?"Microsoft YaHei":"Arial",pixels,ui?700:400,0,0,flags,0,0xffff);}}font=handle;}
static const unsigned hudOrder[]={26,27,15,16,28,11,12,19,29,14,13,17,18,20,21,24,25,1,2,3,4,5,6,7,8,9,32,33,34,
    unsigned(items::Label::Cola),unsigned(items::Label::Gnome),unsigned(items::Label::ExplosiveAmmo),unsigned(items::Label::IncendiaryAmmo)};
struct TextExtent {int w=0,h=0;};
struct TextMetric {unsigned font=0,length=0;WCHAR text[16]{};TextExtent size;};
static TextMetric textMetrics[128];
struct FittedText {WCHAR text[16]{};TextExtent size{};unsigned handle=0;int pixels=0,inkLeft=0,inkTop=0,inkWidth=0,inkHeight=0;};
struct RowTextCache {
    bool valid=false,unlimited=false,showCount=false,showHeight=false;
    int meters=0,height=0,high=0,width=0,tall=0,countWidth=0,heightWidth=0,distancePixels=0,sidePixels=0;
    unsigned count=0;int drawCountWidth=0,drawHeightWidth=0,cardWidth=0,cardHeight=0;FittedText distance,quantity,elevation;
};
static RowTextCache rowTextCaches[3][IconCount];
static TextExtent MeasureText(const WCHAR* text){
    TextExtent size{};if(!font)return size;
    unsigned length=0,hash=font*2654435761u;
    for(;length<15&&text[length];++length)hash=(hash^unsigned(text[length]))*16777619u;
    bool cacheable=!text[length];auto& cached=textMetrics[hash&127u];
    if(cacheable&&cached.font==font&&cached.length==length){unsigned i=0;for(;i<length&&cached.text[i]==text[i];++i){}if(i==length)return cached.size;}
    VCall<void(__thiscall*)(void*,unsigned,const WCHAR*,int&,int&)>(surface,72)(surface,font,text,size.w,size.h);
    size.w=Limit(size.w,0,4096);size.h=Limit(size.h,0,128);
    if(cacheable){cached.font=font;cached.length=length;cached.size=size;for(unsigned i=0;i<=length;++i)cached.text[i]=text[i];}
    return size;
}
static void FitTextLine(FittedText& text,int pixels,int width,bool radarNumber=false){
    pixels=radarNumber?hud_numeric_text::PreferredPixels(options::DigitStyle(),text.text,pixels):Limit(pixels,7,48);UseFont(pixels,false,radarNumber);auto size=MeasureText(text.text);
    while(size.w>width&&pixels>7){UseFont(--pixels,false,radarNumber);size=MeasureText(text.text);}
    text.size=size;text.handle=font;text.pixels=pixels;
    text.inkLeft=text.inkTop=0;text.inkWidth=size.w;text.inkHeight=size.h;
    if(!radarNumber&&Same(options::fontName,"20HUD_Torus_SemiBold"))classic_text::Bounds(text.text,pixels,size.w,size.h,text.inkLeft,text.inkTop,text.inkWidth,text.inkHeight);
    else if(radarNumber)hud_numeric_text::Bounds(options::DigitStyle(),text.text,pixels,size.w,size.h,text.inkLeft,text.inkTop,text.inkWidth,text.inkHeight);
    // The one-pixel native outline is symmetric around the visible fill.
    --text.inkLeft;--text.inkTop;text.inkWidth+=2;text.inkHeight+=2;
}
static RowTextCache& PrepareRowText(unsigned id,int meters,unsigned count,bool unlimited,int height,int high,int wide,int tall,int countWidth,int heightWidth,int distancePixels,int sidePixels){
    auto& cache=rowTextCaches[options::DigitStyle()][id];bool showCount=id!=34&&options::values[options::ShowCount]!=0,showHeight=options::values[options::Height]!=0&&height!=0;
    if(!showCount){count=0;unlimited=false;}if(!showHeight){height=0;high=0;}
    if(cache.valid&&cache.meters==meters&&cache.count==count&&cache.unlimited==unlimited&&cache.height==height&&cache.high==high&&cache.width==wide&&cache.tall==tall&&cache.countWidth==countWidth&&cache.heightWidth==heightWidth&&cache.distancePixels==distancePixels&&cache.sidePixels==sidePixels&&cache.showCount==showCount&&cache.showHeight==showHeight)return cache;
    L4N_OBSERVE(++rowTextBuilds);cache={};cache.valid=true;cache.meters=meters;cache.count=count;cache.unlimited=unlimited;cache.height=height;cache.high=high;cache.width=wide;cache.tall=tall;cache.countWidth=countWidth;cache.heightWidth=heightWidth;cache.distancePixels=distancePixels;cache.sidePixels=sidePixels;cache.showCount=showCount;cache.showHeight=showHeight;
    wsprintfW(cache.distance.text,L"%d",meters);FitTextLine(cache.distance,distancePixels,wide-countWidth-heightWidth,true);
    if(showCount){if(unlimited)WideCopy(cache.quantity.text,16,L"INF");else wsprintfW(cache.quantity.text,L"%ux",count);FitTextLine(cache.quantity,sidePixels,countWidth-2);}
    if(showHeight){wsprintfW(cache.elevation.text,height>0?L"+%dm":L"-%dm",high);FitTextLine(cache.elevation,sidePixels,heightWidth-2);}
    // Preserve normal positions. Only a side string that cannot fit even at
    // seven pixels receives more room; never truncate counts or signed height.
    cache.drawCountWidth=countWidth;cache.drawHeightWidth=heightWidth;
    if(showCount&&cache.quantity.size.w+2>countWidth)cache.drawCountWidth=cache.quantity.size.w+2;
    if(showHeight&&cache.elevation.size.w+2>heightWidth)cache.drawHeightWidth=cache.elevation.size.w+2;
    // The icon and distance share the card centre even when the two side
    // strings differ in length or only one side is visible.
    int side=cache.drawCountWidth>cache.drawHeightWidth?cache.drawCountWidth:cache.drawHeightWidth;
    cache.drawCountWidth=cache.drawHeightWidth=side;
    int center=wide-cache.drawCountWidth-cache.drawHeightWidth;
    if(cache.distance.size.w>center)FitTextLine(cache.distance,distancePixels,center,true);
    int minimum=cache.drawCountWidth+cache.drawHeightWidth+cache.distance.size.w;
    cache.cardWidth=wide>minimum?wide:minimum;
    // Only visible glyph ink can overflow the card. Decorative fonts may have
    // generous blank ascender space that must not enlarge the panel or grid.
    int textHeight=cache.distance.inkHeight;
    if(showCount&&cache.quantity.inkHeight>textHeight)textHeight=cache.quantity.inkHeight;
    if(showHeight&&cache.elevation.inkHeight>textHeight)textHeight=cache.elevation.inkHeight;
    cache.cardHeight=tall>textHeight?tall:textHeight;
    cache.valid=cache.distance.handle&&(!showCount||cache.quantity.handle)&&(!showHeight||cache.elevation.handle);
    return cache;
}
static void DrawTextLine(int x,int y,const FittedText& text,int r=255,int g=255,int b=255){font=text.handle;Text(x,y,text.text,r,g,b);}
static void DrawCenteredText(layout::Box area,const FittedText& text,int r,int g,int b,int adjustX=0,int adjustY=0){
    DrawTextLine(area.x+(area.w-text.inkWidth)/2-text.inkLeft+adjustX,area.y+(area.h-text.inkHeight)/2-text.inkTop+adjustY,text,r,g,b);
}
static void ResetRenderPresentation(){
    if(!renderStateActive)return;
    for(auto& distance:displayedDistances)distance={};ResetDirection();
    memset(layout::visualBoxes,0,sizeof layout::visualBoxes);memset(layout::alignmentBoxes,0,sizeof layout::alignmentBoxes);renderStateActive=false;
}
// Editor instructions use screen scale, independently of individual radar sizes.
static void EditorPanel(int x,int y,int width,int height,int radius){
    radius=Limit(radius,1,height/2);
    Rect(x,y+radius,width,height-2*radius,19,31,36,248);
    for(int row=0;row<radius;++row){
        int inset=0,vertical=radius-row-1;
        while(inset<radius&&(radius-inset)*(radius-inset)+vertical*vertical>radius*radius)++inset;
        Rect(x+inset,y+row,width-2*inset,1,19,31,36,248);
        Rect(x+inset,y+height-row-1,width-2*inset,1,19,31,36,248);
    }
}
static void EditorFooter(int width,int height){
    float scale=float(height)/720.f,fit=float(width)/1280.f;if(scale>fit)scale=fit;
    if(scale<.8f)scale=.8f;if(scale>2.f)scale=2.f;
    int panelWidth=Limit(int(640*scale+.5f),400,width-32),pad=int(18*scale+.5f),gap=int(10*scale+.5f);
    int textWidth=panelWidth-2*pad,headingPixels=Limit(int(24*scale+.5f),20,48),bodyPixels=Limit(int(18*scale+.5f),16,36);
    WCHAR title[80];wsprintfW(title,L"位置调节  %s  %d%%",ItemName(layout::selected),layout::items[layout::selected].scale);
    UseFont(headingPixels,true);auto heading=MeasureText(title);
    while(heading.w>textWidth&&headingPixels>18){UseFont(--headingPixels,true);heading=MeasureText(title);}
    const WCHAR* lines[]={L"方向键 移动   Shift 快移   + / - 缩放",L"自动对齐   Alt 自由移动",L"Enter 保存   Esc 撤销   R 重置"};
    int bodyHeight=0;
    for(;;){UseFont(bodyPixels,true);bool fits=true;bodyHeight=0;for(auto line:lines){auto size=MeasureText(line);if(size.w>textWidth)fits=false;if(size.h>bodyHeight)bodyHeight=size.h;}if(fits||bodyPixels<=14)break;--bodyPixels;}
    int lineHeight=bodyHeight+int(10*scale+.5f),panelHeight=2*pad+heading.h+gap+3*lineHeight;
    int x=(width-panelWidth)/2,y=height-panelHeight-int(16*scale+.5f);
    auto selected=layout::visualBoxes[layout::selected];if(selected.w&&selected.h&&x<selected.x+selected.w+2&&x+panelWidth>selected.x-2&&y<selected.y+selected.h+2&&y+panelHeight>selected.y-2)y=int(16*scale+.5f);
    EditorPanel(x,y,panelWidth,panelHeight,Limit(int(10*scale+.5f),8,20));
    UseFont(headingPixels,true);Text(x+pad,y+pad,title,169,244,214);
    UseFont(bodyPixels,true);for(unsigned i=0;i<3;++i)Text(x+pad,y+pad+heading.h+gap+int(i)*lineHeight,lines[i],i==2?174:239,i==2?235:243,i==2?211:245);
}
static unsigned DisplayCount(const Row& r){return layout::active?1:r.unlimited?99:r.count;}
static unsigned DisplayKey(unsigned id){
    auto& row=rows[id];unsigned key=id;
    if(row.nearest&&row.nearest<=publishedCount){const auto& c=published[row.nearest-1];key=c.serialKey?c.serialKey:unsigned(c.object)^(unsigned(c.index)<<2);}
    return key;
}
static int DisplayDistance(unsigned id,Vec& point,unsigned now){
    point=rows[id].point;return displayedDistances[id].Update(Distance(viewOrigin,point)/39.3701f,DisplayKey(id),now);
}
static void DrawAdjustmentFrame(layout::Box box){
    Rect(box.x,box.y,box.w,1,79,219,166,255);Rect(box.x,box.y+box.h-1,box.w,1,79,219,166,255);
    Rect(box.x,box.y,1,box.h,79,219,166,255);Rect(box.x+box.w-1,box.y,1,box.h,79,219,166,255);
}
static void DrawAlignmentGuide(){
    if(!layout::GuideValid())return;
    const auto& selected=layout::alignmentBoxes[layout::selected];
    const auto& target=layout::alignmentBoxes[layout::snapGuide.target];
    constexpr int padding=6;
    if(layout::snapGuide.axisX){
        int top=Limit((selected.y<target.y?selected.y:target.y)-padding,2,layout::height-2);
        int bottom=Limit((selected.y+selected.h>target.y+target.h?selected.y+selected.h:target.y+target.h)+padding,2,layout::height-2);
        Rect(layout::snapGuide.coordinate,top,1,bottom-top,79,219,166,190);
    }else{
        int left=Limit((selected.x<target.x?selected.x:target.x)-padding,2,layout::width-2);
        int right=Limit((selected.x+selected.w>target.x+target.w?selected.x+selected.w:target.x+target.w)+padding,2,layout::width-2);
        Rect(left,layout::snapGuide.coordinate,right-left,1,79,219,166,190);
    }
}
static void Draw(){
    
    int w=0,h=0;VCall<void(__thiscall*)(void*,int&,int&)>(engine,5)(engine,w,h);if(w<640||h<400||w>16384||h>16384){paintReason=5;return;}
    if(gameUi.begin_draw()!=L4P_OK){paintReason=6;return;}
    if(!pixels&&!DecodeArtwork())return;
    bool autoSpecial=false;for(unsigned id=items::SpecialFirst;id<IconCount&&!autoSpecial;++id)autoSpecial=options::Enabled(items::Label(id))&&!layout::items[id].custom;
    layout::width=w;layout::height=h;float s=b4b_hud::Scale(w,h);
    const auto extraSupplyRow=autoSpecial?b4b_hud::ExtraSupplyRow(w,h,s):b4b_hud::SupplyRow{};
    const int iconAlpha=(options::values[options::IconOpacity]*255+50)/100;
    if(layout::active)memset(layout::alignmentBoxes,0,sizeof layout::alignmentBoxes);
    if(fontRecovery.Frame(window,w,h,GetWindowLongW(window,-16),GetWindowLongW(window,-20),GetTickCount())||(font&&VCall<int(__thiscall*)(void*,unsigned)>(surface,66)(surface,font)==0)){L4N_OBSERVE(++fontResets);font=0;memset(fontBank,0,sizeof fontBank);memset(radarFontBank,0,sizeof radarFontBank);memset(uiFontBank,0,sizeof uiFontBank);memset(textMetrics,0,sizeof textMetrics);memset(rowTextCaches,0,sizeof rowTextCaches);}
    float alpha=VCall<float(__thiscall*)(void*)>(surface,106)(surface);VCall<void(__thiscall*)(void*,float)>(surface,105)(surface,float(options::values[options::WeaponIconOpacity])/100.f);
    if(textureDirty){memset(textureWidths,0,sizeof textureWidths);memset(textureHeights,0,sizeof textureHeights);for(auto& entry:panelTextures){if(entry.texture&&VCall<bool(__thiscall*)(void*,int)>(surface,32)(surface,entry.texture))VCall<bool(__thiscall*)(void*,int)>(surface,33)(surface,entry.texture);entry={};}textureDirty=false;}
    if(++renderFrame==0){renderFrame=1;for(auto& entry:panelTextures)entry.used=entry.checked=0;}
    frameArrowPrepared=false;frameArrowTexture=0;renderStateActive=true;
    unsigned now=GetTickCount();
    struct PreparedRow {bool visible=false,extraSupply=false;layout::Box box;int mx=0,my=0,iconWidth=0,iconHeight=0,group=0,column=0,row=0;float unit=0;direction_math::Result direction{};};
    PreparedRow prepared[IconCount]{};
    int columnExtra[2][b4b_hud::SmallColumns]{},rowExtra[2][18]{};
    for(unsigned id:hudOrder){
        if(!DisplayItem(id)){displayedDistances[id]={};directionStates[id].Reset();layout::visualBoxes[id]={};continue;}
        auto automatic=b4b_hud::Cell(id,h,s);if(!automatic.w||!automatic.h)continue;
        bool extraSupply=extraSupplyRow.y&&items::IsSpecial(id)&&!layout::items[id].custom;
        if(extraSupply){automatic.x=extraSupplyRow.x[id-items::SpecialFirst];automatic.y=extraSupplyRow.y;}
        auto box=layout::Place(id,automatic);bool weapon=id>=11&&id<32;
        float sx=float(box.w)/(weapon?b4b_hud::WeaponPitch:b4b_hud::SmallPitch),sy=float(box.h)/b4b_hud::RowPitch;
        float unit=sx<sy?sx:sy;int mx=int(b4b_hud::Margin*sx+.5f),my=int(b4b_hud::Margin*sy+.5f);
        int arrowMargin=rectangular_hud::Margin(classic_hud::ArrowHalf*unit,b4b_hud::ArrowGap*unit);
        if(mx<arrowMargin)mx=arrowMargin;if(my<arrowMargin)my=arrowMargin;
        layout::Box card{box.x+mx,box.y+my,int(classic_hud::PanelWidth(id)*sx+.5f),int(classic_hud::PanelHeight*sy+.5f)};
        int countWidth=Limit(int((weapon?12.f:8.f)*sx+.5f),1,card.w/3),heightWidth=Limit(int(12.f*sx+.5f),1,card.w/3);
        if(id==34)countWidth=heightWidth=Limit(int(14.f*sx+.5f),1,card.w/2-1);
        int baseIconWidth=0,baseIconHeight=0;classic_hud::IconSize(id,sx,sy,baseIconWidth,baseIconHeight);
        // Resolve the final aspect fit before centring, avoiding two separate
        // integer roundings that moved small icons up and left by one pixel.
        if(id!=9){auto art=ArtworkMeta(id);if(unsigned(art.sourceWidth)*unsigned(baseIconHeight)>unsigned(art.sourceHeight)*unsigned(baseIconWidth))baseIconHeight=Limit(int(unsigned(baseIconWidth)*art.sourceHeight/art.sourceWidth),1,baseIconHeight);else baseIconWidth=Limit(int(unsigned(baseIconHeight)*art.sourceWidth/art.sourceHeight),1,baseIconWidth);}
        Vec point{};if(!displayedDistances[id].valid)directionStates[id].Reset();
        int meters=layout::active?0:DisplayDistance(id,point,now);
        auto result=layout::active?direction_math::Result{0,-1,true,1}:directionStates[id].Update(directionBasis,viewOrigin,point,DisplayKey(id));
        int high=layout::active?0:int(radar_nav::Abs(point.z-viewOrigin.z)/39.3701f+.5f);
        auto& words=PrepareRowText(id,meters,DisplayCount(rows[id]),!layout::active&&rows[id].unlimited,result.height,high,card.w,card.h,countWidth,heightWidth,Limit(int(classic_hud::DistanceFont*sy+.5f),7,42),Limit(int(4.5f*sy+.5f),7,18));
        // Extremely small custom cells have a readable minimum. Expand the
        // complete cell (including arrow padding), then keep it on screen.
        int panelWidth=words.cardWidth;
        box.w+=panelWidth-card.w;box.h+=words.cardHeight-card.h;
        if(box.w<panelWidth+2*mx)box.w=panelWidth+2*mx;
        if(box.h<words.cardHeight+2*my)box.h=words.cardHeight+2*my;
        auto& item=prepared[id];item.visible=true;item.extraSupply=extraSupply;item.box=box;item.mx=mx;item.my=my;item.iconWidth=baseIconWidth;item.iconHeight=baseIconHeight;item.unit=unit;item.direction=result;
        b4b_hud::GridPosition(id,item.group,item.column,item.row);
        if(!layout::items[id].custom&&!extraSupply){
            int extra=box.w-automatic.w;if(extra>columnExtra[item.group][item.column])columnExtra[item.group][item.column]=extra;
            extra=box.h-automatic.h;if(extra>rowExtra[item.group][item.row])rowExtra[item.group][item.row]=extra;
        }
    }
    // Only enlarged automatic cells affect their grid neighbours. Custom
    // coordinates remain controlled by the user. Normal values keep the
    // original B4B positions, including the space reserved for arrows.
    bool wrapSpecial=false;int wrapY=0,wrapWidth=0,wrapHeight=0;
    if(autoSpecial&&!extraSupplyRow.y){
        const auto first=b4b_hud::Cell(items::SpecialFirst,h,s);
        int right=first.x+first.w;wrapY=first.y+4*first.h;
        for(int i=0;i<b4b_hud::SmallColumns;++i){right+=columnExtra[0][i];wrapY+=rowExtra[0][i];}
        // Keep the old grid fixed. Wrap just the added column if it would be
        // clamped onto a neighbour on an unusually narrow viewport.
        wrapSpecial=right>w-4;
        if(wrapSpecial){
            wrapWidth=first.w+columnExtra[0][b4b_hud::SmallColumns-1];wrapHeight=first.h;
            for(unsigned id=items::SpecialFirst;id<IconCount;++id){
                const auto& item=prepared[id];if(item.visible&&!layout::items[id].custom&&item.box.h>wrapHeight)wrapHeight=item.box.h;
            }
        }
    }
    for(unsigned id:hudOrder){
        const auto& item=prepared[id];if(!item.visible)continue;
        auto box=item.box;auto& words=rowTextCaches[options::DigitStyle()][id];
        if(!layout::items[id].custom&&!item.extraSupply){
            if(wrapSpecial&&items::IsSpecial(id)){
                const unsigned slot=id-items::SpecialFirst;
                box.x=int(6.f*s+.5f)+int(slot%2)*wrapWidth;box.y=wrapY+int(slot/2)*wrapHeight;
            }else{
                for(int c=0;c<item.column;++c)box.x+=columnExtra[item.group][c];
                if(item.group==1){for(int r=0;r<=item.row;++r)box.y-=rowExtra[1][r];}
                else{for(int r=0;r<item.row;++r)box.y+=rowExtra[0][r];}
            }
        }
        box.x=Limit(box.x,4,w-box.w-4);box.y=Limit(box.y,2,h-box.h-4);
        layout::Box card{box.x+item.mx,box.y+item.my,words.cardWidth,words.cardHeight};layout::boxes[id]=box;
        auto palette=ArtworkMeta(id);
        Icon(id+IconCount,card.x,card.y,card.w,card.h);
        // The icon keeps its size as text values change. A wider exceptional
        // string reallocates text lanes without re-uploading the icon.
        Icon(id,card.x+(card.w-item.iconWidth)/2,card.y+(card.h-item.iconHeight)/2,item.iconWidth,item.iconHeight,iconAlpha);
        int textX=card.x+words.drawCountWidth,textWidth=card.w-words.drawCountWidth-words.drawHeightWidth;
        DrawCenteredText({textX,card.y,textWidth,card.h},words.distance,classic_hud::DistanceRed,classic_hud::DistanceGreen,classic_hud::DistanceBlue,(id==1||id==3)?1:0,id==1?1:id==34?int(3.2f*item.unit+.5f):0);
        if(words.showCount)DrawCenteredText({card.x,card.y,words.drawCountWidth,card.h},words.quantity,classic_hud::SideRed,classic_hud::SideGreen,classic_hud::SideBlue);
        if(words.showHeight)DrawCenteredText({card.x+card.w-words.drawHeightWidth,card.y,words.drawHeightWidth,card.h},words.elevation,classic_hud::SideRed,classic_hud::SideGreen,classic_hud::SideBlue);
        if(options::values[options::Direction])DirectionArrow(card,item.unit,item.direction,palette);
        layout::visualBoxes[id]=box;
        if(layout::active){layout::alignmentBoxes[id]=card;if(layout::selected==id)DrawAdjustmentFrame(card);}
    }
    if(layout::active){DrawAlignmentGuide();EditorFooter(w,h);}
    VCall<void(__thiscall*)(void*)>(surface,24)(surface);VCall<void(__thiscall*)(void*,float)>(surface,105)(surface,alpha);paintReason=1;
}
static void PaintRadar(const L4P_GameUiFrameV1& frame){
    lastUiPaint=frame.time_ms;
    if(layout::active){Draw();return;}
    if(!options::values[options::Enable]||!radarItems){paintReason=2;return;}if(!totalVisible||!options::values[options::WeaponIconOpacity]){ResetRenderPresentation();paintReason=8;return;}if(frame.game_ui){paintReason=3;return;}if(!activeSource.object||lastUiPaint-activeSourceAt>120||Entity(activeSource.index)!=activeSource.object){paintReason=4;return;}
    camera_origin::Matrix view{};directionBasis.valid=false;
    bool needView=activeSource.roaming||options::values[options::Direction];bool haveView=needView&&camera_origin::ReadView(engine,view);
    if(haveView&&options::values[options::Direction])directionBasis.Update(view);
    Vec p{};bool position=activeSource.roaming?(haveView&&camera_origin::Position(view,p)):WorldPosition(activeSource.object,p);
    if(!position||!radar_nav::Position(p)){paintReason=4;return;}
    viewOrigin=p;Draw();}

#include "flare_session.h"
