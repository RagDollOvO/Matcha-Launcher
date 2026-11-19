// Offline look at the in-game settings drawer. Renders sample pages with the real
// Presentation code through GDI and writes PNGs; it never loads or touches the game.
//
//   .tools/llvm-mingw-*/bin/i686-w64-mingw32-clang++ -std=c++17 -O1 -municode -Inative/include ^
//     native/tests/game_ui_preview.cpp -lgdi32 -lgdiplus -o native/build-x86/fixtures/game_ui_preview.exe
//   native/build-x86/fixtures/game_ui_preview.exe <output-directory>
//
// GDI fonts are created with a positive height (cell height), the same rule VGUI's
// Win32 fonts use for "tall", so sizes and spacing match the game closely.
#define NOMINMAX
#include <windows.h>
#include <gdiplus.h>
#include "../plugins/flare.game-ui/menu.hpp"
#include <cmath>
#include <cstdio>
#include <initializer_list>
#include <string>

using namespace game_ui;

namespace {
struct Canvas {
    HDC dc = CreateCompatibleDC(nullptr);
    HBITMAP image{};
    HGDIOBJ previous{};
    uint32_t* pixels{};
    int width, height;
    unsigned draws{};
    HFONT fonts[FontSlots]{};
    int sizes[FontSlots]{};

    Canvas(int w, int h) : width(w), height(h) {
        BITMAPINFO dib{};
        dib.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        dib.bmiHeader.biWidth = w; dib.bmiHeader.biHeight = -h; dib.bmiHeader.biBitCount = 32;
        dib.bmiHeader.biPlanes = 1; dib.bmiHeader.biCompression = BI_RGB;
        void* bits{};
        image = CreateDIBSection(dc, &dib, DIB_RGB_COLORS, &bits, nullptr, 0);
        pixels = static_cast<uint32_t*>(bits);
        previous = SelectObject(dc, image);
        SetBkMode(dc, TRANSPARENT);
        scene();
    }
    ~Canvas() {
        SelectObject(dc, GetStockObject(DEFAULT_GUI_FONT));
        for (auto f : fonts) if (f) DeleteObject(f);
        SelectObject(dc, previous); DeleteObject(image); DeleteDC(dc);
    }
    // A stand-in for a foggy L4D2 street: graded sky, building silhouettes, HUD and crosshair.
    void scene() {
        for (int y = 0; y < height; ++y) {
            const float k = float(y) / float(height);
            const int r = int(78 - 46*k), g = int(84 - 50*k), b = int(74 - 46*k);
            for (int x = 0; x < width; ++x) pixels[y*width + x] = uint32_t(r << 16 | g << 8 | b);
        }
        const int base = height*62/100;
        for (int i = 0; i < 14; ++i) {
            const int bw = width/10 + (i*37 % 7)*width/90, bh = height/6 + (i*53 % 9)*height/40;
            fill(i*width/12 - width/30, base - bh, bw, bh + height, 36 + i%3*4, 40 + i%3*4, 36 + i%3*3);
        }
        fill(0, base + height/9, width, height, 26, 28, 25);
        const int cx = width/2, cy = height/2, arm = height/90 + 4;
        fill(cx - arm*2, cy - 1, arm, 2, 220, 220, 220); fill(cx + arm, cy - 1, arm, 2, 220, 220, 220);
        fill(cx - 1, cy - arm*2, 2, arm, 220, 220, 220); fill(cx - 1, cy + arm, 2, arm, 220, 220, 220);
        const int u = height/40;
        fill(width - u*14, height - u*4, u*12, u*2, 20, 20, 20);
        fill(width - u*13, height - u*3 - u/2, u*7, u, 200, 200, 190);
    }
    void fill(int x, int y, int w, int h, int r, int g, int b) {
        const int x0 = std::max(0, x), y0 = std::max(0, y), x1 = std::min(width, x + w), y1 = std::min(height, y + h);
        for (int yy = y0; yy < y1; ++yy) for (int xx = x0; xx < x1; ++xx) pixels[yy*width + xx] = uint32_t(r << 16 | g << 8 | b);
    }

