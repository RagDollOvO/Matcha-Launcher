#pragma once
#include "controls.h"
#include "glow_hotkey.h"
#include "items.h"
namespace options {
struct Spec {const WCHAR* key;const char* label;int value,minimum,maximum,step,page;};
#define RADAR_GLOW_ITEM_DEFAULT(key,label,page,value) {L"ClientGlow" key L"Enabled",label,value,0,1,1,page}
#define RADAR_GLOW_ITEM(key,label,page) RADAR_GLOW_ITEM_DEFAULT(key,label,page,1)
#define RADAR_GLOW_COLOR(id,key,label) {L"ClientGlow" key L"Color",label "颜色",0,0,7,1,40+id}
static const Spec specs[]={
    {L"Enabled","启用雷达",1,0,1,1,1},
    {L"RangeMeters","探测范围",40,5,120,5,1},
    {L"ShowUnknown","通路未确认时显示灰字",1,0,1,1,1},
    {L"ShowCount","左侧数量",1,0,1,1,1},
    {L"X","左右位置（0左 10000右）",10000,0,10000,250,1},
    {L"Y","上下位置（0上 10000下）",2000,0,10000,250,1},
    {L"Scale","整体大小",100,70,180,5,1},
    {L"Rows","武器行数上限",8,3,16,1,1},
    {L"Columns","武器列数",2,1,3,1,1},
    {L"Medical","医疗品总开关",1,0,1,1,2},
    {L"Throwables","投掷物总开关",1,0,1,1,3},
    {L"Weapons","武器总开关",1,0,1,1,5},
    {L"Ammo","弹药堆",1,0,1,1,4},
    {L"Laser","镭射盒",0,0,1,1,4},
    {L"Medkit","医疗包",0,0,1,1,2},
    {L"Defib","电击器",0,0,1,1,2},
    {L"Pills","止痛药",0,0,1,1,2},
    {L"Adrenaline","肾上腺素",0,0,1,1,2},
    {L"Molotov","燃烧瓶",0,0,1,1,3},
    {L"PipeBomb","土制炸弹",0,0,1,1,3},
    {L"Bile","胆汁",0,0,1,1,3},
    {L"AK","AK47",0,0,1,1,5},
    {L"M16","M16",0,0,1,1,5},
    {L"Military","军用狙击枪",0,0,1,1,5},
    {L"Hunting","猎枪",0,0,1,1,5},
    {L"MAC","消音冲锋枪",0,0,1,1,5},
    {L"UZI","UZI",0,0,1,1,5},
    {L"AWP","AWP",0,0,1,1,5},
    {L"Scout","Scout",0,0,1,1,5},
    {L"SCAR","SCAR",0,0,1,1,5},
    {L"Grenade","榴弹发射器",0,0,1,1,6},
    {L"M60","M60",0,0,1,1,6},
    {L"Pistol","手枪",1,0,1,1,6},
    {L"Magnum","沙鹰",1,0,1,1,6},
    {L"Pump","木喷",0,0,1,1,6},
    {L"Chrome","铁喷",0,0,1,1,6},
    {L"Auto","连喷",0,0,1,1,6},
    {L"SPAS","SPAS",0,0,1,1,6},
    {L"MP5","MP5",0,0,1,1,6},
    {L"SG552","SG552",0,0,1,1,6},
    {L"Melee","近战",0,0,1,1,6},
    {L"Chainsaw","电锯",0,0,1,1,6},
    {L"ShowQuestionMark","未确认距离显示问号",0,0,1,1,1},
    {L"ShowDirection","方向箭头",1,0,1,1,1},
    {L"WeaponIconOpacity","整体不透明度",100,0,100,5,1},
    {L"GasCan","油桶 / 汽油桶",0,0,1,1,4},
    {L"Fireworks","烟花盒",0,0,1,1,4},
    {L"Spectator","旁观时显示",1,0,1,1,1},
    {L"MapMetadata","兼容特殊地图物资",0,0,1,1,1},
    {L"ShowHeight","右侧高差",1,0,1,1,1},
    {L"EndSafehouse","终点安全屋",1,0,1,1,4},
    {L"DigitFont","数字字体（0原雷达 / 1爱心 / 2猫耳）",0,0,2,1,1},
    {L"ClientItemGlow","物品发光（客户端测试）",0,0,1,1,7},
    {L"ClientGlowRangeMeters","发光距离",20,5,120,5,7},
    {L"ClientGlowLimit","最多发光数量",16,1,128,1,7},
    RADAR_GLOW_ITEM(L"Medkit","医疗包",30),
    RADAR_GLOW_ITEM(L"Defib","电击器",30),
    RADAR_GLOW_ITEM(L"Pills","止痛药",30),
    RADAR_GLOW_ITEM(L"Adrenaline","肾上腺素",30),
    RADAR_GLOW_ITEM(L"Molotov","燃烧瓶",31),
    RADAR_GLOW_ITEM(L"PipeBomb","土制炸弹",31),
    RADAR_GLOW_ITEM(L"Bile","胆汁",31),
    RADAR_GLOW_ITEM(L"Ammo","弹药堆",33),
    RADAR_GLOW_ITEM(L"Laser","镭射盒",33),
    RADAR_GLOW_ITEM(L"AK","AK47",32),
    RADAR_GLOW_ITEM(L"M16","M16",32),
    RADAR_GLOW_ITEM(L"Military","军用狙击枪",32),
    RADAR_GLOW_ITEM(L"Hunting","猎枪",32),
    RADAR_GLOW_ITEM(L"MAC","消音冲锋枪",32),
    RADAR_GLOW_ITEM(L"UZI","UZI",32),
    RADAR_GLOW_ITEM(L"AWP","AWP",32),
    RADAR_GLOW_ITEM(L"Scout","Scout",32),
    RADAR_GLOW_ITEM(L"SCAR","SCAR",32),
    RADAR_GLOW_ITEM(L"Grenade","榴弹发射器",32),
    RADAR_GLOW_ITEM(L"M60","M60",32),
    RADAR_GLOW_ITEM(L"Pump","木喷",32),
    RADAR_GLOW_ITEM(L"Chrome","铁喷",32),
    RADAR_GLOW_ITEM(L"Auto","连喷",32),
    RADAR_GLOW_ITEM(L"SPAS","SPAS",32),
    RADAR_GLOW_ITEM(L"MP5","MP5",32),
    RADAR_GLOW_ITEM(L"SG552","SG552",32),
    RADAR_GLOW_ITEM(L"GasCan","油桶 / 汽油桶",33),
    RADAR_GLOW_ITEM(L"Fireworks","烟花盒",33),
    RADAR_GLOW_COLOR(1,L"Medkit","医疗包"),
    RADAR_GLOW_COLOR(2,L"Defib","电击器"),
    RADAR_GLOW_COLOR(3,L"Pills","止痛药"),
    RADAR_GLOW_COLOR(4,L"Adrenaline","肾上腺素"),
    RADAR_GLOW_COLOR(5,L"Molotov","燃烧瓶"),
    RADAR_GLOW_COLOR(6,L"PipeBomb","土制炸弹"),
    RADAR_GLOW_COLOR(7,L"Bile","胆汁"),
    RADAR_GLOW_COLOR(8,L"Ammo","弹药堆"),
    RADAR_GLOW_COLOR(9,L"Laser","镭射盒"),
    RADAR_GLOW_COLOR(11,L"AK","AK47"),
    RADAR_GLOW_COLOR(12,L"M16","M16"),
    RADAR_GLOW_COLOR(13,L"Military","军用狙击枪"),
    RADAR_GLOW_COLOR(14,L"Hunting","猎枪"),
    RADAR_GLOW_COLOR(15,L"MAC","消音冲锋枪"),
    RADAR_GLOW_COLOR(16,L"UZI","UZI"),
    RADAR_GLOW_COLOR(17,L"AWP","AWP"),
    RADAR_GLOW_COLOR(18,L"Scout","Scout"),
    RADAR_GLOW_COLOR(19,L"SCAR","SCAR"),
    RADAR_GLOW_COLOR(20,L"Grenade","榴弹发射器"),
    RADAR_GLOW_COLOR(21,L"M60","M60"),
    RADAR_GLOW_COLOR(24,L"Pump","木喷"),
    RADAR_GLOW_COLOR(25,L"Chrome","铁喷"),
    RADAR_GLOW_COLOR(26,L"Auto","连喷"),
    RADAR_GLOW_COLOR(27,L"SPAS","SPAS"),
    RADAR_GLOW_COLOR(28,L"MP5","MP5"),
    RADAR_GLOW_COLOR(29,L"SG552","SG552"),
    RADAR_GLOW_COLOR(32,L"GasCan","油桶 / 汽油桶"),
    RADAR_GLOW_COLOR(33,L"Fireworks","烟花盒"),
    {L"Cola","可乐",1,0,1,1,4},
    {L"Gnome","侏儒",1,0,1,1,4},
    {L"ExplosiveAmmo","高爆弹",1,0,1,1,4},
    {L"IncendiaryAmmo","燃烧弹",1,0,1,1,4},
    RADAR_GLOW_ITEM_DEFAULT(L"Cola","可乐",33,0),
    RADAR_GLOW_ITEM_DEFAULT(L"Gnome","侏儒",33,0),
    RADAR_GLOW_ITEM_DEFAULT(L"ExplosiveAmmo","高爆弹",33,0),
    RADAR_GLOW_ITEM_DEFAULT(L"IncendiaryAmmo","燃烧弹",33,0),
    RADAR_GLOW_COLOR(unsigned(items::Label::Cola),L"Cola","可乐"),
    RADAR_GLOW_COLOR(unsigned(items::Label::Gnome),L"Gnome","侏儒"),
    RADAR_GLOW_COLOR(unsigned(items::Label::ExplosiveAmmo),L"ExplosiveAmmo","高爆弹"),
    RADAR_GLOW_COLOR(unsigned(items::Label::IncendiaryAmmo),L"IncendiaryAmmo","燃烧弹"),
    {L"ClientGlowBrightness","发光亮度",100,0,100,5,7},
    {L"IconOpacity","图标不透明度",100,0,100,5,1},
};
#undef RADAR_GLOW_ITEM
#undef RADAR_GLOW_ITEM_DEFAULT
#undef RADAR_GLOW_COLOR
constexpr unsigned Count=sizeof(specs)/sizeof(specs[0]);
enum Index {Enable,Range,Unknown,ShowCount,X,Y,Scale,Rows,Columns,Medical,Throwables,Weapons,Ammo,Laser,QuestionMark=42,Direction=43,WeaponIconOpacity=44,GasCan=45,Fireworks=46,Spectator=47,MapMetadata=48,Height=49,Safehouse=50,DigitFont=51,Glow=52,GlowRange=53,GlowLimit=54};
constexpr unsigned GlowSettingsFirst=55;
constexpr unsigned GlowColorSettingsFirst=83;
static const unsigned GlowItems[]={1,2,3,4,5,6,7,8,9,11,12,13,14,15,16,17,18,19,20,21,24,25,26,27,28,29,32,33};
// Keep the legacy setting and migration indices stable.
constexpr unsigned SpecialItemSettingsFirst=111,SpecialGlowSettingsFirst=SpecialItemSettingsFirst+items::SpecialCount,
    SpecialColorSettingsFirst=SpecialGlowSettingsFirst+items::SpecialCount;
constexpr unsigned GlowBrightness=SpecialColorSettingsFirst+items::SpecialCount;
constexpr unsigned IconOpacity=GlowBrightness+1;
static int values[Count];
static bool scanChanged=false,glowChanged=false,trackChanged=false;
static bool glowAvailable=false;
static glow_hotkey::Binding glowShortcut;
static char fontName[128]="20HUD_Torus_SemiBold";static WCHAR fontNameWide[64]=L"20HUD_Torus_SemiBold";
inline void LoadFont(const WCHAR* path){
    WCHAR name[64];DWORD n=GetPrivateProfileStringW(L"SupplyRadar",L"FontName",L"20HUD_Torus_SemiBold",name,64,path);bool valid=n>0&&n<63;
    for(unsigned i=0;i<n&&valid;++i)if(name[i]<32)valid=false;
    char converted[128];BOOL replacement=0;int bytes=valid?WideCharToMultiByte(0,0,name,-1,converted,128,nullptr,&replacement):0;
    if(bytes>1&&!replacement){CopyText(fontName,128,converted);WideCopy(fontNameWide,64,name);}else{CopyText(fontName,128,"20HUD_Torus_SemiBold");WideCopy(fontNameWide,64,L"20HUD_Torus_SemiBold");}
}
static bool migrated,directionMigrated;
static int savedValues[Count];static bool savedKnown[Count],savedFontKnown,savedVersion,savedDirectionVersion;
static WCHAR savedPath[1024],savedFont[64];static unsigned saveWrites,saveFailures;
inline bool SameWide(const WCHAR* a,const WCHAR* b){while(*a&&*a==*b){++a;++b;}return *a==*b;}
inline void ResetSavedPath(const WCHAR* path){WideCopy(savedPath,1024,path);memset(savedKnown,0,sizeof savedKnown);savedFontKnown=savedVersion=savedDirectionVersion=false;}
inline bool WriteSetting(const WCHAR* key,const WCHAR* value,const WCHAR* path){++saveWrites;bool ok=WritePrivateProfileStringW(L"SupplyRadar",key,value,path)!=0;if(!ok)++saveFailures;return ok;}
inline bool Enabled(items::Label label);
inline void Load(const WCHAR* path){
    LoadFont(path);ResetSavedPath(path);
    WCHAR shortcut[32];DWORD length=GetPrivateProfileStringW(L"SupplyRadar",L"ClientGlowHotkey",L"Off",shortcut,32,path);
    glowShortcut=length<31?glow_hotkey::Parse(shortcut):glow_hotkey::Binding{};
    for(unsigned i=0;i<Count;++i){
        int raw=int(GetPrivateProfileIntW(L"SupplyRadar",specs[i].key,specs[i].value,path));
        values[i]=Limit(raw,specs[i].minimum,specs[i].maximum);savedValues[i]=raw;
        WCHAR present[2];savedKnown[i]=GetPrivateProfileStringW(L"SupplyRadar",specs[i].key,L"",present,2,path)>0;
    }
    // First upgrade keeps the user's former glow selection. Once written,
    // the independent glow key takes precedence over later radar changes.
    for(unsigned slot=0;slot<sizeof(GlowItems)/sizeof(GlowItems[0]);++slot)if(!savedKnown[GlowSettingsFirst+slot])values[GlowSettingsFirst+slot]=values[Enable]&&Enabled(items::Label(GlowItems[slot]))?1:0;
    savedFontKnown=GetPrivateProfileStringW(L"SupplyRadar",L"FontName",L"",savedFont,64,path)>0;
    unsigned version=GetPrivateProfileIntW(L"SupplyRadar",L"SettingsVersion",0,path);savedVersion=version==2;migrated=version<2;
    if(migrated)values[Unknown]=1;
    unsigned directionVersion=GetPrivateProfileIntW(L"SupplyRadar",L"DirectionalHudVersion",0,path);
    savedDirectionVersion=directionVersion>=1;directionMigrated=directionVersion<1;
    if(directionMigrated)values[Direction]=1;
}
inline bool Dirty(){
    for(unsigned i=0;i<Count;++i)if(!savedKnown[i]||savedValues[i]!=values[i])return true;
    return !savedFontKnown||!SameWide(savedFont,fontNameWide)||!savedVersion||!savedDirectionVersion;
}
// True means all values and migration markers are durable. False asks the
// caller to keep its deferred-save request and retry with bounded backoff.
inline bool Save(const WCHAR* path){
    if(!SameWide(savedPath,path))ResetSavedPath(path);
    // Preserve the original INI writer and all unrelated keys/sections/comments.
    // Successful values form the baseline; failures remain dirty for a later save.
    for(unsigned i=0;i<Count;++i){
        if(savedKnown[i]&&savedValues[i]==values[i])continue;
        WCHAR number[16];wsprintfW(number,L"%d",values[i]);
        if(WriteSetting(specs[i].key,number,path)){savedKnown[i]=true;savedValues[i]=values[i];}
    }
    if(!savedFontKnown||!SameWide(savedFont,fontNameWide)){
        if(WriteSetting(L"FontName",fontNameWide,path)){WideCopy(savedFont,64,fontNameWide);savedFontKnown=true;}
    }
    if(!savedVersion&&WriteSetting(L"SettingsVersion",L"2",path))savedVersion=true;
    // Do not commit the migration marker before the migrated direction value
    // is durable. Failed writes remain pending; a later explicit OFF survives.
    if(!savedDirectionVersion&&savedKnown[Direction]&&savedValues[Direction]==values[Direction]){
        if(WriteSetting(L"DirectionalHudVersion",L"1",path)){savedDirectionVersion=true;directionMigrated=false;}
    }
    return !Dirty();
}
inline bool Supported(unsigned id){return id>=1&&id<unsigned(items::Label::Count)&&id!=10&&id!=22&&id!=23&&id!=30&&id!=31;}
inline bool GlowSupported(unsigned id){return Supported(id)&&id!=34;}
inline unsigned GlowSpec(unsigned id){
    if(!GlowSupported(id))return Count;
    if(items::IsSpecial(id))return SpecialGlowSettingsFirst+id-items::SpecialFirst;
    unsigned slot=id-1;
    if(id>10)--slot;if(id>22)--slot;if(id>23)--slot;if(id>30)--slot;if(id>31)--slot;return GlowSettingsFirst+slot;
}
inline bool GlowEnabled(unsigned id){return GlowSupported(id)&&values[GlowSpec(id)]!=0;}
inline bool GlowEnabled(items::Label label){return GlowEnabled(unsigned(label));}
inline unsigned GlowColorSpec(unsigned id){if(!GlowSupported(id))return Count;return items::IsSpecial(id)?SpecialColorSettingsFirst+id-items::SpecialFirst:GlowColorSettingsFirst+GlowSpec(id)-GlowSettingsFirst;}
inline int GlowColorChoice(unsigned id){return GlowSupported(id)?Limit(values[GlowColorSpec(id)],0,7):0;}
inline unsigned GlowColor(unsigned id,unsigned defaultColor){
    // Packed RGB follows the native glow property: red is the low byte.
    static const unsigned colors[]={0,0xFFFFFFu,0x4040FFu,0x0080FFu,0x40FFFFu,0x60FF40u,0xFF8040u,0xFF40C0u};
    unsigned choice=unsigned(GlowColorChoice(id));return choice?colors[choice]:defaultColor;
}
inline unsigned ItemSpec(unsigned id){if(items::IsSpecial(id))return SpecialItemSettingsFirst+id-items::SpecialFirst;if(id==34)return Safehouse;if(id==32)return GasCan;if(id==33)return Fireworks;return id<=7?id+13:id==8?Ammo:id==9?Laser:id+10;}
inline int Group(unsigned id){if(!Supported(id))return -1;return id>=32?3:id<=4?0:id<=7?1:id>=11?2:3;}
inline bool Enabled(items::Label label){unsigned id=unsigned(label);int group=Group(id);return group>=0&&values[ItemSpec(id)]&&(group==3||values[group==0?Medical:group==1?Throwables:Weapons]);}
inline bool AnyEnabled(){for(unsigned id=1;id<unsigned(items::Label::Count);++id)if(Supported(id)&&Enabled(items::Label(id)))return true;return false;}
inline bool GlowActive(){return glowAvailable&&values[Glow]&&values[GlowBrightness]>0;}
inline bool Tracked(items::Label label){return (values[Enable]&&Enabled(label))||(GlowActive()&&GlowEnabled(label));}
inline bool AnyTracked(){for(unsigned id=1;id<unsigned(items::Label::Count);++id)if(Tracked(items::Label(id)))return true;return false;}
inline unsigned PositionItems(int group,unsigned* out){unsigned n=0;for(unsigned id=1;id<unsigned(items::Label::Count);++id)if((group<0?Supported(id):Group(id)==group)&&Enabled(items::Label(id)))out[n++]=id;return n;}
inline bool ScanSetting(unsigned index){if(index==Enable||index==Range||index==Medical||index==Throwables||index==Weapons||index==Laser||index==GasCan||index==Fireworks||index==Spectator||index==MapMetadata)return true;for(unsigned id=1;id<unsigned(items::Label::Count);++id)if(Supported(id)&&ItemSpec(id)==index)return true;return false;}
// A font change only selects an existing rendering bank; it is not a scan setting.
static_assert(Count==IconOpacity+1&&GlowSettingsFirst==55&&GlowColorSettingsFirst==83&&sizeof(GlowItems)/sizeof(GlowItems[0])==28&&MapMetadata==48&&Height==49&&Safehouse==50&&DigitFont==51&&Glow==52&&GlowLimit==54,"Setting mapping mismatch");
inline int DigitStyle(){return Limit(values[DigitFont],0,2);}
// A write comes from an in-game control, never a per-frame ConVar scan.
inline bool Change(unsigned index,int value){
    if(index>=Count)return false;
    const auto& spec=specs[index];
    int next=Limit(value,spec.minimum,spec.maximum),previous=values[index];
    if(next==previous)return false;
    values[index]=next;
    scanChanged=ScanSetting(index);
    glowChanged=(index>=Glow&&index<SpecialItemSettingsFirst)||(index>=SpecialGlowSettingsFirst&&index<=GlowBrightness);
    trackChanged=index==Glow||(index>=GlowSettingsFirst&&index<GlowColorSettingsFirst)||
        (index>=SpecialGlowSettingsFirst&&index<SpecialColorSettingsFirst)||
        (index==GlowBrightness&&((previous==0)!=(next==0)));
    return true;
}
}
