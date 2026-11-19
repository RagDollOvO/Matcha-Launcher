// GPL-3.0. Physical hold tracking from Skeeto 2.2.19 HoldSemiMouseProc.
// Source owns the worker for all consumers. Hook callbacks are atomic-only:
// SendInput may synchronously deliver one while Paint holds the service mutex.
struct InputMouse {
    std::set<uint32_t> watchers;HANDLE thread=nullptr,stop=nullptr;DWORD retryAt=0;
    std::atomic<uint32_t> state{0},events{0},error{0};std::atomic<bool> physical{false};
};
InputMouse& input_mouse(){static auto* p=new InputMouse;return *p;}
bool input_mouse_held(){auto& m=input_mouse();return m.state.load(std::memory_order_acquire)==2&&m.events.load(std::memory_order_acquire)&&m.physical.load(std::memory_order_acquire);}
LRESULT CALLBACK input_mouse_hook(int code,WPARAM event,LPARAM data){
    if(code==HC_ACTION&&data){const auto* info=reinterpret_cast<const MSLLHOOKSTRUCT*>(data);
        if(!(info->flags&LLMHF_INJECTED)&&(event==WM_LBUTTONDOWN||event==WM_LBUTTONUP)){
            auto& m=input_mouse();m.physical.store(event==WM_LBUTTONDOWN,std::memory_order_release);m.events.fetch_add(1,std::memory_order_release);
        }}
    return CallNextHookEx(nullptr,code,event,data);
}
DWORD WINAPI input_mouse_worker(void*){
    auto& m=input_mouse();MSG msg{};PeekMessageW(&msg,nullptr,WM_USER,WM_USER,PM_NOREMOVE);
    HMODULE module=nullptr;GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,reinterpret_cast<LPCWSTR>(&input_mouse_hook),&module);
    if(WaitForSingleObject(m.stop,0)==WAIT_OBJECT_0){m.state=0;return 0;}
    HHOOK hook=SetWindowsHookExW(WH_MOUSE_LL,input_mouse_hook,module,0);
    if(!hook){m.error=GetLastError();m.state=3;return 0;}m.state.store(2,std::memory_order_release);
    bool done=false;while(!done){DWORD wait=MsgWaitForMultipleObjects(1,&m.stop,FALSE,INFINITE,QS_ALLINPUT);
        if(wait==WAIT_OBJECT_0)break;if(wait!=WAIT_OBJECT_0+1){m.error=GetLastError();break;}
        while(PeekMessageW(&msg,nullptr,0,0,PM_REMOVE)){if(msg.message==WM_QUIT){done=true;break;}TranslateMessage(&msg);DispatchMessageW(&msg);}
    }
    UnhookWindowsHookEx(hook);m.physical=false;m.events=0;m.state.store(0,std::memory_order_release);return 0;
}
void input_mouse_reap(){auto& m=input_mouse();if(m.thread&&WaitForSingleObject(m.thread,0)==WAIT_OBJECT_0){
    CloseHandle(m.thread);m.thread=nullptr;CloseHandle(m.stop);m.stop=nullptr;m.retryAt=m.error?service().frame.time_ms+1000:0;m.state=m.error?3u:0u;
}}
void input_mouse_stop(){auto& m=input_mouse();if(m.stop){m.state=4;SetEvent(m.stop);}input_mouse_reap();}
void input_mouse_remove(uint32_t token){auto& m=input_mouse();if(token)m.watchers.erase(token);else m.watchers.clear();if(m.watchers.empty())input_mouse_stop();}
void input_mouse_pump(){auto& m=input_mouse();auto& s=service();
    for(auto i=m.watchers.begin();i!=m.watchers.end();){auto sub=s.subs.find(*i);if(!s.running||!allowed(&s.frame,L4P_SOURCE_LOCAL)||sub==s.subs.end()||!sub->second->active||sub->second->scope!=L4P_SOURCE_LOCAL){input_release_leases(*i);i=m.watchers.erase(i);}else ++i;}
    input_mouse_reap();if(m.watchers.empty()){if(m.thread&&m.state!=4)input_mouse_stop();return;}
    if(m.thread||!s.running||(m.retryAt&&int32_t(s.frame.time_ms-m.retryAt)<0))return;
    m.events=0;m.physical=false;m.error=0;m.state=1;m.stop=CreateEventW(nullptr,TRUE,FALSE,nullptr);
    if(m.stop)m.thread=CreateThread(nullptr,0,input_mouse_worker,nullptr,0,nullptr);
    if(!m.thread){m.error=GetLastError();if(m.stop){CloseHandle(m.stop);m.stop=nullptr;}m.state=3;m.retryAt=s.frame.time_ms+1000;}
}
uint32_t L4P_CALL input_watch_mouse(uint32_t token,uint32_t enabled){
    if(!token||enabled>1||(enabled&&!paintCallback))return L4P_BAD_ARGUMENT;auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);
    if(!enabled){input_remove(token);return inputs().leases.count(token)?L4P_ERROR:L4P_OK;}
    auto sub=s.subs.find(token);if(sub==s.subs.end()||!sub->second->active||!s.running)return L4P_BAD_ARGUMENT;
    if(sub->second->scope!=L4P_SOURCE_LOCAL||!allowed(&s.frame,L4P_SOURCE_LOCAL))return L4P_INPUT_SCOPE;
    input_mouse().watchers.insert(token);input_mouse_pump();return L4P_OK;
}
uint32_t L4P_CALL input_mouse_state(uint32_t token,L4P_MouseStateV1* out){
    if(!paintCallback||!out||out->struct_size!=sizeof(*out)||!service().subs.count(token))return L4P_BAD_ARGUMENT;
    auto& m=input_mouse();auto lease=inputs().leases.find(token);uint32_t phase=lease!=inputs().leases.end()&&lease->second.pulse?(lease->second.down?2u:1u):0u;
    *out={sizeof(*out),m.watchers.count(token)?1u:0u,m.state.load(),input_mouse_held()?1u:0u,m.events.load(),phase,m.error.load()};return L4P_OK;
}
uint32_t L4P_CALL input_mouse_edge(uint32_t token,uint32_t down){
    if(!paintCallback||!token||down>1)return L4P_BAD_ARGUMENT;auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);
    auto sub=s.subs.find(token);if(sub==s.subs.end()||!sub->second->active||!s.running)return L4P_BAD_ARGUMENT;
    bool ui=true;if(sub->second->scope!=L4P_SOURCE_LOCAL||!allowed(&s.frame,L4P_SOURCE_LOCAL)||!input_foreground()||!input_ui(ui)||ui){input_release_leases(token);return L4P_INPUT_SCOPE;}
    if(!input_mouse().watchers.count(token)||!input_mouse_held()){input_release_leases(token);return L4P_INPUT_NOT_HELD;}
    InputKey key{};key.vk=VK_LBUTTON;strcpy(key.name,"MOUSE1");key.down.type=INPUT_MOUSE;key.down.mi.dwFlags=MOUSEEVENTF_LEFTDOWN;
    auto& state=inputs();auto own=state.leases.find(token);
    for(auto& p:state.leases)if(p.first==token||input_same_key(p.second.key,key)){
        if(p.first!=token||!p.second.pulse||p.second.releasing)return L4P_INPUT_CONFLICT;
    }
    if(own==state.leases.end()){
        if(down)return L4P_BAD_ARGUMENT;own=state.leases.emplace(token,InputLease{key,false,true,true}).first;
        if(!input_up(key)){state.leases.erase(own);return L4P_ERROR;}own->second.down=false;return L4P_OK;
    }
    if(own->second.down==bool(down))return L4P_OK;
    if(!down){if(!input_up(key))return L4P_ERROR;own->second.down=false;return L4P_OK;}
    if(SendInput(1,&key.down,sizeof(key.down))!=1){++state.failures;return L4P_ERROR;}
    own->second.down=true;++state.presses;
    if(!input_mouse_held()){input_release_leases(token);return L4P_INPUT_NOT_HELD;}return L4P_OK;
}
