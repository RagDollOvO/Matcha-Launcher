#pragma once
#include "win32.h"

namespace glow_hotkey {
enum Modifier : unsigned { Ctrl=1,Shift=2,Alt=4 };
struct Binding {unsigned key=0,modifiers=0;};
constexpr bool Space(WCHAR ch){return ch==L' '||ch==L'\t';}
constexpr WCHAR Upper(WCHAR ch){return ch>=L'a'&&ch<=L'z'?WCHAR(ch-L'a'+L'A'):ch;}
inline bool Token(const WCHAR* text,unsigned length,const WCHAR* word){
    for(unsigned i=0;i<length;++i)if(!word[i]||Upper(text[i])!=word[i])return false;
    return word[length]==0;
}
inline Binding Parse(const WCHAR* text){
    unsigned modifiers=0;
    for(;;){
        while(Space(*text))++text;
        const WCHAR* start=text;
        while(*text&&*text!=L'+'&&!Space(*text))++text;
        unsigned length=unsigned(text-start);
        while(Space(*text))++text;
        if(!length)return {};
        if(*text==L'+'){
            unsigned bit=Token(start,length,L"CTRL")?Ctrl:Token(start,length,L"SHIFT")?Shift:Token(start,length,L"ALT")?Alt:0u;
            if(!bit||(modifiers&bit))return {};
            modifiers|=bit;++text;continue;
        }
        if(*text)return {};
        WCHAR key=Upper(start[0]);
        if(length==1&&(modifiers&(Ctrl|Alt))&&((key>=L'A'&&key<=L'Z')||(key>=L'0'&&key<=L'9')))return {unsigned(key),modifiers};
        if(key!=L'F'||length<2||length>3||start[1]<L'1'||start[1]>L'9')return {};
        unsigned number=unsigned(start[1]-L'0');
        if(length==3){if(start[2]<L'0'||start[2]>L'9')return {};number=number*10+unsigned(start[2]-L'0');}
        return number<=12?Binding{0x6fu+number,modifiers}:Binding{};
    }
}
inline bool FirstPress(UINT message,LPARAM parameter){
    return (message==0x100||message==0x104)&&!(unsigned(parameter)&(1u<<30));
}
}
