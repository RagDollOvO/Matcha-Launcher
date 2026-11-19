#pragma once
#include "win32.h"

// Device Reset is not an IL4NPlugin callback. Display/window notifications and
// the observed display state cover both same-resolution and resized switches.
// Coalesce a mode switch's messages until the window has settled; never create
// fonts in the window procedure or refresh them every paint.
struct HudFontRecovery {
    bool observed=false,pending=false;
    unsigned changedAt=0;
    HWND handle=nullptr;
    int width=0,height=0;
    long style=0,extendedStyle=0;
    void Request(unsigned now){pending=true;changedAt=now;}
    void Notify(UINT message,WPARAM value,unsigned now){
        if((message==0x5&&value!=1)||message==0x7e||(message==0x1c&&value))Request(now);
    }
    bool Frame(HWND nextHandle,int nextWidth,int nextHeight,long nextStyle,long nextExtendedStyle,unsigned now){
        // Only rendering-related style bits matter; visibility/focus bookkeeping
        // must not create new glyph caches while the same display is active.
        nextStyle&=long(0x80c40000u);nextExtendedStyle&=0x300;
        bool changed=observed&&(handle!=nextHandle||width!=nextWidth||height!=nextHeight||style!=nextStyle||extendedStyle!=nextExtendedStyle);
        observed=true;handle=nextHandle;width=nextWidth;height=nextHeight;style=nextStyle;extendedStyle=nextExtendedStyle;
        if(changed)Request(now);
        if(!pending||now-changedAt<200)return false;
        pending=false;return true;
    }
};
