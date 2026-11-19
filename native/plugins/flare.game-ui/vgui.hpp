#pragma once
#include <windows.h>
#include <cstdint>
#include <cstring>
#include "menu.hpp"

namespace game_ui {
inline bool accessible(const void* p, size_t size, DWORD permission = 0) {
    MEMORY_BASIC_INFORMATION m{};
    if (!p || !VirtualQuery(p, &m, sizeof(m)) || m.State != MEM_COMMIT ||
        (m.Protect & (PAGE_GUARD | PAGE_NOACCESS)) || (permission && !(m.Protect & permission))) return false;
    return size <= m.RegionSize-(uintptr_t(p)-uintptr_t(m.BaseAddress));
}
inline bool executable(const void* p) {
    return accessible(p, 1, PAGE_EXECUTE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY);
}
inline bool profile(HMODULE module, DWORD stamp, DWORD size) {
    auto* base = reinterpret_cast<const uint8_t*>(module);
    if (!accessible(base, 4096)) return false;
    auto& dos = *reinterpret_cast<const IMAGE_DOS_HEADER*>(base);
    if (dos.e_magic != IMAGE_DOS_SIGNATURE || dos.e_lfanew < 64 || dos.e_lfanew > 0xe00) return false;
    auto& nt = *reinterpret_cast<const IMAGE_NT_HEADERS32*>(base+dos.e_lfanew);
    return nt.Signature == IMAGE_NT_SIGNATURE && nt.FileHeader.Machine == IMAGE_FILE_MACHINE_I386 &&
        nt.FileHeader.TimeDateStamp == stamp && nt.OptionalHeader.SizeOfImage == size;
}
inline void* iface(HMODULE module, const char* name) {
    using Factory = void* (__cdecl*)(const char*,int*);
    auto f = module ? reinterpret_cast<Factory>(GetProcAddress(module, "CreateInterface")) : nullptr;
    return f ? f(name, nullptr) : nullptr;
}
inline void** table(void* object, unsigned count) {
    if (!accessible(object, sizeof(void*))) return nullptr;
    auto** at = *static_cast<void***>(object);
    return accessible(at, count*sizeof(void*)) ? at : nullptr;
}
template<class F> F method(void** v, unsigned slot) {
    return v && executable(v[slot]) ? reinterpret_cast<F>(v[slot]) : nullptr;
}

struct Surface {
    using Native = void (__thiscall*)(void*);
    using ColorFn = void (__thiscall*)(void*,int,int,int,int);
    using Int4 = void (__thiscall*)(void*,int,int,int,int);
    using Font = unsigned (__thiscall*)(void*);
    using Glyphs = bool (__thiscall*)(void*,unsigned,const char*,int,int,int,int,int,int,int);
    using Tall = int (__thiscall*)(void*,unsigned);
    using SelectFont = void (__thiscall*)(void*,unsigned);
    using Position = void (__thiscall*)(void*,int,int);
    using Print = void (__thiscall*)(void*,const wchar_t*,int,int);
    using Measure = void (__thiscall*)(void*,unsigned,const wchar_t*,int&,int&);
    using GetAlpha = float (__thiscall*)(void*);
    using SetAlpha = void (__thiscall*)(void*,float);
    // Retail Surface031 texture calls, the same ones the supply radar draws its HUD with.
    using Upload = void (__thiscall*)(void*,int,const unsigned char*,int,int);
    using UseTexture = void (__thiscall*)(void*,int);
    using TextureId = bool (__thiscall*)(void*,int);
    using NewTexture = int (__thiscall*)(void*,bool);
    // Two white coverage masks, tinted by the draw colour: a wedge (the top-left half of a
    // box, one per size) and a left-to-right ramp stretched to any size.
    static constexpr int MaxWedge = 128, RampWidth = 256, Masks = 6;
    enum MaskKind { WedgeMask, RampMask };
    struct Mask { int w, h, kind, id; unsigned used; };

    void* surface{};
    const uint8_t* drawing{};
    Native start{}, end{}, flush{};
    ColorFn drawColor{}, textColor{};
    Int4 filledRect{};
    Font createFont{};
    Glyphs glyphs{};
    Tall tall{};
    SelectFont selectFont{};
    Position position{};
    Print print{};
    Measure textSize{};
    GetAlpha getAlpha{};
    SetAlpha setAlpha{};
    Upload upload{};
    UseTexture useTexture{};
    Int4 texturedRect{};
    TextureId validTexture{}, releaseTexture{};
    NewTexture newTexture{};
    Mask masks[Masks]{};
    unsigned frame{};
    bool shapes{};
    unsigned char coverage[MaxWedge*MaxWedge*4]{};
    unsigned (__thiscall *root)(void*){};
    void (__thiscall *push)(void*,unsigned,bool){};
    void (__thiscall *pop)(void*,unsigned){};
    unsigned panel{};
    bool owns{}, unsupported{};
    int pixels[FontSlots]{};
    bool bolds[FontSlots]{};
    unsigned fonts[FontSlots]{};
    float previousAlpha{1};

