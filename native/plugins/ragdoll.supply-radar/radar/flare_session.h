#pragma once

namespace flare_radar {
constexpr char Id[] = "ragdoll.supply-radar";
constexpr char Version[] = "1.5.9";
constexpr WCHAR Title[] = L"物资雷达";
constexpr unsigned EditItem = 0x1000;
constexpr unsigned Display = 1, Items = 2, Glow = 3, Layout = 4;
constexpr unsigned ItemGroup = 10, GlowGroup = 20, LayoutGroup = 30;
constexpr const WCHAR* Groups[] = {L"医疗品",L"投掷物",L"武器",L"弹药与道具"};
constexpr const WCHAR* Colors[] = {L"跟随物品",L"白色",L"红色",L"橙色",L"黄色",L"绿色",L"蓝色",L"紫色"};
constexpr const WCHAR* Digits[] = {L"原雷达",L"爱心",L"猫耳"};

bool Parent(WCHAR* path){
    unsigned size=0;while(path[size])++size;
    while(size&&path[size-1]!=L'\\'&&path[size-1]!=L'/')--size;
    if(!size)return false;path[size-1]=0;return true;
}
bool Folder(const WCHAR* path){
    if(CreateDirectoryW(path,nullptr))return true;
    DWORD flags=GetFileAttributesW(path);
    return flags!=0xfffffffful&&(flags&0x10);
}
bool Save(bool position=false){
    return Folder(dataDirectory)&&Folder(radarDirectory)&&(position?layout::Save(iniPath):options::Save(iniPath));
}
unsigned RetryDelay(unsigned failures){return failures<5?1000u<<failures:30000u;}
void Flush(unsigned now, bool force=false){
    bool failed=false;
    if(saveAt&&(force||(int)(now-saveAt)>=0)){
        if(Save()){saveAt=0;settingsSaveFailures=0;}
        else{failed=true;saveAt=now+RetryDelay(settingsSaveFailures++);}
    }
    if(layoutSaveAt&&!layout::active&&(force||(int)(now-layoutSaveAt)>=0)){
        if(Save(true)){layoutSaveAt=0;layoutRetryFailures=0;}
        else{failed=true;layoutSaveAt=now+RetryDelay(layoutRetryFailures++);}
    }
    if(failed&&!saveError)hostLog(logContext,L4P_LOG_ERROR,"Radar settings write failed; retrying pending settings.");
    saveError=failed||(saveError&&(saveAt||layoutSaveAt));
}
void EndEdit(bool commit){
    if(!layout::active)return;
    layout::End(commit);
    if(commit){layoutSaveAt=GetTickCount();Flush(layoutSaveAt,true);}
}
void RefreshTracked(){
    radarItems=options::AnyEnabled();
    tracked=options::AnyTracked();
}
uint32_t SetOption(unsigned id, int value){
    if(id>=options::Count)return L4P_BAD_ARGUMENT;
    if(!options::Change(id,value))return L4P_OK;
    const auto now=GetTickCount();
    saveAt=now+300;settingsSaveFailures=0;
    if(options::scanChanged||options::trackChanged){RefreshTracked();aggregateDirty=true;RequestDiscovery(now);}
    if(options::glowChanged)clientGlowController.scheduled=false;
    return L4P_OK;
}
bool Dependencies(){
    if(!Profile(L"engine.dll",0x6a440ed6,0x73f000)||!Profile(L"client.dll",0x6a440ecf,0x963000)||
        !Profile(L"vguimatsurface.dll",0x6a440da4,0x172000))return false;
    engine=GetInterface(L"engine.dll","VEngineClient013");
    entities=GetInterface(L"client.dll","VClientEntityList003");
    surface=GetInterface(L"vguimatsurface.dll","VGUI_Surface031");
    cvars=GetInterface(L"vstdlib.dll","VEngineCvar007");
    const int engineSlots[]={5,12,52};
    for(int slot:engineSlots)if(!MethodOK(engine,slot))return false;
    const int slots[]={11,12,17,19,20,22,24,28,29,31,32,34,63,64,72,105,106};
    for(int slot:slots)if(!MethodOK(surface,slot))return false;
    if(!ConfigureWorldOrigin()||!MethodOK(entities,0)||!MethodOK(entities,3)||!EntityScanABI(entities)||
        !TextureUploadABI(surface)||!TextureReleaseABI(surface)||!FontMetricsABI(surface)||!TextSizeABI(surface)||
        !MethodOK(cvars,12))return false;
    parentHandleReady=EntityHandleABI(entities);
    auto base=(unsigned char*)GetModuleHandleW(L"engine.dll");
    auto models=GetInterface(L"engine.dll","VModelInfoClient004");
    // Accept the original or the complete checked nonnegative-index dispatch
    // when the independent L4N package owns this engine method.
    if(MethodOK(models,1)&&MethodOK(models,3)&&(*(void***)models)[3]==base+0x1afba0){
        auto lookup=(*(void***)models)[1];
        auto l4n=(unsigned char*)GetModuleHandleW(L"left4neko.dll");
        if(lookup==base+0x1b0420||l4n_model::PositiveDispatch(l4n,lookup,base+0x1b0420))modelInfo=models;
    }
    camera_origin::Configure(engine);
    directionSurfaceReady=DirectionPolygonABI(surface);
    entitySerialReady=EntityIdentityABI(entities);
    options::glowAvailable=entitySerialReady&&clientGlowNative.Configure();
    if(Profile(L"filesystem_stdio.dll",0x6a440da6,0x5e000)){
        auto fs=GetInterface(L"filesystem_stdio.dll","VBaseFileSystem012");
        if(MethodOK(fs,0)&&MethodOK(fs,2)&&MethodOK(fs,3)&&MethodOK(fs,7))filesystem=fs;
    }
    RefreshTracked();
    return true;
}
bool LocalCampaign(){
    if(!modeVar)modeVar=controls::FindVar(cvars,"mp_gamemode");
    char mode[24];
    return CopySafe(mode,sizeof mode,controls::ReadString(modeVar))&&
        (Same(mode,"coop")||Same(mode,"realism")||Same(mode,"survival"));
}
void LeaveSession(){
    if(layout::active)EndEdit(false);
    if(ready)ReleaseClientGlow();
    activeSource={};Gate(0);
    if(session){ClearMap();session=false;}
    sessionAllowed=false;
}
void Tick(unsigned now,bool showingUi,bool menuOpen){
    sessionAllowed=LocalCampaign();
    if(!sessionAllowed){LeaveSession();return;}
    if(!session||now-lastMapCheck>=500){
        lastMapCheck=now;
        const char* current=VCall<const char*(__thiscall*)(void*)>(engine,52)(engine);
        char name[240];
        if(CopySafe(name,sizeof name,current)&&name[0]){
            for(unsigned i=0;name[i];++i)if(name[i]=='\\')name[i]='/';
            if(!session||!Same(name,mapName)){StartMap(name);session=true;}
        }
    }
    if(!session||showingUi||menuOpen||layout::active){
        ReleaseClientGlow();return;
    }
    if(!options::GlowActive())ReleaseClientGlow();
    if(!tracked){
        activeSource={};if(gateState!=2)ResetDisplay();Gate(2);return;
    }
    SyncMetadata();ReadSupplyMap();
    RadarSource source;
    if(!Player(source)){activeSource={};Gate(3);ResetDisplay();ReleaseClientGlow();return;}
    SetActiveSource(source,now);
    Gate(source.roaming?6:source.spectating?5:4);
    Work(now,source.position,source.object);
    UpdateClientGlow(now);
}
void L4P_CALL Frame(void*,const L4P_GameUiFrameV1* frame){
    unsigned now=frame->time_ms;
    mainThread=GetCurrentThreadId();window=frame->window;
    if(saveAt||layoutSaveAt)Flush(now);
    if(!frame->local_game||!frame->in_game){if(sessionAllowed||session||layout::active)LeaveSession();return;}
    if(!ready){
        if(probeAt&&(int)(now-probeAt)<0)return;
        probeAt=now+1000;
        if(!(ready=Dependencies()))return;
    }
    if(frame->menu_open&&layout::active)EndEdit(false);
    if(!nextTick||(int)(now-nextTick)>=0){
        nextTick=now+25;
        Tick(now,frame->game_ui!=0,frame->menu_open!=0);
    }
    if(!sessionAllowed||!session||frame->game_ui||frame->menu_open)return;
    if(!layout::active&&!totalVisible){ResetRenderPresentation();return;}
    static bool fontsLoaded;
    if(!fontsLoaded){hud_digit_font::Load();hud_numeric_font::Load();hud_heart_font::Load();hud_cat_font::Load();fontsLoaded=true;}
    PaintRadar(*frame);
}
uint32_t L4P_CALL Input(void*,uint32_t message,uint32_t key,int32_t data){
    if(message==0x5||message==0x7e||message==0x1c)fontRecovery.Notify(message,key,GetTickCount());
    if(message==0x8||(message==0x1c&&!key)){EndEdit(false);return 0;}
    const bool systemMove=message==0x104&&key>=37&&key<=40;
    if(!sessionAllowed||!ready||(message!=0x100&&!systemMove&&message!=0x104))return 0;
    if(layout::active&&(message==0x100||systemMove)){
        int action=layout::Key(key,(GetKeyState(16)&0x8000)!=0,systemMove||(GetKeyState(18)&0x8000)!=0);
        if(action==2)EndEdit(true);
        else if(action==3)EndEdit(false);
        if(action)return 1;
    }
    const auto shortcut=options::glowShortcut;
    if(!layout::active&&options::glowAvailable&&shortcut.key==key&&glow_hotkey::FirstPress(message,data)){
        const unsigned modifiers=((GetKeyState(0x11)&0x8000)?glow_hotkey::Ctrl:0u)|
            ((GetKeyState(0x10)&0x8000)?glow_hotkey::Shift:0u)|((GetKeyState(0x12)&0x8000)?glow_hotkey::Alt:0u);
        if(modifiers==shortcut.modifiers)SetOption(options::Glow,!options::values[options::Glow]);
    }
    return 0;
}
struct Page {
    L4P_GameMenuPageV1& data;
    void title(const WCHAR* s,const WCHAR* note=L""){
        WideCopy(data.title,64,s);WideCopy(data.note,96,saveError?L"设置暂未写入，正在重试":note);
    }
    void link(unsigned id,const WCHAR* text,bool disable=false){row(L4P_MENU_LINK,id,text,disable);}
    L4P_GameMenuRowV1* row(unsigned kind,unsigned id,const WCHAR* text,bool disabled=false){
        if(data.count>=L4P_GAME_UI_MAX_ROWS)return nullptr;
        auto& r=data.rows[data.count++];r={};r.kind=kind;r.id=id;r.disabled=disabled;
        WideCopy(r.label,64,text);return &r;
    }
    void setting(unsigned i,const WCHAR* name=nullptr,bool disable=false,const WCHAR* const* choices=nullptr){
        auto& spec=options::specs[i];
        WCHAR label[64]{};
        if(!name){MultiByteToWideChar(65001,0,spec.label,-1,label,64);name=label;}
        auto* r=row(choices?L4P_MENU_CHOICE:spec.maximum==1?L4P_MENU_TOGGLE:L4P_MENU_RANGE,i,name,disable);
        if(!r)return;
        r->value=options::values[i];r->minimum=spec.minimum;r->maximum=spec.maximum;r->step=spec.step;
        if(choices)WideCopy(r->value_text,24,choices[r->value]);
        else if(i==options::Range||i==options::GlowRange)wsprintfW(r->value_text,L"%d 米",r->value);
        else if(i==options::IconOpacity||i==options::WeaponIconOpacity||i==options::Scale||i==options::GlowBrightness)
            wsprintfW(r->value_text,L"%d%%",r->value);
    }
};
uint32_t L4P_CALL BuildPage(void*,uint32_t id,L4P_GameMenuPageV1* data){
    if(!data)return L4P_BAD_ARGUMENT;
    data->count=0;
    Page p{*data};
    if(id==0){
        p.title(Title,L"本地战役、生还者模式与写实");
        p.setting(options::Enable);
        p.link(Display,L"显示与数字");
        p.link(Items,L"选择显示的物资");
        p.link(Glow,L"物品发光");
        p.link(Layout,L"位置编辑");
    }else if(id==Display){
        p.title(L"显示与数字",L"调整 HUD 的读数与外观");
        const unsigned fields[]={options::Range,options::IconOpacity,options::WeaponIconOpacity,options::Scale,
            options::Direction,options::ShowCount,options::Height,options::Unknown,options::QuestionMark,
            options::Rows,options::Columns,options::Spectator,options::MapMetadata};
        for(unsigned field:fields)p.setting(field);
        p.setting(options::DigitFont,L"数字字体",false,Digits);
    }else if(id==Items||id==Layout){
        p.title(id==Items?L"选择显示的物资":L"位置编辑",
            id==Items?L"分类管理雷达图标":sessionAllowed?L"选择一个已开启的物资，进入布局编辑":L"进入本地地图后可编辑位置");
        for(unsigned i=0;i<4;++i)p.link((id==Items?ItemGroup:LayoutGroup)+i,Groups[i],id==Layout&&!sessionAllowed);
    }else if(id==Glow){
        const bool unavailable=ready&&!options::glowAvailable;
        p.title(L"物品发光",unavailable?L"当前游戏版本的发光接口不可用":L"仅在本地地图应用");
        p.setting(options::Glow,L"发光总开关",unavailable);
        const unsigned fields[]={options::GlowBrightness,options::GlowRange,options::GlowLimit};
        for(unsigned i:fields)p.setting(i,nullptr,unavailable);
        for(unsigned i=0;i<4;++i)p.link(GlowGroup+i,Groups[i],unavailable);
    }else if(id>=ItemGroup&&id<ItemGroup+4){
        int group=int(id-ItemGroup);p.title(Groups[group],L"设置哪些物资显示在雷达上");
        if(group<3)p.setting(group==0?options::Medical:group==1?options::Throwables:options::Weapons);
        for(unsigned i=1;i<IconCount;++i)if(options::Group(i)==group)p.setting(options::ItemSpec(i));
    }else if(id>=GlowGroup&&id<GlowGroup+4){
        int group=int(id-GlowGroup);p.title(Groups[group],L"分别调整发光开关和颜色");
        for(unsigned i=1;i<IconCount;++i)if(options::GlowSupported(i)&&options::Group(i)==group){
            p.setting(options::GlowSpec(i));
            p.setting(options::GlowColorSpec(i),nullptr,false,Colors);
        }
    }else if(id>=LayoutGroup&&id<LayoutGroup+4){
        unsigned ids[IconCount],n=options::PositionItems(int(id-LayoutGroup),ids);
        p.title(Groups[id-LayoutGroup],n?L"选择物资后，用方向键移动，Enter 保存":L"请先在「选择显示的物资」中开启一项");
        for(unsigned i=0;i<n;++i)p.row(L4P_MENU_ACTION,EditItem+ids[i],ItemName(ids[i]),!sessionAllowed);
    }else return L4P_BAD_ARGUMENT;
    return L4P_OK;
}
uint32_t L4P_CALL Change(void*,uint32_t id,int32_t value){
    if(id<options::Count)return SetOption(id,value);
    if(id>EditItem&&id<EditItem+IconCount&&sessionAllowed){
        layout::Begin(id-EditItem);
        return layout::active?L4P_MENU_CLOSE:L4P_ERROR;
    }
    return L4P_BAD_ARGUMENT;
}
void L4P_CALL Visibility(void*,uint32_t open){
    if(open)EndEdit(false);
    else if(saveAt||layoutSaveAt)Flush(GetTickCount(),true);
}
uint32_t L4P_CALL Init(const L4P_HostApiV1* host){
    if(!host||host->api_version!=1||host->struct_size!=sizeof(*host)||!host->plugin_directory||!host->log||uiToken)
        return L4P_BAD_ARGUMENT;
    hostLog=host->log;logContext=host->context;
    WCHAR folder[1024];
    const auto n=MultiByteToWideChar(65001,8,host->plugin_directory,-1,folder,1024);
    if(n<2||n>=900||!Parent(folder))return L4P_BAD_ARGUMENT;
    unsigned end=0;while(folder[end])++end;
    WideAppend(folder,1024,L"\\flare.game-ui\\plugin.dll");
    const auto lib=GetModuleHandleW(folder);
    folder[end]=0;
    const auto get=lib?(L4P_GetGameUiApiFn)GetProcAddress(lib,"L4P_GetGameUiApi"):nullptr;
    gameUi={L4P_GAME_UI_VERSION,sizeof(gameUi)};
    if(!get||get(L4P_GAME_UI_VERSION,&gameUi)!=L4P_OK||!gameUi.register_module||!gameUi.unregister_module||!gameUi.begin_draw)
        return L4P_ERROR;
    if(!Parent(folder))return L4P_BAD_ARGUMENT;
    WideCopy(dataDirectory,1024,folder);WideAppend(dataDirectory,1024,L"\\data");
    WideCopy(radarDirectory,1024,dataDirectory);WideAppend(radarDirectory,1024,L"\\ragdoll.supply-radar");
    WideCopy(iniPath,1024,radarDirectory);WideAppend(iniPath,1024,L"\\settings.ini");
    options::Load(iniPath);layout::Load(iniPath);
    RefreshTracked();
    const L4P_GameUiModuleV1 module{sizeof(module),Id,Title,nullptr,Frame,Input,BuildPage,Change,Visibility};
    return gameUi.register_module(&module,&uiToken);
}
uint32_t L4P_CALL Invoke(const char*,const char*,char*,uint32_t,uint32_t*){return L4P_BAD_ARGUMENT;}
void L4P_CALL Shutdown(){
    if(uiToken){gameUi.unregister_module(uiToken);uiToken=0;}
    if(mainThread&&GetCurrentThreadId()==mainThread)LeaveSession();
    EndEdit(false);
    if(saveAt||layoutSaveAt)Flush(GetTickCount(),true);
}
}

extern "C" L4P_EXPORT uint32_t L4P_CALL L4P_GetPluginApi(uint32_t version,L4P_PluginApiV1* out){
    if(version!=L4P_API_VERSION)return L4P_UNSUPPORTED_VERSION;
    if(!out||out->api_version!=version||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    *out={version,sizeof(*out),flare_radar::Id,flare_radar::Version,flare_radar::Init,flare_radar::Invoke,flare_radar::Shutdown};
    return L4P_OK;
}
extern "C" BOOL __stdcall DllMain(HMODULE h,DWORD reason,void*){
    if(reason==1)DisableThreadLibraryCalls(h);
    return 1;
}
