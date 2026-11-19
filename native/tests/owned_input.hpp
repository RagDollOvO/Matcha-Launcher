// Offline fixtures only: replace this fixture's private Source DLL imports.
// Every input request is recorded in memory; no event reaches the desktop.
#pragma once
#include <windows.h>
#include <vector>
#include <map>
#include <cstring>
#include <stdexcept>
namespace owned_input {
inline bool foreground=true;inline int rejected=0;
inline std::map<int,bool> held;inline std::vector<INPUT> events;inline unsigned attempts=0;
inline UINT WINAPI send(UINT count,LPINPUT input,int size){++attempts;if(count!=1||!input||size!=sizeof(INPUT))throw std::runtime_error("SendInput ABI");if(rejected){--rejected;return 0;}events.push_back(*input);return 1;}
inline HWND WINAPI window(){return reinterpret_cast<HWND>(1);}
inline DWORD WINAPI process(HWND,DWORD* pid){*pid=GetCurrentProcessId()+(foreground?0:1);return 1;}
inline SHORT WINAPI key(int vk){return held[vk]?SHORT(0x8000):0;}
inline bool replace(HMODULE module,const char* name,void* next){auto base=reinterpret_cast<unsigned char*>(module);auto dos=reinterpret_cast<IMAGE_DOS_HEADER*>(base);auto nt=reinterpret_cast<IMAGE_NT_HEADERS*>(base+dos->e_lfanew);
    auto imports=reinterpret_cast<IMAGE_IMPORT_DESCRIPTOR*>(base+nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT].VirtualAddress);
    for(auto d=imports;d->Name;++d){if(!d->OriginalFirstThunk)continue;auto original=reinterpret_cast<IMAGE_THUNK_DATA*>(base+d->OriginalFirstThunk),current=reinterpret_cast<IMAGE_THUNK_DATA*>(base+d->FirstThunk);
        for(;original->u1.AddressOfData;++original,++current){if(IMAGE_SNAP_BY_ORDINAL(original->u1.Ordinal))continue;auto entry=reinterpret_cast<IMAGE_IMPORT_BY_NAME*>(base+original->u1.AddressOfData);if(strcmp(reinterpret_cast<const char*>(entry->Name),name))continue;
            DWORD old=0;if(!VirtualProtect(&current->u1.Function,sizeof(void*),PAGE_READWRITE,&old))return false;current->u1.Function=reinterpret_cast<ULONG_PTR>(next);DWORD ignored=0;VirtualProtect(&current->u1.Function,sizeof(void*),old,&ignored);return true;}}
    return false;
}
inline void isolate(HMODULE module){
    if(!replace(module,"SendInput",reinterpret_cast<void*>(&send))||!replace(module,"GetForegroundWindow",reinterpret_cast<void*>(&window))||!replace(module,"GetWindowThreadProcessId",reinterpret_cast<void*>(&process))||!replace(module,"GetAsyncKeyState",reinterpret_cast<void*>(&key)))throw std::runtime_error("input isolation imports");
}
}
