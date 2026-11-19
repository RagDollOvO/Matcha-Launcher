#pragma once
#include "l4p_game_ui.h"
#include <algorithm>
#include <cstdint>
#include <cwchar>

namespace game_ui {
constexpr unsigned MaxModules = 16, MaxDepth = 8;

template<size_t N> bool copy(wchar_t (&to)[N], const wchar_t* from) {
    if (!from) return false;
    size_t n = 0;
    for (; n + 1 < N && from[n]; ++n) to[n] = from[n];
    to[n] = 0;
    return from[n] == 0;
}
struct Module {
    uint32_t token{};
    char id[65]{};
    wchar_t title[64]{};
    L4P_GameUiModuleV1 api{};
};
struct Menu {
    Module modules[MaxModules]{};
    L4P_GameMenuPageV1 page{};
    struct Route { uint32_t id, selection, first; } history[MaxDepth]{};
    // trail[i] is the title of the page at depth i, for the header path.
    wchar_t trail[MaxDepth][32]{};
    unsigned depth{}, selection{}, first{}, revision{}, opens{};
    uint32_t active{}, next{1};
    bool open{}, failed{};

    Module* find(uint32_t token) {
        for (auto& m : modules) if (m.token == token && token) return &m;
        return nullptr;
    }
    bool has_settings() const {
        for (const auto& m : modules) if (m.token && m.api.change) return true;
        return false;
    }
    // The page is a value snapshot. Only a keyboard event rebuilds it.
    bool refresh() {
        page = {};
        ++revision;
        if (!active) {
            copy(page.title, L"抹茶模组设置");
            copy(page.note, L"选择一个已加载的模块");
            for (const auto& m : modules) if (m.token && m.api.change) {
                auto& row = page.rows[page.count++];
                row.kind = L4P_MENU_LINK; row.id = m.token; copy(row.label, m.title);
            }
        } else {
            const auto* m = find(active);
            if (!m || !m->api.page || m->api.page(m->api.context, history[depth].id, &page) != L4P_OK ||
                page.count > L4P_GAME_UI_MAX_ROWS) {
                page = {};
                copy(page.title, L"设置暂不可用");
                copy(page.note, L"按 Esc 返回模组列表");
                failed = true;
                return false;
            }
            if (!page.title[0]) copy(page.title, m->title);
        }
        page.title[63] = page.note[95] = 0;
        for (uint32_t i = 0; i < page.count; ++i) {
            auto& r = page.rows[i];
            r.label[63] = r.value_text[23] = 0;
            if (r.kind < L4P_MENU_LINK || r.kind > L4P_MENU_ACTION) r.disabled = 1;
            if (r.kind >= L4P_MENU_TOGGLE && r.kind <= L4P_MENU_CHOICE &&
                (r.step < 1 || r.minimum >= r.maximum || r.value < r.minimum || r.value > r.maximum)) r.disabled = 1;
            // Toggles are drawn as a switch; only a module's own text is shown beside it.
            if (!r.value_text[0]) {
                if (r.kind == L4P_MENU_RANGE || r.kind == L4P_MENU_CHOICE)
                    std::swprintf(r.value_text, 24, L"%d", int(r.value));
            }
        }
        selection = std::min(selection, page.count ? page.count - 1 : 0);
        return true;
    }
    void close(bool notify = true) {
        const auto* m = find(active);
        open = failed = false; active = depth = selection = first = 0;
        if (notify && m && m->api.visibility) m->api.visibility(m->api.context, 0);
    }
    bool toggle() {
        if (open) { close(); return true; }
        if (!has_settings()) return false;
        open = true; ++opens; refresh(); return true;
    }
    void back() {
        if (!active) { close(); return; }
        if (!depth) {
            const uint32_t old = active;
            close(); open = true; refresh();
            for (uint32_t i = 0; i < page.count; ++i) if (page.rows[i].id == old) selection = i;
            return;
        }
        --depth;
        selection = history[depth].selection; first = history[depth].first; failed = false;
        refresh();
    }
    // Only called with the menu open. Windows virtual-key values are stable.
    bool key(unsigned key, bool repeat) {
        if (key == 27 || key == 8) { if (!repeat) back(); return true; }
        if (key == 38 || key == 40) {
            if (page.count) selection = (selection + page.count + (key == 38 ? -1 : 1)) % page.count;
            return true;
        }
        if (key != 13 && key != 37 && key != 39) return false;
        if (!page.count || (key == 13 && repeat)) return true;
        const auto& r = page.rows[selection];
        if (r.disabled) return true;
        failed = false;
        if (r.kind == L4P_MENU_LINK) {
            if (key != 13) return true;
            if (!active) {
                auto* m = find(r.id);
                if (!m) return true;
                if (!m->api.page) {
                    const auto result = m->api.change(m->api.context, 0, 0);
                    if (result == L4P_OK || result == L4P_MENU_CLOSE) close();
                    else failed = true;
                    return true;
                }
                active = m->token; history[0] = {}; selection = first = 0;
                if (m->api.visibility) m->api.visibility(m->api.context, 1);
                refresh();
            } else if (depth + 1 < MaxDepth) {
                history[depth].selection = selection; history[depth].first = first;
                copy(trail[depth], page.title);
                history[++depth] = {r.id, 0, 0}; selection = first = 0;
                refresh();
            }
            return true;
        }
        const auto* m = find(active);
        if (!m) return true;
        int32_t value = r.value;
        if (r.kind == L4P_MENU_ACTION || r.kind == L4P_MENU_TOGGLE) {
            if (key != 13 && r.kind == L4P_MENU_ACTION) return true;
            if (repeat) return true;
            if (r.kind == L4P_MENU_TOGGLE) value = value == r.maximum ? r.minimum : r.maximum;
        } else {
            if (key == 13 && r.kind != L4P_MENU_CHOICE) return true;
            int64_t nextValue = int64_t(value) + (key == 37 ? -int64_t(r.step) : int64_t(r.step));
            if (r.kind == L4P_MENU_CHOICE) {
                if (nextValue < r.minimum) nextValue = r.maximum;
                if (nextValue > r.maximum) nextValue = r.minimum;
            }
            value = int32_t(std::clamp(nextValue, int64_t(r.minimum), int64_t(r.maximum)));
        }
        const auto result = m->api.change(m->api.context, r.id, value);
        if (result == L4P_MENU_CLOSE) close();
        else if (result == L4P_OK) refresh();
        else failed = true;
        return true;
    }
};

struct Color { int r, g, b, a = 255; };
constexpr Color fade(Color c, int a) { c.a = a; return c; }
// Matcha 抹茶深色：和启动器默认外观同一组 M3 角色。
constexpr Color Ink{10,22,17}, Raised{43,55,50}, OnSurface{216,230,222}, OnVariant{185,203,193}, Muted{146,163,154},
    Outline{132,149,140}, Primary{0,225,174}, Focus{0,81,61}, OnFocus{47,255,200}, Error{255,180,171},
    // Text tones are solid, pre-mixed over the scrim or the blade, so they read the same everywhere.
    Dim{92,107,99}, Quiet{110,126,118}, BladeDim{86,141,125}, BladeArrow{31,194,151};

enum FontSlot : unsigned { TitleFont, BodyFont, SmallFont, FontSlots };

// A tactical overlay rather than a box: a scrim that fades into the game, a thin spine
// beside numbered rows, and one cut "blade" marking the focused row. Unfocused rows show
// only their value; the focused row reveals its control. That keeps the list calm and a
// warm frame cheap: a few primitives per visible row, no measuring, formatting or allocation.
// Draw contract: font(slot, tall, bold), measure(font, text), rect(x, y, w, h, color),
// wedge(x, y, w, h, color) — the top-left half of the box, cut along its diagonal —
// ramp(x, y, w, h, color) — the colour fading to clear from left to right — and
// text(font, x, y, color, text). Layout, truncation and widths are retained and rebuilt only
// when the page or the screen size changes.
struct Presentation {
    struct Hint { const wchar_t* key; const wchar_t* label; int keyWidth, labelWidth; };
    static constexpr int Segments = 10, MaxPips = 12;
    unsigned revision{~0u}, opens{~0u}, hintState{~0u}, hintCount{}, visible{}, shown{}, counted{~0u};
    uint32_t openedAt{}, slideAt{};
    int width{}, height{}, t{}, small{}, titleSize{}, gap{}, rowH{}, spine{}, left{}, label{}, right{}, scrim{}, fadeW{},
        eyebrowY{}, titleY{}, accentY{}, noteY{}, listTop{}, hintsY{}, keyH{}, mark{}, line{}, brandWidth{},
        chevron{}, arrow{}, counterWidth{}, valueColumn{}, seg{}, segGap{}, segH{}, meterW{}, pip{}, onWidth{},
        offWidth{}, enterWidth{}, cut{}, slideFrom{}, slideTo{-1}, slideShown{};
    unsigned fonts[FontSlots]{};
    wchar_t path[160]{}, shownPath[160]{}, heading[64]{}, note[96]{}, counter[16]{}, labels[L4P_GAME_UI_MAX_ROWS][64]{},
        numbers[L4P_GAME_UI_MAX_ROWS][4]{};
    int valueWidth[L4P_GAME_UI_MAX_ROWS]{};
    Hint hints[4]{};

