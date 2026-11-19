// GPL-3.0. Skeeto 2.2.19 HoldSemiResolveReloadInput / HoldSemiMakeRelease.
// The service owns captured edges, independent of feature timing/controllers.
struct InputKey {INPUT down{};WORD vk=0;char name[32]{};};
struct InputLease {InputKey key;bool releasing=false,pulse=false,down=true;};
struct InputService {std::map<uint32_t,InputLease> leases;uint32_t presses=0,failures=0;};
InputService& inputs(){static auto* p=new InputService;return *p;}
bool input_command(const char* name){return name&&(!strcmp(name,"+reload")||!strcmp(name,"+attack")||!strcmp(name,"+attack2"));}
WORD input_vk(const char* key){
    if(!*key)return 0;if(!key[1]){SHORT value=VkKeyScanA(key[0]);return value==-1?0:WORD(value&255);}
    struct Named{const char* name;WORD vk;};const Named keys[]={
        {"SPACE",VK_SPACE},{"ENTER",VK_RETURN},{"TAB",VK_TAB},{"ESCAPE",VK_ESCAPE},{"BACKSPACE",VK_BACK},{"CAPSLOCK",VK_CAPITAL},
        {"SEMICOLON",VK_OEM_1},{"EQUAL",VK_OEM_PLUS},{"COMMA",VK_OEM_COMMA},{"MINUS",VK_OEM_MINUS},{"PERIOD",VK_OEM_PERIOD},
        {"SLASH",VK_OEM_2},{"BACKQUOTE",VK_OEM_3},{"LBRACKET",VK_OEM_4},{"BACKSLASH",VK_OEM_5},{"RBRACKET",VK_OEM_6},{"APOSTROPHE",VK_OEM_7},
        {"SHIFT",VK_SHIFT},{"LSHIFT",VK_LSHIFT},{"RSHIFT",VK_RSHIFT},{"CTRL",VK_CONTROL},{"LCTRL",VK_LCONTROL},{"RCTRL",VK_RCONTROL},
        {"ALT",VK_MENU},{"LALT",VK_LMENU},{"RALT",VK_RMENU},{"UPARROW",VK_UP},{"DOWNARROW",VK_DOWN},{"LEFTARROW",VK_LEFT},{"RIGHTARROW",VK_RIGHT},
        {"INS",VK_INSERT},{"DEL",VK_DELETE},{"HOME",VK_HOME},{"END",VK_END},{"PGUP",VK_PRIOR},{"PGDN",VK_NEXT},{"PAUSE",VK_PAUSE},
        {"F1",VK_F1},{"F2",VK_F2},{"F3",VK_F3},{"F4",VK_F4},{"F5",VK_F5},{"F6",VK_F6},{"F7",VK_F7},{"F8",VK_F8},{"F9",VK_F9},{"F10",VK_F10},{"F11",VK_F11},{"F12",VK_F12},
        {"KP_INS",VK_NUMPAD0},{"KP_END",VK_NUMPAD1},{"KP_DOWNARROW",VK_NUMPAD2},{"KP_PGDN",VK_NUMPAD3},{"KP_LEFTARROW",VK_NUMPAD4},
        {"KP_5",VK_NUMPAD5},{"KP_RIGHTARROW",VK_NUMPAD6},{"KP_HOME",VK_NUMPAD7},{"KP_UPARROW",VK_NUMPAD8},{"KP_PGUP",VK_NUMPAD9},
        {"KP_SLASH",VK_DIVIDE},{"KP_MULTIPLY",VK_MULTIPLY},{"KP_MINUS",VK_SUBTRACT},{"KP_PLUS",VK_ADD},{"KP_ENTER",VK_RETURN},{"KP_DEL",VK_DECIMAL}};
    for(auto& p:keys)if(!_stricmp(key,p.name))return p.vk;return 0;
}
bool input_extended(WORD vk){return vk==VK_RCONTROL||vk==VK_RMENU||vk==VK_INSERT||vk==VK_DELETE||vk==VK_HOME||vk==VK_END||vk==VK_PRIOR||vk==VK_NEXT||vk==VK_LEFT||vk==VK_RIGHT||vk==VK_UP||vk==VK_DOWN||vk==VK_DIVIDE;}
bool input_resolve(const char* command,InputKey& key,bool fallback){
    using Lookup=const char*(__thiscall*)(void*,const char*);auto lookup=method<Lookup>(service().engine,22);if(!lookup)return false;
    copy(key.name,lookup(service().engine,command));
    if(!*key.name&&fallback){if(!strcmp(command,"+attack"))strcpy(key.name,"MOUSE1");else if(!strcmp(command,"+attack2"))strcpy(key.name,"MOUSE2");}
    if(!*key.name)return false;
    const char* mouse[]={"MOUSE1","MOUSE2","MOUSE3","MOUSE4","MOUSE5"};const WORD vks[]={VK_LBUTTON,VK_RBUTTON,VK_MBUTTON,VK_XBUTTON1,VK_XBUTTON2};
    const DWORD flags[]={MOUSEEVENTF_LEFTDOWN,MOUSEEVENTF_RIGHTDOWN,MOUSEEVENTF_MIDDLEDOWN,MOUSEEVENTF_XDOWN,MOUSEEVENTF_XDOWN};
    for(int i=0;i<5;++i)if(!_stricmp(key.name,mouse[i])){key.vk=vks[i];key.down.type=INPUT_MOUSE;key.down.mi.dwFlags=flags[i];if(i>=3)key.down.mi.mouseData=i==3?XBUTTON1:XBUTTON2;return true;}
    key.vk=input_vk(key.name);if(!key.vk)return false;key.down.type=INPUT_KEYBOARD;key.down.ki.wVk=key.vk;key.down.ki.wScan=WORD(MapVirtualKeyA(key.vk,MAPVK_VK_TO_VSC));
    key.down.ki.dwFlags=KEYEVENTF_SCANCODE|((input_extended(key.vk)||!_stricmp(key.name,"KP_ENTER"))?KEYEVENTF_EXTENDEDKEY:0);return key.down.ki.wScan!=0;
}
bool input_same_key(const InputKey& a,const InputKey& b){if(a.down.type!=b.down.type)return false;
    if(a.down.type==INPUT_MOUSE)return a.down.mi.dwFlags==b.down.mi.dwFlags&&a.down.mi.mouseData==b.down.mi.mouseData;
    return a.down.ki.wScan==b.down.ki.wScan&&((a.down.ki.dwFlags^b.down.ki.dwFlags)&KEYEVENTF_EXTENDEDKEY)==0;
}
bool input_foreground(){HWND fg=GetForegroundWindow();DWORD pid=0;if(fg)GetWindowThreadProcessId(fg,&pid);return pid==GetCurrentProcessId();}
bool input_ui(bool& visible){using Fn=bool(__thiscall*)(void*);auto object=iface(L"engine.dll","VEngineVGui001");auto fn=method<Fn>(object,2);if(!fn)return false;visible=fn(object);return true;}
bool input_up(const InputKey& key){INPUT up=key.down;
    if(up.type==INPUT_KEYBOARD)up.ki.dwFlags|=KEYEVENTF_KEYUP;
    else if(up.mi.dwFlags==MOUSEEVENTF_LEFTDOWN)up.mi.dwFlags=MOUSEEVENTF_LEFTUP;
    else if(up.mi.dwFlags==MOUSEEVENTF_RIGHTDOWN)up.mi.dwFlags=MOUSEEVENTF_RIGHTUP;
    else if(up.mi.dwFlags==MOUSEEVENTF_MIDDLEDOWN)up.mi.dwFlags=MOUSEEVENTF_MIDDLEUP;
    else if(up.mi.dwFlags==MOUSEEVENTF_XDOWN)up.mi.dwFlags=MOUSEEVENTF_XUP;
    else return false;
    if(SendInput(1,&up,sizeof(up))==1)return true;++inputs().failures;return false;
}
bool input_mouse_held();void input_mouse_remove(uint32_t);void input_mouse_pump();
bool input_release_lease(InputLease& lease){lease.releasing=true;return (lease.pulse&&(!lease.down||input_mouse_held()))||input_up(lease.key);}
void input_release_leases(uint32_t token){auto& leases=inputs().leases;for(auto i=leases.begin();i!=leases.end();){if(!token||i->first==token){if(input_release_lease(i->second)){i=leases.erase(i);continue;}}++i;}}
void input_remove(uint32_t token){input_release_leases(token);input_mouse_remove(token);}
void input_pump(){input_mouse_pump();auto& s=service();auto& leases=inputs().leases;if(leases.empty())return;bool ui=true;const bool ready=s.running&&input_foreground()&&input_ui(ui)&&!ui;
    for(auto i=leases.begin();i!=leases.end();){auto sub=s.subs.find(i->first);if(i->second.releasing||!ready||sub==s.subs.end()||!sub->second->active||sub->second->scope!=L4P_SOURCE_LOCAL||!allowed(&s.frame,L4P_SOURCE_LOCAL)){
        if(input_release_lease(i->second)){i=leases.erase(i);continue;}}
        else if(i->second.pulse&&!input_mouse_held()){if(input_release_lease(i->second)){i=leases.erase(i);continue;}}++i;}
}
uint32_t L4P_CALL input_snapshot(L4P_InputStateV1* out){if(!paintCallback||!out||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;bool ui=true;if(!input_ui(ui))return L4P_INPUT_MISSING;
    auto& state=inputs();*out={sizeof(*out),input_foreground()?1u:0u,ui?1u:0u,uint32_t(state.leases.size()),state.presses,state.failures};return L4P_OK;}
uint32_t L4P_CALL input_binding(const char* command,L4P_BindingV1* out){if(!paintCallback||!out||out->struct_size!=sizeof(*out)||!input_command(command))return L4P_BAD_ARGUMENT;
    InputKey key{};if(!input_resolve(command,key,true))return L4P_INPUT_MISSING;L4P_BindingV1 value{sizeof(value)};strcpy(value.key,key.name);value.held=(GetAsyncKeyState(key.vk)&0x8000)?1u:0u;*out=value;return L4P_OK;}
uint32_t L4P_CALL input_press(uint32_t token,const char* command){if(!paintCallback||!input_command(command))return L4P_BAD_ARGUMENT;auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);
    auto sub=s.subs.find(token);bool ui=true;if(sub==s.subs.end()||!sub->second->active||!s.running)return L4P_BAD_ARGUMENT;
    if(sub->second->scope!=L4P_SOURCE_LOCAL||!allowed(&s.frame,L4P_SOURCE_LOCAL)||!input_foreground()||!input_ui(ui)||ui)return L4P_INPUT_SCOPE;
    auto& state=inputs();InputKey key{};if(!input_resolve(command,key,false))return L4P_INPUT_MISSING;
    for(auto& p:state.leases)if(p.first==token||input_same_key(p.second.key,key))return p.first==token&&!p.second.releasing&&!p.second.pulse&&input_same_key(p.second.key,key)?L4P_OK:L4P_INPUT_CONFLICT;
    if(GetAsyncKeyState(key.vk)&0x8000)return L4P_INPUT_HELD;
    state.leases.emplace(token,InputLease{key});
    if(SendInput(1,&key.down,sizeof(key.down))!=1){state.leases.erase(token);++state.failures;return L4P_ERROR;}
    ++state.presses;return L4P_OK;
}
uint32_t L4P_CALL input_release(uint32_t token){if(!token)return L4P_BAD_ARGUMENT;auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);input_release_leases(token);return inputs().leases.count(token)?L4P_ERROR:L4P_OK;}
#include "input_mouse.inc"
