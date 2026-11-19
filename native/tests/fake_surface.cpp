// Owned Surface031 ABI/context fixture. Counter-only retail-shaped entry points;
// primitives are rendered into a private GDI bitmap for offline inspection.
#define NOMINMAX
#include <windows.h>
#include <cstring>
#include <map>
#include <string>
#include <fstream>
#include <cstdint>
extern "C" {
uint8_t FixtureDrawingFlag=0;int FixtureDrawCookie=0;
void __cdecl FixtureBeginCount();void __cdecl FixtureFinishCount();void __cdecl FixturePushCount(unsigned,int);void __cdecl FixturePopCount(unsigned);void __cdecl FixtureFlushCount();
void __cdecl FixtureFinishDraw();
__attribute__((naked)) void __cdecl FixtureStartDraw(){__asm__ volatile(
    "1: pushl %ebp\n.byte 0x8b,0xec\npushl $-1\n.byte 0x68\n.long 0\n.byte 0x64,0xa1\n.long 0\npushl %eax\nsubl $0x14,%esp\npushl %esi\npushl %edi\n"
    "movb $1,_FixtureDrawingFlag\ncall _FixtureBeginCount\nleave\nret\n.space 0x120-(.-1b),0x90\n"
    ".globl _FixtureFinishDraw\n_FixtureFinishDraw:\npushl %ebp\n.byte 0x8b,0xec\npushl $-1\nmovb $0,_FixtureDrawingFlag\ncall _FixtureFinishCount\nleave\nret\n.space 0x500-(.-1b),0x90\n");}
__attribute__((naked)) void __cdecl FixtureRoot(){__asm__ volatile(".byte 0x8b,0x81,0x44,0x02,0,0,0xc3\n");}
__attribute__((naked)) void __cdecl FixturePush(){__asm__ volatile(
    "1: pushl %ebp\n.byte 0x8b,0xec\nsubl $0x3c,%esp\nmovl _FixtureDrawCookie,%eax\npushl 12(%ebp)\npushl 8(%ebp)\ncall _FixturePushCount\naddl $8,%esp\nleave\njmp 2f\n.space 0x13b-(.-1b),0x90\n2: ret $8\n");}
__attribute__((naked)) void __cdecl FixturePop(){__asm__ volatile(
    "1: pushl %esi\npushl %edi\n.byte 0x8b,0xf9,0x83,0xbf,0xa4,0x02,0x01,0,0\npushl 12(%esp)\ncall _FixturePopCount\naddl $4,%esp\npopl %edi\npopl %esi\njmp 2f\n.space 0x98-(.-1b),0x90\n2: ret $4\n");}
__attribute__((naked)) void __cdecl FixtureFlush(){__asm__ volatile(
    "1: pushl %ebp\n.byte 0x8b,0xec\npushl %ecx\npushl %esi\n.byte 0x8b,0xf1,0x83,0xbe,0xa4,0x02,0x01,0,0\ncall _FixtureFlushCount\npopl %esi\nleave\njmp 2f\n.space 0x82-(.-1b),0x90\n2: ret\n");}
}
namespace {
void* table[117]{};alignas(16) unsigned char surface[0x10300]{};
struct Counts {int begins,ends,pushes,pops,flushes,shapes,texts,textures,errors,root;};Counts counts{};
HDC dc=nullptr;HBITMAP bitmap=nullptr;void* pixels=nullptr;int width=960,height=640;COLORREF color=RGB(255,255,255),textColor=RGB(255,255,255);int tx=0,ty=0,textureId=0;
unsigned fontId=0,nextFont=1;int nextTexture=0;std::map<unsigned,HFONT> fonts;std::map<int,std::string> textures;
int rgba[4]{255,255,255,255};bool blendFill=false;
void init(){if(dc)return;*reinterpret_cast<void***>(surface)=table;*reinterpret_cast<unsigned*>(surface+0x244)=7;
    dc=CreateCompatibleDC(nullptr);BITMAPINFO info{};info.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);info.bmiHeader.biWidth=width;info.bmiHeader.biHeight=-height;info.bmiHeader.biPlanes=1;info.bmiHeader.biBitCount=32;info.bmiHeader.biCompression=BI_RGB;bitmap=CreateDIBSection(dc,&info,DIB_RGB_COLORS,&pixels,nullptr,0);SelectObject(dc,bitmap);SetBkMode(dc,TRANSPARENT);}