    unsigned font(unsigned slot, int tall, bool bold) {
        if (slot >= FontSlots) return 0;
        if (sizes[slot] != tall) {
            if (fonts[slot]) DeleteObject(fonts[slot]);
            fonts[slot] = CreateFontW(tall, 0, 0, 0, bold ? 700 : 400, 0, 0, 0, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
                CLIP_DEFAULT_PRECIS, ANTIALIASED_QUALITY, DEFAULT_PITCH, L"Microsoft YaHei");
            sizes[slot] = tall;
        }
        return slot + 1;
    }
    int measure(unsigned f, const wchar_t* text) {
        SelectObject(dc, fonts[f - 1]); SIZE size{};
        GetTextExtentPoint32W(dc, text, int(std::wcslen(text)), &size);
        return size.cx;
    }
    void rect(int x, int y, int w, int h, Color c) {
        if (w <= 0 || h <= 0 || c.a <= 0) return;
        GdiFlush();
        const int x0 = std::max(0, x), y0 = std::max(0, y), x1 = std::min(width, x + w), y1 = std::min(height, y + h);
        for (int yy = y0; yy < y1; ++yy) for (int xx = x0; xx < x1; ++xx) {
            auto& p = pixels[yy*width + xx];
            auto mix = [&](int src, int shift) { return (src*c.a + int((p >> shift) & 255)*(255 - c.a)) / 255; };
            p = uint32_t(mix(c.r, 16) << 16 | mix(c.g, 8) << 8 | mix(c.b, 0));
        }
        ++draws;
    }
    void blend(int xx, int yy, Color c, int a) {
        auto& p = pixels[yy*width + xx];
        auto mix = [&](int src, int shift) { return (src*a + int((p >> shift) & 255)*(255 - a)) / 255; };
        p = uint32_t(mix(c.r, 16) << 16 | mix(c.g, 8) << 8 | mix(c.b, 0));
    }
    // Same coverage the game's wedge mask carries: the half above the falling diagonal.
    void wedge(int x, int y, int w, int h, Color c) {
        if (w <= 0 || h <= 0 || c.a <= 0) return;
        GdiFlush();
        for (int yy = std::max(0, y); yy < std::min(height, y + h); ++yy)
            for (int xx = std::max(0, x); xx < std::min(width, x + w); ++xx) {
                int inside = 0;
                for (int sy = 0; sy < 4; ++sy) for (int sx = 0; sx < 4; ++sx)
                    inside += (float(xx - x) + (float(sx) + .5f)/4.f)/float(w) + (float(yy - y) + (float(sy) + .5f)/4.f)/float(h) <= 1.f;
                if (inside) blend(xx, yy, c, c.a*inside/16);
            }
        ++draws;
    }
    void ramp(int x, int y, int w, int h, Color c) {
        if (w <= 0 || h <= 0 || c.a <= 0) return;
        GdiFlush();
        for (int yy = std::max(0, y); yy < std::min(height, y + h); ++yy)
            for (int xx = std::max(0, x); xx < std::min(width, x + w); ++xx)
                [&] { const float u = float(xx - x)/float(std::max(1, w - 1)), k = 1.f - u*u*(3.f - 2.f*u);
                      blend(xx, yy, c, int(float(c.a)*k + .5f)); }();
        ++draws;
    }
    void text(unsigned f, int x, int y, Color c, const wchar_t* s) {
        if (!*s) return;
        SelectObject(dc, fonts[f - 1]); SetTextColor(dc, RGB(c.r, c.g, c.b));
        TextOutW(dc, x, y, s, int(std::wcslen(s)));
        ++draws;
    }
    bool save(const std::wstring& path) {
        GdiFlush();
        CLSID png{};
        UINT count = 0, bytes = 0;
        Gdiplus::GetImageEncodersSize(&count, &bytes);
        std::string buffer(bytes, '\0');
        auto* codecs = reinterpret_cast<Gdiplus::ImageCodecInfo*>(buffer.data());
        Gdiplus::GetImageEncoders(count, bytes, codecs);
        for (UINT i = 0; i < count; ++i) if (!std::wcscmp(codecs[i].MimeType, L"image/png")) png = codecs[i].Clsid;
        Gdiplus::Bitmap bitmap(image, nullptr);
        return bitmap.Save(path.c_str(), &png, nullptr) == Gdiplus::Ok;
    }
};

L4P_GameMenuRowV1 row(uint32_t kind, const wchar_t* label, int value = 0, int minimum = 0, int maximum = 1,
    int step = 1, const wchar_t* text = L"", bool disabled = false) {
    static uint32_t next = 1;
    L4P_GameMenuRowV1 r{};
    r.kind = kind; r.id = next++; r.disabled = disabled;
    r.value = value; r.minimum = minimum; r.maximum = maximum; r.step = step;
    copy(r.label, label); copy(r.value_text, text);
    return r;
}
L4P_GameMenuRowV1 toggle(const wchar_t* label, bool on, bool disabled = false) { return row(L4P_MENU_TOGGLE, label, on, 0, 1, 1, L"", disabled); }
L4P_GameMenuRowV1 range(const wchar_t* label, int v, int lo, int hi, const wchar_t* text) { return row(L4P_MENU_RANGE, label, v, lo, hi, 1, text); }
L4P_GameMenuRowV1 choice(const wchar_t* label, int v, int hi, const wchar_t* text) { return row(L4P_MENU_CHOICE, label, v, 0, hi, 1, text); }
L4P_GameMenuRowV1 link(const wchar_t* label, const wchar_t* text = L"") { return row(L4P_MENU_LINK, label, 0, 0, 1, 1, text); }
L4P_GameMenuRowV1 action(const wchar_t* label) { return row(L4P_MENU_ACTION, label); }

struct Scene {
    const wchar_t* name;
    int width, height;
    uint32_t active;
    std::initializer_list<const wchar_t*> trail;
    const wchar_t* title;
    const wchar_t* note;
    std::initializer_list<L4P_GameMenuRowV1> rows;
    unsigned selection;
    bool failed;
};

bool render(const Scene& s, const std::wstring& folder) {
    Menu menu;
    menu.open = true; menu.opens = 1; menu.revision = 1; menu.active = s.active;
    menu.depth = 0;
    for (auto* t : s.trail) copy(menu.trail[menu.depth++], t);
    copy(menu.page.title, s.title); copy(menu.page.note, s.note);
    for (const auto& r : s.rows) menu.page.rows[menu.page.count++] = r;
    menu.selection = s.selection; menu.failed = s.failed;
    Canvas canvas(s.width, s.height);
    Presentation presentation;
    presentation.draw(canvas, menu, s.width, s.height);
    const unsigned warm = canvas.draws;
    std::wprintf(L"%ls  %dx%d  %u primitives\n", s.name, s.width, s.height, warm);
    return warm && canvas.save(folder + L"\\" + s.name + L".png");
}
}

