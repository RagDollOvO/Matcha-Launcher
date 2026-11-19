// The fixture runs the real Source worker/message loop, with a private fake hook.
// Only explicit in-memory test events reach it. No desktop hook is installed.
#pragma once
#include "owned_input.hpp"
#include <atomic>
namespace owned_mouse {
inline std::atomic<HOOKPROC> callback{nullptr};inline std::atomic<DWORD> thread{0};
inline std::atomic<unsigned> installed{0},removed{0},chained{0},rejected{0};
inline constexpr UINT message=WM_APP+213;
struct Event {WPARAM kind;MSLLHOOKSTRUCT data{};int code=HC_ACTION;HANDLE ack=nullptr;LRESULT result=0;};
inline HHOOK WINAPI install(int kind,HOOKPROC proc,HINSTANCE module,DWORD tid){
    if(kind!=WH_MOUSE_LL||!proc||!module||tid)throw std::runtime_error("mouse hook ABI");++installed;
    if(rejected){--rejected;SetLastError(ERROR_ACCESS_DENIED);return nullptr;}
    callback=proc;thread=GetCurrentThreadId();return reinterpret_cast<HHOOK>(1);
}
inline BOOL WINAPI remove(HHOOK hook){if(hook!=reinterpret_cast<HHOOK>(1))throw std::runtime_error("mouse hook handle");callback=nullptr;thread=0;++removed;return TRUE;}
inline LRESULT WINAPI chain(HHOOK,int,WPARAM,LPARAM){++chained;return 1337;}
inline LRESULT WINAPI dispatch(const MSG* msg){if(msg->message!=message)return 0;auto* event=reinterpret_cast<Event*>(msg->lParam);auto cb=callback.load();if(cb)event->result=cb(event->code,event->kind,reinterpret_cast<LPARAM>(&event->data));SetEvent(event->ack);return 0;}
inline void deliver(WPARAM kind,DWORD flags=0,int code=HC_ACTION){Event event{};event.kind=kind;event.data.flags=flags;event.code=code;event.ack=CreateEventW(nullptr,TRUE,FALSE,nullptr);
    bool ok=event.ack&&thread&&PostThreadMessageW(thread,message,0,reinterpret_cast<LPARAM>(&event))&&WaitForSingleObject(event.ack,2000)==WAIT_OBJECT_0;
    if(event.ack)CloseHandle(event.ack);if(!ok||event.result!=1337)throw std::runtime_error("isolated physical event/chain");
}
inline UINT WINAPI send(UINT count,LPINPUT input,int size){auto result=owned_input::send(count,input,size);if(result&&callback&&input->type==INPUT_MOUSE){MSLLHOOKSTRUCT info{};info.flags=LLMHF_INJECTED;callback.load()(HC_ACTION,input->mi.dwFlags==MOUSEEVENTF_LEFTDOWN?WM_LBUTTONDOWN:WM_LBUTTONUP,reinterpret_cast<LPARAM>(&info));}return result;}
inline void isolate(HMODULE module){owned_input::isolate(module);
    if(!owned_input::replace(module,"SetWindowsHookExW",reinterpret_cast<void*>(&install))||!owned_input::replace(module,"UnhookWindowsHookEx",reinterpret_cast<void*>(&remove))||!owned_input::replace(module,"CallNextHookEx",reinterpret_cast<void*>(&chain))||!owned_input::replace(module,"DispatchMessageW",reinterpret_cast<void*>(&dispatch))||!owned_input::replace(module,"SendInput",reinterpret_cast<void*>(&send)))throw std::runtime_error("mouse hook isolation imports");
}
}