    template<class Draw, size_t N> static void fit(Draw& draw, unsigned font, wchar_t (&text)[N], const wchar_t* original, int width) {
        copy(text, original);
        auto n = std::wcslen(text);
        if (draw.measure(font, text) <= width) return;
        while (n > 1) {
            text[--n] = L'…'; text[n+1] = 0;
            if (draw.measure(font, text) <= width) return;
        }
        text[0] = 0;
    }

    // Everything scales from one body size, so 720p and 4K keep the same proportions.
    void layout(int w, int h) {
        width = w; height = h;
        // Body is VGUI "tall" (cell height): 18 at 720p, 27 at 1080p, 36 at 1440p.
        t = std::clamp(h/40, 18, 56);
        small = std::max(15, t*4/5);
        titleSize = t*3/2;
        gap = t/2; rowH = t*7/4;
        spine = t*3/2;
        left = spine + t*2/3;
        label = left + small*2;
        right = spine + std::clamp(t*17, 340, w*40/100);
        scrim = right + t*2; fadeW = t*11;
        line = std::max(2, t/12);
        mark = std::max(8, small*3/5);
        eyebrowY = t*2;
        titleY = eyebrowY + small + t/2;
        accentY = titleY + titleSize + t/4;
        noteY = accentY + line + t/2;
        listTop = noteY + small + t;
        keyH = small + small/2;
        visible = unsigned(std::clamp((h - t*2 - keyH - t - listTop)/rowH, 1, int(L4P_GAME_UI_MAX_ROWS)));
        seg = std::max(3, t/5); segGap = std::max(2, t/9); segH = t*3/5;
        meterW = Segments*seg + (Segments - 1)*segGap;
        pip = std::max(5, t/5);
        cut = rowH*3/5;
        hintState = ~0u; counted = ~0u; slideTo = -1;
    }