int wmain(int argc, wchar_t** argv) {
    if (argc != 2) { std::fwprintf(stderr, L"usage: game_ui_preview <output-directory>\n"); return 2; }
    Gdiplus::GdiplusStartupInput input;
    ULONG_PTR token{};
    if (Gdiplus::GdiplusStartup(&token, &input, nullptr) != Gdiplus::Ok) return 3;
    CreateDirectoryW(argv[1], nullptr);
    const Scene scenes[] = {
        {L"1-root-1080p", 1920, 1080, 0, {}, L"抹茶模组设置", L"选择一个已加载的模块",
            {link(L"物资雷达"), link(L"静态准星"), link(L"分类音量"), link(L"视角倾斜")}, 0, false},
        {L"2-module-1080p", 1920, 1080, 1, {}, L"物资雷达", L"本地战役、生还者模式与写实",
            {toggle(L"启用物资雷达", true), link(L"显示与数字"), link(L"选择显示的物资", L"12 项"), link(L"物品发光"), link(L"位置编辑")}, 1, false},
        {L"3-display-1080p", 1920, 1080, 1, {L"物资雷达"}, L"显示与数字", L"调整 HUD 的读数与外观",
            {range(L"探测距离", 30, 5, 60, L"30 米"), range(L"图标不透明度", 80, 0, 100, L"80%"), range(L"武器图标不透明度", 60, 0, 100, L"60%"),
             range(L"整体缩放", 100, 50, 200, L"100%"), toggle(L"显示方向", true), toggle(L"显示数量", true), toggle(L"显示高差", false),
             toggle(L"显示未识别物资", false), toggle(L"问号提示", true), range(L"行数", 2, 1, 4, L"2"), range(L"列数", 4, 1, 8, L"4"),
             toggle(L"旁观时显示", false), toggle(L"读取地图物资信息", true), choice(L"数字字体", 0, 2, L"经典")}, 1, false},
        {L"4-glow-1080p", 1920, 1080, 1, {L"物资雷达", L"物品发光"}, L"医疗物品", L"分别调整发光开关和颜色",
            {toggle(L"急救包", true), choice(L"急救包颜色", 0, 6, L"白色"), toggle(L"止痛药", true), choice(L"止痛药颜色", 2, 6, L"绿色"),
             toggle(L"肾上腺素", false), choice(L"肾上腺素颜色", 1, 6, L"红色"), toggle(L"电击器", true, true), choice(L"电击器颜色", 3, 6, L"蓝色")}, 3, false},
        {L"5-display-720p", 1280, 720, 1, {L"物资雷达"}, L"显示与数字", L"调整 HUD 的读数与外观",
            {range(L"探测距离", 30, 5, 60, L"30 米"), range(L"图标不透明度", 80, 0, 100, L"80%"), range(L"武器图标不透明度", 60, 0, 100, L"60%"),
             range(L"整体缩放", 100, 50, 200, L"100%"), toggle(L"显示方向", true), toggle(L"显示数量", true), toggle(L"显示高差", false),
             toggle(L"显示未识别物资", false), toggle(L"问号提示", true), range(L"行数", 2, 1, 4, L"2"), range(L"列数", 4, 1, 8, L"4"),
             toggle(L"旁观时显示", false), toggle(L"读取地图物资信息", true), choice(L"数字字体", 0, 2, L"经典")}, 11, false},
        {L"6-actions-1440p-failed", 2560, 1440, 1, {L"物资雷达", L"位置编辑"}, L"医疗物品", L"选择物资后，用方向键移动，Enter 保存",
            {action(L"急救包"), action(L"止痛药"), action(L"肾上腺素"), action(L"电击器")}, 0, true},
    };
    bool ok = true;
    for (const auto& s : scenes) ok = render(s, argv[1]) && ok;
    Gdiplus::GdiplusShutdown(token);
    return ok ? 0 : 1;
}
