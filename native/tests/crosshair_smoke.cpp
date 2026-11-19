// Targeted offline fixture. Uses its own config directory; never loads the game.
#define NOMINMAX
#include <windows.h>
#include <gdiplus.h>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include "l4p_plugin.h"
#include <nlohmann/json.hpp>
static int g_xhairStyle=0,g_xhairDrawH=1080;
static constexpr COLORREF kXhairColorRgb[]={RGB(255,255,255),RGB(255,80,80),RGB(80,255,80),RGB(80,200,255),RGB(255,220,60),RGB(220,90,255)};
static constexpr int kXhairColorCount=6;
#include "../plugins/skeeto.crosshair/drawing.inc"
using nlohmann::json;
static void check(bool ok,const char* why){if(!ok)throw std::runtime_error(why);}
static void L4P_CALL log(void*,uint32_t,const char*){}
int wmain(int argc,wchar_t** argv){
  try {
    check(argc==4,"dll, isolated directory and gallery path required");
    std::filesystem::path dir=argv[2];std::filesystem::create_directories(dir);
    check(!std::filesystem::exists(dir/L"config.json"),"use a fresh fixture directory");
    HMODULE dll=LoadLibraryW(argv[1]);check(dll,"load DLL");
    auto get=reinterpret_cast<L4P_GetPluginApiFn>(GetProcAddress(dll,"L4P_GetPluginApi"));check(get,"export");
    L4P_PluginApiV1 plugin{1,sizeof(plugin)};check(get(1,&plugin)==L4P_OK,"ABI");
    std::string folder=dir.u8string();L4P_HostApiV1 host{1,sizeof(host),nullptr,log,folder.c_str(),"{}"};
    check(plugin.init(&host)==L4P_OK,"init");
    char output[4096]{};uint32_t size=0;
    check(plugin.invoke("configure","{\"style\":1}",output,1,&size)==L4P_BUFFER_TOO_SMALL,"small buffer");
    check(!std::filesystem::exists(dir/L"config.json"),"small buffer has no write");
    check(plugin.invoke("configure","{\"style\":20}",output,sizeof(output),&size)==L4P_BAD_ARGUMENT,"invalid style");
    check(plugin.invoke("configure","{\"size\":1.5}",output,sizeof(output),&size)==L4P_BAD_ARGUMENT,"invalid integer");
    check(plugin.invoke("status","{}",output,sizeof(output),&size)==L4P_OK,"status");
    check(!json::parse(output).at("visible").get<bool>(),"hidden without game window");
    for(int i=0;i<20;++i){auto args=json{{"style",i},{"color",2},{"size",150},{"alpha",90}}.dump();check(plugin.invoke("configure",args.c_str(),output,sizeof(output),&size)==L4P_OK,"configure");}
    std::ifstream saved(dir/L"config.json");auto config=json::parse(saved);check(config.at("style")==19,"saved settings");saved.close();
    HWND overlay=FindWindowW(L"Flare.Skeeto.StaticCrosshair",nullptr);check(overlay && !IsWindowVisible(overlay),"hidden overlay owned");
    plugin.shutdown();check(!IsWindow(overlay),"shutdown destroys window");
    host.config_json="{\"style\":19,\"size\":150,\"alpha\":90,\"color\":2}";
    check(plugin.init(&host)==L4P_OK,"reinitialize persisted settings");plugin.shutdown();FreeLibrary(dll);

    ULONG_PTR token;Gdiplus::GdiplusStartupInput startup;check(Gdiplus::GdiplusStartup(&token,&startup,nullptr)==Gdiplus::Ok,"gallery startup");
    {
      Gdiplus::Bitmap bitmap(800,560,PixelFormat32bppARGB);
      {
        Gdiplus::Graphics g(&bitmap);g.Clear(Gdiplus::Color(255,22,27,31));g.SetSmoothingMode(Gdiplus::SmoothingModeAntiAlias);g.SetPixelOffsetMode(Gdiplus::PixelOffsetModeHalf);
        Gdiplus::Font font(L"Segoe UI",12);Gdiplus::SolidBrush ink(Gdiplus::Color(255,205,197,173));
        for(int i=0;i<20;++i){g_xhairStyle=i;g_xhairCurrent=kXhairFactory[i];g_xhairCurrent.size=180;float x=float(i%5*160+80),y=float(i/5*140+64);XhairDrawAll(g,x,y);auto label=std::to_wstring(i);g.DrawString(label.c_str(),-1,&font,Gdiplus::PointF(x-5,y+40),&ink);}
      }
      UINT bytes=0,count=0;Gdiplus::GetImageEncodersSize(&count,&bytes);std::vector<BYTE> storage(bytes);auto enc=reinterpret_cast<Gdiplus::ImageCodecInfo*>(storage.data());Gdiplus::GetImageEncoders(count,bytes,enc);bool found=false;
      for(UINT i=0;i<count;++i)if(wcscmp(enc[i].MimeType,L"image/png")==0){check(bitmap.Save(argv[3],&enc[i].Clsid,nullptr)==Gdiplus::Ok,"save gallery");found=true;break;}
      check(found,"PNG encoder");
    }
    Gdiplus::GdiplusShutdown(token);
    std::cout<<"PASS: ABI/init, hidden without game, 20 settings, capacity/no-write, bounds, persistence, shutdown/reinit, 20-style PNG\n";return 0;
  }catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}
}