    // Exact retail profile; offsets are verified against the begin/end pair
    // and the relocated drawing-state byte before making either call.
    bool resolve() {
        if (surface) return true;
        if (unsupported) return false;
        auto module = GetModuleHandleW(L"vguimatsurface.dll");
        if (!module) return false;
        unsupported = true;
        if (!profile(module, 0x6a440da4, 0x172000)) return false;
        auto* base = reinterpret_cast<const uint8_t*>(module);
        auto* begin = base+0xb160;
        auto* finish = base+0xb370;
        auto* flag = base+0x1280c8;
        constexpr unsigned char prologue[]{0x55,0x8b,0xec,0x6a,0xff,0x68};
        auto check = [&](const uint8_t* fn, unsigned offset, uint8_t value) {
            if (!accessible(fn, offset+7, PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY) ||
                std::memcmp(fn, prologue, sizeof(prologue)) || fn[offset] != 0xc6 ||
                fn[offset+1] != 5 || fn[offset+6] != value) return false;
            uintptr_t operand{};
            std::memcpy(&operand, fn+offset+2, sizeof(operand));
            return operand == uintptr_t(flag);
        };
        if (!check(begin, 0xa1, 1) || !check(finish, 0x9a, 0) ||
            !accessible(flag, 1, PAGE_READWRITE | PAGE_WRITECOPY)) return false;
        void* object = iface(module, "VGUI_Surface031");
        auto** v = table(object, 107);
        start = reinterpret_cast<Native>(const_cast<uint8_t*>(begin));
        end = reinterpret_cast<Native>(const_cast<uint8_t*>(finish));
        drawing = flag;
        root = method<decltype(root)>(v,6); push = method<decltype(push)>(v,8); pop = method<decltype(pop)>(v,9);
        flush = method<Native>(v,24); drawColor = method<ColorFn>(v,11); filledRect = method<Int4>(v,12);
        selectFont = method<SelectFont>(v,17); textColor = method<ColorFn>(v,19); position = method<Position>(v,20);
        print = method<Print>(v,22); createFont = method<Font>(v,63); glyphs = method<Glyphs>(v,64);
        tall = method<Tall>(v,66); textSize = method<Measure>(v,72);
        getAlpha = method<GetAlpha>(v,106); setAlpha = method<SetAlpha>(v,105);
        if (!root || !push || !pop || !flush || !drawColor || !filledRect || !selectFont || !textColor ||
            !position || !print || !createFont || !glyphs || !tall || !textSize || !getAlpha || !setAlpha) return false;
        // Shaped edges are optional: without the verified texture contract they fall back to stepped rects.
        upload = method<Upload>(v,28); useTexture = method<UseTexture>(v,29); texturedRect = method<Int4>(v,31);
        validTexture = method<TextureId>(v,32); releaseTexture = method<TextureId>(v,33); newTexture = method<NewTexture>(v,34);
        shapes = upload && useTexture && texturedRect && validTexture && releaseTexture && newTexture &&
            textureContract(base, v);
        surface = object;
        unsupported = false;
        return true;
    }
    // Slot 28 takes exactly four stack arguments in this build (RET 10h), unlike the SDK's six;
    // slot 33 forwards one ID to the texture dictionary's destroy method. Same bytes the radar checks.
    static bool textureContract(const uint8_t* base, void** v) {
        static constexpr unsigned char uploadBytes[]{0x55,0x8b,0xec,0xe8,0x58,0xd6,0,0,0x8b,0x4d,0x14,0x8b,0x10,0x8b,0x52,0x40,0x6a,0,0x6a,0,
            0x51,0x8b,0x4d,0x10,0x51,0x8b,0x4d,0x0c,0x51,0x8b,0x4d,8,0x51,0x8b,0xc8,0xff,0xd2,0x5d,0xc2,0x10,0};
        static constexpr unsigned char releaseBytes[]{0x55,0x8b,0xec,0xe8,0x28,0xec,0,0,0x8b,0x4d,0x08,0x8b,0x10,0x8b,0x52,0x04,
            0x51,0x8b,0xc8,0xff,0xd2,0x32,0xc0,0x5d,0xc2,0x04,0};
        auto same = [&](unsigned slot, unsigned rva, const unsigned char* bytes, size_t n) {
            return v[slot] == base + rva &&
                accessible(base + rva, n, PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY) &&
                !std::memcmp(base + rva, bytes, n);
        };
        return same(28, 0x9a60, uploadBytes, sizeof(uploadBytes)) && same(33, 0x8490, releaseBytes, sizeof(releaseBytes));
    }
    bool begin() {
        if (panel) return true;
        if (!resolve()) return false;
        unsigned target = root(surface);
        if (!target) return false;
        owns = *drawing == 0;
        if (owns) { start(surface); if (!*drawing) { owns = false; return false; } }
        push(surface,target,false);
        panel = target;
        previousAlpha = getAlpha(surface);
        setAlpha(surface,1.f);
        // A video mode change drops procedural textures; one probe per frame notices it.
        ++frame;
        if (shapes) for (auto& m : masks) if (m.id) {
            if (!validTexture(surface, m.id)) for (auto& k : masks) k = {};
            break;
        }
        return true;
    }
    void finish() {
        if (!panel) return;
        flush(surface); pop(surface,panel); setAlpha(surface,previousAlpha);
        if (owns) end(surface);
        panel = 0; owns = false;
    }
    // One handle per slot. A size change (resolution) builds a new glyph set once;
    // the steady state is a single tall() check per slot per frame.
    unsigned font(unsigned slot, int size, bool bold) {
        if (slot >= FontSlots) return 0;
        auto& font = fonts[slot];
        const bool same = pixels[slot] == size && bolds[slot] == bold;
        if (same && font && tall(surface,font)>0) return font;
        // Attempt one glyph set per size, retry after a real font reset.
        if (same && !font) return 0;
        pixels[slot] = size; bolds[slot] = bold;
        font = createFont(surface);
        if (font && !glyphs(surface,font,"Microsoft YaHei",size,bold?700:400,0,0,0x10,0,0xffff)) font=0;
        return font;
    }
    int measure(unsigned font, const wchar_t* s) const {
        int w = 0, h = 0; textSize(surface,font,s,w,h); return w;
    }
    void rect(int x,int y,int w,int h,Color c) const {
        if (w <= 0 || h <= 0 || c.a <= 0) return;
        drawColor(surface,c.r,c.g,c.b,c.a); filledRect(surface,x,y,x+w,y+h);
    }
    // Supersampled coverage of the triangle above the box's falling diagonal.
    void paintWedge(int w, int h) {
        for (int y = 0; y < h; ++y) for (int x = 0; x < w; ++x) {
            int inside = 0;
            for (int sy = 0; sy < 4; ++sy) for (int sx = 0; sx < 4; ++sx)
                inside += (float(x) + (float(sx) + .5f)/4.f)/float(w) + (float(y) + (float(sy) + .5f)/4.f)/float(h) <= 1.f;
            unsigned char* p = coverage + (y*w + x)*4;
            p[0] = p[1] = p[2] = 255; p[3] = static_cast<unsigned char>(inside*255/16);
        }
    }
    void paintRamp() {
        for (int x = 0; x < RampWidth; ++x) {
            unsigned char* p = coverage + x*4;
            // Smoothstep: no visible crease where the solid scrim meets the fade.
            const float u = float(x)/float(RampWidth - 1), k = 1.f - u*u*(3.f - 2.f*u);
            p[0] = p[1] = p[2] = 255; p[3] = static_cast<unsigned char>(k*255.f + .5f);
        }
    }
    // Built once per size (a resolution change brings new sizes) and kept.
    const Mask* mask(int w, int h, int kind) {
        for (auto& m : masks) if (m.id && m.w == w && m.h == h && m.kind == kind) { m.used = frame; return &m; }
        Mask* slot = nullptr;
        for (auto& m : masks) if (!m.id) { slot = &m; break; }
        if (!slot) {
            slot = &masks[0];
            for (auto& m : masks) if (m.used < slot->used) slot = &m;
            if (validTexture(surface, slot->id)) releaseTexture(surface, slot->id);
            *slot = {};
        }
        const int id = newTexture(surface, true);
        if (!id) return nullptr;
        if (kind == WedgeMask) paintWedge(w, h); else paintRamp();
        upload(surface, id, coverage, w, h);
        *slot = {w, h, kind, id, frame};
        return slot;
    }
    void textured(const Mask& m, int x, int y, int w, int h, Color c) const {
        drawColor(surface, c.r, c.g, c.b, c.a); useTexture(surface, m.id);
        texturedRect(surface, x, y, x + w, y + h);
    }
    void wedge(int x, int y, int w, int h, Color c) {
        if (w <= 0 || h <= 0 || c.a <= 0) return;
        if (shapes && w <= MaxWedge && h <= MaxWedge)
            if (const auto* m = mask(w, h, WedgeMask)) { textured(*m, x, y, w, h, c); return; }
        // Stepped fallback in two-pixel bands.
        for (int j = 0; j < h; j += 2) {
            const int n = std::min(2, h - j);
            rect(x, y + j, w - w*(2*j + n)/(2*h), n, c);
        }
    }
    void ramp(int x, int y, int w, int h, Color c) {
        if (w <= 0 || h <= 0 || c.a <= 0) return;
        if (shapes) if (const auto* m = mask(RampWidth, 1, RampMask)) { textured(*m, x, y, w, h, c); return; }
        for (int i = 0; i < 8; ++i) rect(x + w*i/8, y, w*(i + 1)/8 - w*i/8, h, fade(c, c.a*(15 - 2*i)/16));
    }
    void text(unsigned font,int x,int y,Color c,const wchar_t* s) const {
        if (!*s || c.a <= 0) return;
        selectFont(surface,font); textColor(surface,c.r,c.g,c.b,c.a); position(surface,x,y);
        print(surface,s,int(std::wcslen(s)),0);
    }
};
}