    void compose(const Menu& m) {
        path[0] = 0;
        size_t n = 0;
        auto append = [&](const wchar_t* s) { for (; *s && n + 1 < 160; ++s) path[n++] = *s; path[n] = 0; };
        if (!m.active) { append(L"抹茶模组设置"); return; }
        append(L"模组设置");
        for (unsigned i = 0; i < m.depth && i < MaxDepth; ++i) { append(L"  /  "); append(m.trail[i]); }
    }

    static int pips(const L4P_GameMenuRowV1& r) {
        const int64_t n = int64_t(r.maximum) - r.minimum + 1;
        return r.step == 1 && n >= 2 && n <= MaxPips ? int(n) : 0;
    }
    // Room the focused row's control takes on the right; labels are fitted against it so
    // they never change width when focus arrives.
    int control(const L4P_GameMenuRowV1& r, unsigned i) const {
        switch (r.kind) {
        case L4P_MENU_LINK: return arrow + (valueWidth[i] ? valueWidth[i] + gap : 0);
        case L4P_MENU_TOGGLE: return arrow + offWidth + gap + onWidth;
        case L4P_MENU_RANGE: return arrow*2 + valueColumn + gap + meterW;
        case L4P_MENU_CHOICE: { const int n = pips(r); return arrow*2 + valueWidth[i] + (n ? gap + n*pip*2 : 0); }
        case L4P_MENU_ACTION: return enterWidth;
        default: return 0;
        }
    }

