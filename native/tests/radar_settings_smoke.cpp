// Built only into the offline fixture DLL, never beside the shipped game UI.
#include "../plugins/flare.game-ui/plugin.cpp"
#include <filesystem>
#include <fstream>

namespace {
struct Preview {
    HDC dc = CreateCompatibleDC(nullptr);
    BITMAPINFO dib{};
    HBITMAP image{};
    HGDIOBJ previous{};
    int width,height;
    unsigned draws{};
    void* bytes{};
    HFONT fonts[FontSlots]{};

    Preview(int w,int h) : width(w),height(h) {
        dib.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);
        dib.bmiHeader.biWidth=w; dib.bmiHeader.biHeight=-h; dib.bmiHeader.biBitCount=32;
        dib.bmiHeader.biPlanes=1; dib.bmiHeader.biCompression=BI_RGB;
        image=CreateDIBSection(dc,&dib,DIB_RGB_COLORS,&bytes,nullptr,0);
        previous=SelectObject(dc,image);
        rect(0,0,w,h,{56,62,50});
        draws=0;
        SetBkMode(dc,TRANSPARENT);
    }
    ~Preview(){
        SelectObject(dc,GetStockObject(DEFAULT_GUI_FONT));
        for(auto f:fonts)if(f)DeleteObject(f);
        SelectObject(dc,previous);DeleteObject(image);DeleteDC(dc);
    }
    // Positive height = cell height, the same rule VGUI's Win32 fonts use for "tall".
    unsigned font(unsigned slot,int pixels,bool bold){
        if(slot>=FontSlots)return 0;
        if(!fonts[slot])fonts[slot]=CreateFontW(pixels,0,0,0,bold?700:400,0,0,0,DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,ANTIALIASED_QUALITY,DEFAULT_PITCH,L"Microsoft YaHei");
        return slot+1;
    }
    int measure(unsigned f,const wchar_t* text){
        SelectObject(dc,fonts[f-1]);SIZE size{};
        GetTextExtentPoint32W(dc,text,int(std::wcslen(text)),&size);
        return size.cx;
    }
    void rect(int x,int y,int w,int h,Color c){
        if(w<=0||h<=0)return;
        auto color=CreateSolidBrush(RGB(c.r,c.g,c.b)); RECT r{x,y,x+w,y+h};
        FillRect(dc,&r,color);DeleteObject(color);++draws;
    }
    void wedge(int x,int y,int w,int h,Color c){
        if(w<=0||h<=0)return;
        auto brush=CreateSolidBrush(RGB(c.r,c.g,c.b));
        auto oldBrush=SelectObject(dc,brush),oldPen=SelectObject(dc,GetStockObject(NULL_PEN));
        POINT p[3]{{x,y},{x+w,y},{x,y+h}};
        Polygon(dc,p,3);
        SelectObject(dc,oldBrush);SelectObject(dc,oldPen);DeleteObject(brush);++draws;
    }
    void ramp(int x,int y,int w,int h,Color c){rect(x,y,w/2,h,c);}
    void text(unsigned f,int x,int y,Color c,const wchar_t* p){
        SelectObject(dc,fonts[f-1]);SetTextColor(dc,RGB(c.r,c.g,c.b));
        TextOutW(dc,x,y,p,int(std::wcslen(p)));++draws;
    }
    bool save(const wchar_t* path){
        GdiFlush();
        BITMAPFILEHEADER h{};
        h.bfType=0x4d42;h.bfOffBits=sizeof(h)+sizeof(dib.bmiHeader);
        h.bfSize=h.bfOffBits+width*height*4;
        std::ofstream file(std::filesystem::path(path),std::ios::binary);
        file.write(reinterpret_cast<const char*>(&h),sizeof(h));
        file.write(reinterpret_cast<const char*>(&dib.bmiHeader),sizeof(dib.bmiHeader));
        file.write(static_cast<const char*>(bytes),width*height*4);
        return bool(file);
    }
};
}

extern "C" L4P_EXPORT unsigned L4P_CALL FixtureRadarSettings(const wchar_t* path) {
    auto& s=state();
    Guard guard(s.lock);
    auto& menu=s.menu;
    Presentation page;
    Preview preview(960,640);
    page.draw(preview,menu,preview.width,preview.height);
    if (preview.draws) return 1;
    if (!menu.toggle() || menu.page.count!=1 || std::wcscmp(menu.page.rows[0].label,L"物资雷达")) return 2;
    if (!menu.key(VK_RETURN,false) || std::wcscmp(menu.page.title,L"物资雷达")) return 3;
    menu.key(VK_DOWN,false); menu.key(VK_RETURN,false);
    if (std::wcscmp(menu.page.title,L"显示与数字")) return 4;
    menu.key(VK_DOWN,false);
    if (std::wcscmp(menu.page.rows[menu.selection].label,L"图标不透明度")) return 5;
    for(int i=0;i<10;++i)menu.key(VK_LEFT,i>0);
    if (menu.page.rows[menu.selection].value!=50 || std::wcscmp(menu.page.rows[menu.selection].value_text,L"50%")) return 6;
    page.draw(preview,menu,preview.width,preview.height);
    if (!preview.draws || !preview.save(path)) return 7;
    menu.key(VK_ESCAPE,false); menu.key(VK_ESCAPE,false); menu.key(VK_ESCAPE,false);
    if (menu.open) return 8;
    const auto drawn=preview.draws;
    page.draw(preview,menu,preview.width,preview.height);
    return drawn==preview.draws?0:9;
}