void check(){if(!FixtureDrawingFlag)++counts.errors;}
void __fastcall screen(void*,void*,int* w,int* h){*w=width;*h=height;}
void __fastcall setColor(void*,void*,int r,int g,int b,int a){color=RGB(r,g,b);rgba[0]=r;rgba[1]=g;rgba[2]=b;rgba[3]=a;}
void __fastcall setTextColor(void*,void*,int r,int g,int b,int){textColor=RGB(r,g,b);}
void __fastcall setTexture(void*,void*,int id){textureId=id;}
void __fastcall fill(void*,void*,int x,int y,int x1,int y1){check();++counts.shapes;
    if(blendFill){GdiFlush();auto p=static_cast<unsigned char*>(pixels);for(int yy=y<0?0:y;yy<y1&&yy<height;++yy)for(int xx=x<0?0:x;xx<x1&&xx<width;++xx){auto q=p+(yy*width+xx)*4;for(int c=0;c<3;++c)q[c]=static_cast<unsigned char>((rgba[2-c]*rgba[3]+q[c]*(255-rgba[3]))/255);}return;}
    RECT rect{x,y,x1,y1};auto brush=CreateSolidBrush(color);FillRect(dc,&rect,brush);DeleteObject(brush);}
void __fastcall outline(void*,void*,int x,int y,int x1,int y1){check();++counts.shapes;auto pen=CreatePen(PS_SOLID,1,color);auto old=SelectObject(dc,pen);auto brush=SelectObject(dc,GetStockObject(HOLLOW_BRUSH));Rectangle(dc,x,y,x1,y1);SelectObject(dc,brush);SelectObject(dc,old);DeleteObject(pen);}
void __fastcall line(void*,void*,int x,int y,int x1,int y1){check();++counts.shapes;auto pen=CreatePen(PS_SOLID,1,color);auto old=SelectObject(dc,pen);MoveToEx(dc,x,y,nullptr);LineTo(dc,x1,y1);SelectObject(dc,old);DeleteObject(pen);}
unsigned long __fastcall createFont(void*,void*){return nextFont++;}
bool __fastcall glyph(void*,void*,unsigned long font,const char* face,int tall,int weight,int blur,int scan,int flags,int start,int end){if(blur||scan||start||end)++counts.errors;fonts[font]=CreateFontA(-tall,0,0,0,weight,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,ANTIALIASED_QUALITY,DEFAULT_PITCH,face);return fonts[font]!=nullptr;}
void __fastcall setFont(void*,void*,unsigned long font){fontId=font;}
void __fastcall textPos(void*,void*,int x,int y){tx=x;ty=y;}
void __fastcall print(void*,void*,const wchar_t* text,int count,int mode){check();++counts.texts;if(mode||!fonts.count(fontId)){++counts.errors;return;}auto old=SelectObject(dc,fonts[fontId]);SetTextColor(dc,textColor);TextOutW(dc,tx,ty,text,count);SelectObject(dc,old);}
void __fastcall measure(void*,void*,unsigned long font,const wchar_t* text,int* w,int* h){if(!fonts.count(font)){++counts.errors;return;}auto old=SelectObject(dc,fonts[font]);SIZE size{};GetTextExtentPoint32W(dc,text,int(wcslen(text)),&size);SelectObject(dc,old);*w=size.cx;*h=size.cy;}
int __fastcall createTexture(void*,void*,bool procedural){if(procedural)++counts.errors;int id=nextTexture++;textures[id]="";return id;}
void __fastcall textureFile(void*,void*,int id,const char* file,int filter,bool reload){if(filter!=1||reload)++counts.errors;textures[id]=file;}
void __fastcall textureSize(void*,void*,int id,int* w,int* h){*w=*h=textures.count(id)&&textures[id]=="fixture/icon"?64:0;}
void __fastcall textured(void*,void*,int x,int y,int x1,int y1,float u0,float v0,float u1,float v1){check();++counts.textures;if(!textures.count(textureId)||u0!=0||v0!=0||u1!=1||v1!=1)++counts.errors;auto saved=color;color=RGB(231,177,70);fill(nullptr,nullptr,x,y,x1,y1);color=RGB(31,53,72);for(int i=0;i<4;++i)line(nullptr,nullptr,x+8+i,y+8,x1-8,y1-8-i);color=saved;}
}
extern "C" {
void __cdecl FixtureBeginCount(){++counts.begins;}
void __cdecl FixtureFinishCount(){++counts.ends;}
void __cdecl FixturePushCount(unsigned panel,int insets){++counts.pushes;counts.root=int(panel);if(panel!=*reinterpret_cast<unsigned*>(surface+0x244)||insets)++counts.errors;}
void __cdecl FixturePopCount(unsigned panel){++counts.pops;if(panel!=unsigned(counts.root))++counts.errors;}
void __cdecl FixtureFlushCount(){++counts.flushes;}
__declspec(dllexport) void* __cdecl CreateInterface(const char* name,int*){init();
    table[6]=reinterpret_cast<void*>(&FixtureRoot);table[8]=reinterpret_cast<void*>(&FixturePush);table[9]=reinterpret_cast<void*>(&FixturePop);table[24]=reinterpret_cast<void*>(&FixtureFlush);
    table[11]=reinterpret_cast<void*>(&setColor);table[12]=reinterpret_cast<void*>(&fill);table[14]=reinterpret_cast<void*>(&outline);table[15]=reinterpret_cast<void*>(&line);table[17]=reinterpret_cast<void*>(&setFont);table[19]=reinterpret_cast<void*>(&setTextColor);table[20]=reinterpret_cast<void*>(&textPos);table[22]=reinterpret_cast<void*>(&print);
    table[27]=reinterpret_cast<void*>(&textureFile);table[29]=reinterpret_cast<void*>(&setTexture);table[30]=reinterpret_cast<void*>(&textureSize);table[34]=reinterpret_cast<void*>(&createTexture);table[35]=reinterpret_cast<void*>(&screen);table[63]=reinterpret_cast<void*>(&createFont);table[64]=reinterpret_cast<void*>(&glyph);table[72]=reinterpret_cast<void*>(&measure);table[98]=reinterpret_cast<void*>(&textured);
    return !strcmp(name,"VGUI_Surface031")?surface:nullptr;
}
__declspec(dllexport) void __cdecl FixtureDrawCounts(void* out){memcpy(out,&counts,sizeof(counts));}
__declspec(dllexport) void __cdecl FixtureDrawColor(int* out){memcpy(out,rgba,sizeof(rgba));}
__declspec(dllexport) void __cdecl FixtureDrawBlend(int enabled){blendFill=enabled!=0;}
__declspec(dllexport) void __cdecl FixtureDrawContext(int active,unsigned root){init();FixtureDrawingFlag=uint8_t(active);*reinterpret_cast<unsigned*>(surface+0x244)=root;}
__declspec(dllexport) int __cdecl FixtureDrawOpen(){return FixtureDrawingFlag;}
__declspec(dllexport) unsigned long __cdecl FixtureDrawPixel(int x,int y){GdiFlush();return GetPixel(dc,x,y);}
__declspec(dllexport) void __cdecl FixtureDrawClear(){init();RECT area{0,0,width,height};auto brush=CreateSolidBrush(RGB(32,48,60));FillRect(dc,&area,brush);DeleteObject(brush);}
__declspec(dllexport) int __cdecl FixtureDrawSave(const wchar_t* file){GdiFlush();BITMAPFILEHEADER header{};header.bfType=0x4d42;header.bfOffBits=sizeof(header)+sizeof(BITMAPINFOHEADER);header.bfSize=header.bfOffBits+width*height*4;
    BITMAPINFOHEADER info{};info.biSize=sizeof(info);info.biWidth=width;info.biHeight=-height;info.biPlanes=1;info.biBitCount=32;info.biCompression=BI_RGB;
    auto output=CreateFileW(file,GENERIC_WRITE,0,nullptr,CREATE_ALWAYS,FILE_ATTRIBUTE_NORMAL,nullptr);if(output==INVALID_HANDLE_VALUE)return 0;DWORD bytes=0;bool ok=WriteFile(output,&header,sizeof(header),&bytes,nullptr)&&WriteFile(output,&info,sizeof(info),&bytes,nullptr)&&WriteFile(output,pixels,width*height*4,&bytes,nullptr);CloseHandle(output);return ok;}
__declspec(dllexport) void __cdecl FixtureDrawUnsupported(){DWORD old=0;auto p=reinterpret_cast<unsigned char*>(&FixturePush);VirtualProtect(p,8,PAGE_EXECUTE_READWRITE,&old);p[5]=0x38;DWORD ignored=0;VirtualProtect(p,8,old,&ignored);FlushInstructionCache(GetCurrentProcess(),p,8);}
}