    // Footer keys follow the focused row; rebuilt only when that context changes.
    template<class Draw> void build_hints(Draw& d, const Menu& m) {
        const auto* r = m.page.count ? &m.page.rows[m.selection] : nullptr;
        const unsigned kind = r && !r->disabled ? r->kind : 0;
        const unsigned state = kind | (m.active ? 16u : 0u);
        if (state == hintState) return;
        hintState = state; hintCount = 0;
        auto add = [&](const wchar_t* key, const wchar_t* label) {
            hints[hintCount++] = {key, label, d.measure(fonts[SmallFont], key), d.measure(fonts[SmallFont], label)};
        };
        add(L"↑↓", L"选择");
        if (kind == L4P_MENU_RANGE || kind == L4P_MENU_CHOICE) add(L"←→", L"调整");
        else if (kind == L4P_MENU_TOGGLE) add(L"Enter", L"切换");
        else if (kind == L4P_MENU_LINK) add(L"Enter", L"进入");
        else if (kind == L4P_MENU_ACTION) add(L"Enter", L"执行");
        add(L"Esc", m.active ? L"返回" : L"关闭");
        if (m.active) add(L"Ctrl F7", L"关闭");
        auto total = [&] {
            int sum = 0;
            for (unsigned i = 0; i < hintCount; ++i) sum += hints[i].keyWidth + small + hints[i].labelWidth + small;
            return sum;
        };
        while (hintCount > 2 && total() > right - left) --hintCount;
    }

