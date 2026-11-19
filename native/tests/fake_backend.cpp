#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d9.h>
#include <cstdint>
extern "C" IDirect3D9* WINAPI fake_Direct3DCreate9(UINT sdk) {
    return sdk == 999 ? nullptr : reinterpret_cast<IDirect3D9*>(uintptr_t(0x12340000u + sdk));
}
extern "C" HRESULT WINAPI fake_Direct3DCreate9Ex(UINT sdk, IDirect3D9Ex** output) {
    if (!output) return D3DERR_INVALIDCALL;
    *output = nullptr;
    if (sdk == 999) return D3DERR_NOTAVAILABLE;
    *output = reinterpret_cast<IDirect3D9Ex*>(uintptr_t(0x56780000u + sdk)); return S_OK;
}
extern "C" IDirect3D9* WINAPI fake_Direct3DCreate9On12(UINT sdk, void*, UINT) { return fake_Direct3DCreate9(sdk); }
extern "C" HRESULT WINAPI fake_Direct3DCreate9On12Ex(UINT sdk, void*, UINT, IDirect3D9Ex** output) { return fake_Direct3DCreate9Ex(sdk,output); }
extern "C" void* WINAPI fake_Direct3DShaderValidatorCreate9() { return reinterpret_cast<void*>(uintptr_t(0x11223344)); }
extern "C" void WINAPI fake_PSGPError(void*,UINT) {}
extern "C" void WINAPI fake_PSGPSampleTexture(void*,UINT,void*,UINT,void*) {}
extern "C" int WINAPI fake_D3DPERF_BeginEvent(D3DCOLOR color,LPCWSTR name) { return int(color + (name ? lstrlenW(name) : 0)); }
extern "C" int WINAPI fake_D3DPERF_EndEvent() { return 42; }
extern "C" DWORD WINAPI fake_D3DPERF_GetStatus() { return 123; }
extern "C" BOOL WINAPI fake_D3DPERF_QueryRepeatFrame() { return TRUE; }
extern "C" void WINAPI fake_D3DPERF_SetMarker(D3DCOLOR,LPCWSTR) {}
extern "C" void WINAPI fake_D3DPERF_SetOptions(DWORD) {}
extern "C" void WINAPI fake_D3DPERF_SetRegion(D3DCOLOR,LPCWSTR) {}
extern "C" int WINAPI fake_DebugSetLevel() { return 19; }
extern "C" void WINAPI fake_DebugSetMute() {}
extern "C" int WINAPI fake_Direct3D9EnableMaximizedWindowedModeShim(UINT a) { return int(a); }
extern "C" void WINAPI fake_Direct3D9ForceHybridEnumeration(UINT) {}
extern "C" void WINAPI fake_DXVK_RegisterAnnotation(void*) {}
extern "C" void WINAPI fake_DXVK_UnRegisterAnnotation(void*) {}