    // now: milliseconds from a steady clock; 0 draws the settled state.
    template<class Draw> void draw(Draw& d, Menu& menu, int w, int h, uint32_t now = 0) {
        if (!menu.open || w < 640 || h < 400) return;
        const bool resized = width != w || height != h;
        if (resized) layout(w, h);
        fonts[TitleFont] = d.font(TitleFont, titleSize, true);
        fonts[BodyFont] = d.font(BodyFont, t, false);
        fonts[SmallFont] = d.font(SmallFont, small, false);
        if (!fonts[TitleFont] || !fonts[BodyFont] || !fonts[SmallFont]) { revision = ~0u; return; }
        const unsigned body = fonts[BodyFont], note_ = fonts[SmallFont];
        const bool rebuilt = resized || revision != menu.revision;
        if (rebuilt) {
            revision = menu.revision;
            brandWidth = d.measure(note_, L"MATCHA");
            chevron = d.measure(body, L"›");
            arrow = chevron + small/3;
            onWidth = d.measure(body, L"开"); offWidth = d.measure(body, L"关");
            enterWidth = d.measure(note_, L"Enter") + small*2/3;
            compose(menu);
            fit(d, note_, shownPath, path, right - left - mark - small/2 - brandWidth - small*4);
            fit(d, fonts[TitleFont], heading, menu.page.title, right - left);
            fit(d, note_, note, menu.page.note, right - left);
            valueColumn = 0;
            for (uint32_t i = 0; i < menu.page.count; ++i) {
                const auto& r = menu.page.rows[i];
                valueWidth[i] = r.value_text[0] ? d.measure(body, r.value_text) : 0;
                if (r.kind == L4P_MENU_RANGE) valueColumn = std::max(valueColumn, valueWidth[i]);
                std::swprintf(numbers[i], 4, L"%02u", i + 1);
            }
            for (uint32_t i = 0; i < menu.page.count; ++i)
                fit(d, body, labels[i], menu.page.rows[i].label, right - label - control(menu.page.rows[i], i) - gap);
            shown = std::clamp(menu.page.count, 1u, visible);
            hintsY = listTop + int(shown)*rowH + t;
        }
        build_hints(d, menu);
        if (rebuilt || counted != menu.selection) {
            counted = menu.selection;
            std::swprintf(counter, 16, L"%02u / %02u", menu.page.count ? menu.selection + 1 : 0, menu.page.count);
            counterWidth = d.measure(note_, counter);
        }

        // Keep the focused row in view and keep keyboard navigation O(1).
        if (menu.selection < menu.first) menu.first = menu.selection;
        if (menu.selection >= menu.first+visible) menu.first = menu.selection-visible+1;
        if (menu.first+visible > menu.page.count)
            menu.first = menu.page.count > visible ? menu.page.count-visible : 0;
        const unsigned end = std::min(menu.first+visible, menu.page.count);

        // Opening slides in from the left and fades over 140 ms. Moving between rows slides the
        // blade for 90 ms; a new page or an adjusted value snaps it.
        if (opens != menu.opens) { opens = menu.opens; openedAt = now; slideTo = -1; }
        int alpha = 255, dx = 0;
        auto ease = [](float p) { p = std::clamp(p, 0.f, 1.f); return 1.f - (1.f-p)*(1.f-p)*(1.f-p); };
        if (now) {
            const float e = ease(float(now - openedAt) / 140.f);
            alpha = int(255.f*e + .5f); dx = int((e - 1.f) * float(t));
        }
        const int target = listTop + int(menu.selection - menu.first)*rowH;
        if (target != slideTo) {
            slideFrom = slideTo < 0 || rebuilt || !now ? target : slideShown;
            slideTo = target; slideAt = now;
        }
        slideShown = now ? slideFrom + int(float(slideTo - slideFrom)*ease(float(now - slideAt) / 90.f)) : slideTo;
        auto c = [alpha](Color k) { k.a = k.a*alpha/255; return k; };
        const int sp = spine + dx, lx = left + dx, tx = label + dx, rx = right + dx, vx = rx - arrow;

        // The scrim: solid behind the text, then fading into the game.
        d.rect(0, 0, scrim, h, c(fade(Ink, 214)));
        d.ramp(scrim, 0, fadeW, h, c(fade(Ink, 214)));

        d.wedge(lx, eyebrowY + (small - mark)/2, mark, mark, c(Primary));
        d.text(note_, lx + mark + small/2, eyebrowY, c(OnVariant), L"MATCHA");
        d.text(note_, lx + mark + small/2 + brandWidth + small*2/3, eyebrowY, c(Muted), shownPath);
        d.text(note_, rx - counterWidth, eyebrowY, c(Muted), counter);
        d.text(fonts[TitleFont], lx, titleY, c(OnSurface), heading);
        d.rect(lx, accentY, t*3/2, line, c(Primary));
        if (note[0]) d.text(note_, lx, noteY, c(Muted), note);

        // The spine doubles as the scroll track.
        const int listH = int(shown)*rowH;
        d.rect(sp, listTop, 1, listH, c(fade(Primary, 64)));
        if (menu.page.count > visible) {
            const int knob = std::max(t, listH*int(visible)/int(menu.page.count));
            const int at = (listH - knob)*int(menu.first)/int(menu.page.count - visible);
            d.rect(sp - 1, listTop + at, 3, knob, c(fade(Primary, 200)));
        }

        // The blade: dark matcha with a bright edge and a cut end.
        if (menu.page.count) {
            const bool off = menu.page.rows[menu.selection].disabled != 0;
            const Color body_ = off ? fade(Raised, 220) : fade(Focus, 236);
            const int by = slideShown + 2, bh = rowH - 4, bw = rx + t/2 - sp;
            d.rect(sp, by, bw, bh, c(body_));
            d.wedge(sp + bw, by, cut, bh, c(body_));
            d.rect(sp - line/2, by, line + 1, bh, c(off ? Outline : Primary));
        }

        for (unsigned i = menu.first; i < end; ++i) {
            const auto& r = menu.page.rows[i];
            const int rowTop = listTop + int(i - menu.first)*rowH, ty = rowTop + (rowH - t)/2, sy = rowTop + (rowH - small)/2;
            const int cy = rowTop + rowH/2;
            const bool focus = i == menu.selection, off = r.disabled != 0, live = focus && !off;
            const Color ink = off ? Quiet : focus ? OnSurface : OnVariant;
            const Color value = off ? Dim : focus ? OnFocus : Muted;
            d.text(note_, lx, sy, c(focus && !off ? Primary : Dim), numbers[i]);
            d.text(body, tx, ty, c(ink), labels[i]);
            switch (r.kind) {
            case L4P_MENU_LINK:
                if (valueWidth[i]) d.text(body, vx - valueWidth[i], ty, c(value), r.value_text);
                d.text(body, rx - chevron, ty, c(live ? Primary : value), L"›");
                break;
            case L4P_MENU_TOGGLE: {
                const bool on = r.value == r.maximum;
                if (!live) {
                    d.text(body, vx - (on ? onWidth : offWidth), ty, c(off ? value : on ? Primary : Quiet), on ? L"开" : L"关");
                    break;
                }
                // Focused: both words, the live one lit and underlined.
                const int onX = vx - onWidth, offX = onX - gap - offWidth, ux = on ? onX : offX;
                d.text(body, offX, ty, c(on ? BladeDim : OnSurface), L"关");
                d.text(body, onX, ty, c(on ? OnFocus : BladeDim), L"开");
                d.rect(ux, ty + t + line/2, on ? onWidth : offWidth, line, c(on ? Primary : OnSurface));
                break;
            }
            case L4P_MENU_RANGE: {
                if (!live) { d.text(body, vx - valueWidth[i], ty, c(value), r.value_text); break; }
                const int64_t span = int64_t(r.maximum) - r.minimum;
                int lit = span > 0 ? int((int64_t(r.value) - r.minimum) * Segments / span) : 0;
                if (r.value > r.minimum && !lit) lit = 1;
                const int mx = vx - valueColumn - arrow - gap - meterW, my = cy - segH/2;
                for (int s = 0; s < Segments; ++s)
                    d.rect(mx + s*(seg + segGap), my, seg, segH, c(s < lit ? Primary : fade(OnSurface, 46)));
                d.text(body, vx - valueColumn - arrow, ty, c(BladeArrow), L"‹");
                d.text(body, vx - valueWidth[i], ty, c(OnFocus), r.value_text);
                d.text(body, rx - chevron, ty, c(BladeArrow), L"›");
                break;
            }
            case L4P_MENU_CHOICE: {
                if (!live) { d.text(body, vx - valueWidth[i], ty, c(value), r.value_text); break; }
                const int vl = vx - valueWidth[i];
                d.text(body, vl - arrow, ty, c(BladeArrow), L"‹");
                d.text(body, vl, ty, c(OnFocus), r.value_text);
                d.text(body, rx - chevron, ty, c(BladeArrow), L"›");
                if (const int n = pips(r)) {
                    const int px = vl - arrow - gap - n*pip*2 + pip, at = r.value - r.minimum;
                    for (int p = 0; p < n; ++p)
                        d.rect(px + p*pip*2, cy - pip/2, pip, pip, c(p == at ? Primary : fade(OnSurface, 60)));
                }
                break;
            }
            case L4P_MENU_ACTION:
                if (live) {
                    d.rect(rx - enterWidth, cy - keyH/2, enterWidth, keyH, c(fade(Primary, 40)));
                    d.text(note_, rx - enterWidth + small/3, cy - small/2, c(OnFocus), L"Enter");
                }
                break;
            }
        }

        if (menu.failed) {
            d.wedge(lx, hintsY + (keyH - mark)/2, mark, mark, c(Error));
            d.text(note_, lx + mark + small/2, hintsY + (keyH - small)/2, c(Error), L"这项设置暂未应用");
            return;
        }
        int hx = lx;
        for (unsigned i = 0; i < hintCount; ++i) {
            const auto& k = hints[i];
            d.rect(hx, hintsY, k.keyWidth + small*2/3, keyH, c(fade(Raised, 210)));
            d.text(note_, hx + small/3, hintsY + (keyH - small)/2, c(OnVariant), k.key);
            hx += k.keyWidth + small*2/3 + small/3;
            d.text(note_, hx, hintsY + (keyH - small)/2, c(Muted), k.label);
            hx += k.labelWidth + small;
        }
    }
};
}
