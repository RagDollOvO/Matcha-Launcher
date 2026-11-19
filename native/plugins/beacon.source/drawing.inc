// GPL-3.0. Surface drawing ownership/signatures and primitive ABI from Skeeto
// 2.2.19 SurfDrawing*, SurfTextAt, LocalPlayWorldToScreen and texture helpers.
using DrawContextFn=void(__thiscall*)(void*);
using DrawRootFn=unsigned(__thiscall*)(void*);
using DrawPushFn=void(__thiscall*)(void*,unsigned,bool);
using DrawPopFn=void(__thiscall*)(void*,unsigned);
struct DrawTexture {int id=-1,width=0,height=0;};
struct DrawService {
    void* surface=nullptr;uint32_t state=0;uint8_t* flag=nullptr;
    DrawContextFn begin=nullptr,end=nullptr,flush=nullptr;DrawRootFn root=nullptr;DrawPushFn push=nullptr;DrawPopFn pop=nullptr;
    std::map<std::tuple<std::string,int,int,uint32_t>,uint32_t> fonts;std::set<uint32_t> fontIds;
    std::map<std::string,DrawTexture> textures;std::map<uint32_t,std::string> textureIds;
};
DrawService& drawing(){static auto* d=new DrawService;return *d;}
thread_local bool drawTouched=false,drawOwned=false;thread_local unsigned drawPanel=0;thread_local int paintMode=0;
bool draw_match(const unsigned char* p,const unsigned char* bytes,size_t n){return readable(p,n)&&!memcmp(p,bytes,n);}
uint8_t* draw_shared_flag(const unsigned char* start,const unsigned char* finish,const unsigned char* base,size_t imageBytes){
    uint8_t* found=nullptr;
    for(size_t i=0;i+7<=0x100;++i){if(start[i]!=0xc6||start[i+1]!=5||start[i+6]!=1)continue;uint32_t address=0;memcpy(&address,start+i+2,4);
        if(uintptr_t(address)<uintptr_t(base)||uintptr_t(address)-uintptr_t(base)>=imageBytes)continue;
        for(size_t j=0;j+7<=0xc0;++j){if(finish[j]!=0xc6||finish[j+1]!=5||finish[j+6])continue;uint32_t other=0;memcpy(&other,finish+j+2,4);
            if(other==address){if(found&&found!=reinterpret_cast<uint8_t*>(uintptr_t(address)))return nullptr;found=reinterpret_cast<uint8_t*>(uintptr_t(address));}}
    }return found;
}
bool draw_resolve(){
    auto& d=drawing();if(d.state)return d.state==1;
    auto base=reinterpret_cast<unsigned char*>(GetModuleHandleW(L"vguimatsurface.dll"));if(!base)return false;
    if(!d.surface)d.surface=iface(L"vguimatsurface.dll","VGUI_Surface031");if(!d.surface)return false;d.state=2;
    if(!readable(base,sizeof(IMAGE_DOS_HEADER)))return false;auto dos=reinterpret_cast<IMAGE_DOS_HEADER*>(base);
    if(dos->e_magic!=IMAGE_DOS_SIGNATURE||dos->e_lfanew<0||dos->e_lfanew>1024*1024)return false;
    auto nt=reinterpret_cast<IMAGE_NT_HEADERS32*>(base+dos->e_lfanew);if(!readable(nt,sizeof(*nt))||nt->Signature!=IMAGE_NT_SIGNATURE)return false;
    size_t size=nt->OptionalHeader.SizeOfImage;auto sections=IMAGE_FIRST_SECTION(nt);if(!readable(sections,nt->FileHeader.NumberOfSections*sizeof(*sections)))return false;
    const unsigned char* start=nullptr;const unsigned char* finish=nullptr;uint8_t* flag=nullptr;
    constexpr int signature[]={0x55,0x8b,0xec,0x6a,0xff,0x68,-1,-1,-1,-1,0x64,0xa1,-1,-1,-1,-1,0x50,0x83,0xec,0x14,0x56,0x57};
    for(unsigned s=0;s<nt->FileHeader.NumberOfSections;++s){auto& section=sections[s];if(!(section.Characteristics&IMAGE_SCN_MEM_EXECUTE))continue;
        const size_t first=section.VirtualAddress;if(first>=size)continue;size_t span=std::min<size_t>(section.Misc.VirtualSize,size-first);if(!readable(base+first,span))continue;
        for(size_t i=first;i+0x4c0<=first+span;++i){bool match=true;for(size_t j=0;j<std::size(signature);++j)if(signature[j]>=0&&base[i+j]!=signature[j]){match=false;break;}if(!match)continue;
            auto candidate=base+i;
            for(auto end=candidate+0x100;end<candidate+0x400;++end){if(end[0]!=0x55||end[1]!=0x8b||end[2]!=0xec||end[3]!=0x6a||end[4]!=0xff)continue;
                auto shared=draw_shared_flag(candidate,end,base,size);if(!shared||!writable(shared,1))continue;
                if(start&&(start!=candidate||finish!=end||flag!=shared))return false;start=candidate;finish=end;flag=shared;
            }
        }
    }
    if(!start||!finish||!flag)return false;
    const int slots[]={6,8,9,24};const size_t spans[]={7,0x13e,0x9b,0x83};const unsigned char* methods[4]{};
    for(size_t i=0;i<4;++i){methods[i]=static_cast<unsigned char*>(slot(d.surface,slots[i]));auto p=uintptr_t(methods[i]);
        if(p<uintptr_t(base)||p-uintptr_t(base)>=size||spans[i]>size-(p-uintptr_t(base))||!readable(methods[i],spans[i]))return false;}
    constexpr unsigned char root[]={0x8b,0x81,0x44,0x02,0,0,0xc3};
    constexpr unsigned char push[]={0x55,0x8b,0xec,0x83,0xec,0x3c,0xa1};
    constexpr unsigned char pop[]={0x56,0x57,0x8b,0xf9,0x83,0xbf,0xa4,0x02,0x01,0,0};
    constexpr unsigned char flush[]={0x55,0x8b,0xec,0x51,0x56,0x8b,0xf1,0x83,0xbe,0xa4,0x02,0x01,0,0};
    constexpr unsigned char ret8[]={0xc2,8,0},ret4[]={0xc2,4,0};
    if(!draw_match(methods[0],root,sizeof(root))||!draw_match(methods[1],push,sizeof(push))||!draw_match(methods[2],pop,sizeof(pop))||!draw_match(methods[3],flush,sizeof(flush))||!draw_match(methods[1]+0x13b,ret8,3)||!draw_match(methods[2]+0x98,ret4,3)||methods[3][0x82]!=0xc3)return false;
    d.begin=reinterpret_cast<DrawContextFn>(const_cast<unsigned char*>(start));d.end=reinterpret_cast<DrawContextFn>(const_cast<unsigned char*>(finish));d.flag=flag;
    d.root=reinterpret_cast<DrawRootFn>(const_cast<unsigned char*>(methods[0]));d.push=reinterpret_cast<DrawPushFn>(const_cast<unsigned char*>(methods[1]));d.pop=reinterpret_cast<DrawPopFn>(const_cast<unsigned char*>(methods[2]));d.flush=reinterpret_cast<DrawContextFn>(const_cast<unsigned char*>(methods[3]));d.state=1;return true;
}
uint32_t draw_scope(uint32_t token){
    if(!paintCallback||!(paintMode&3))return L4P_BAD_ARGUMENT;auto& s=service();auto i=s.subs.find(token);
    if(!s.running||i==s.subs.end()||!i->second->active)return L4P_BAD_ARGUMENT;
    return i->second->scope==L4P_SOURCE_ANY||allowed(&s.frame,i->second->scope)?L4P_OK:L4P_ENTITY_SCOPE;
}
uint32_t draw_touch(uint32_t token){
    auto result=draw_scope(token);if(result!=L4P_OK)return result;if(drawTouched)return L4P_OK;if(!draw_resolve())return L4P_ENTITY_MISSING;auto& d=drawing();
    if(*d.flag){drawTouched=true;return L4P_OK;}
    auto panel=d.root(d.surface);if(!panel)return L4P_ENTITY_MISSING;d.begin(d.surface);drawOwned=*d.flag!=0;
    if(!drawOwned)return L4P_ERROR;drawPanel=panel;d.push(d.surface,panel,false);drawTouched=true;return L4P_OK;
}
void draw_finish(){auto& d=drawing();if(drawTouched&&d.state==1){if(drawOwned){if(*d.flag&&drawPanel)d.pop(d.surface,drawPanel);if(*d.flag)d.end(d.surface);}else if(*d.flag)d.flush(d.surface);}drawTouched=drawOwned=false;drawPanel=0;}
bool draw_coord(int value){return value>=-65536&&value<=65536;}
uint32_t draw_color(L4P_ColorV1 color,bool text=false){using Fn=void(__thiscall*)(void*,int,int,int,int);auto& d=drawing();auto fn=method<Fn>(d.surface,text?19:11);if(!fn)return L4P_ENTITY_MISSING;fn(d.surface,color.r,color.g,color.b,color.a);return L4P_OK;}
uint32_t L4P_CALL draw_screen(uint32_t token,int32_t* width,int32_t* height){
    if(!width||!height)return L4P_BAD_ARGUMENT;auto result=draw_scope(token);if(result!=L4P_OK)return result;auto& d=drawing();if(!d.surface)d.surface=iface(L"vguimatsurface.dll","VGUI_Surface031");
    using Fn=void(__thiscall*)(void*,int*,int*);auto fn=method<Fn>(d.surface,35);if(!fn)return L4P_ENTITY_MISSING;int w=0,h=0;fn(d.surface,&w,&h);if(w<8||h<8||w>32768||h>32768)return L4P_ENTITY_MISSING;*width=w;*height=h;return L4P_OK;
}
uint32_t L4P_CALL draw_project(uint32_t token,const float* world,float* out){
    if(!out||!effects_finite(world))return L4P_BAD_ARGUMENT;int w=0,h=0;auto result=draw_screen(token,&w,&h);if(result!=L4P_OK)return result;if(!service().frame.in_game)return L4P_ENTITY_MISSING;
    using Fn=const float*(__thiscall*)(void*);auto fn=method<Fn>(service().engine,37);if(!fn)return L4P_ENTITY_MISSING;float m[16]{};if(!entity_copy(m,fn(service().engine),sizeof(m)))return L4P_ENTITY_MISSING;
    float z=m[12]*world[0]+m[13]*world[1]+m[14]*world[2]+m[15];if(!std::isfinite(z)||z<.001f)return L4P_ENTITY_MISSING;
    float x=w*.5f+(.5f*w)*(m[0]*world[0]+m[1]*world[1]+m[2]*world[2]+m[3])/z+.5f;
    float y=h*.5f-(.5f*h)*(m[4]*world[0]+m[5]*world[1]+m[6]*world[2]+m[7])/z+.5f;
    if(!std::isfinite(x)||!std::isfinite(y)||x<=-80||x>=w+80||y<=-80||y>=h+80)return L4P_ENTITY_MISSING;out[0]=x;out[1]=y;return L4P_OK;
}
uint32_t draw_shape(uint32_t token,int x0,int y0,int x1,int y1,L4P_ColorV1 color,int index){
    if(!draw_coord(x0)||!draw_coord(y0)||!draw_coord(x1)||!draw_coord(y1))return L4P_BAD_ARGUMENT;auto result=draw_touch(token);if(result!=L4P_OK)return result;
    auto& d=drawing();using Shape=void(__thiscall*)(void*,int,int,int,int);using Texture=void(__thiscall*)(void*,int);
    auto shape=method<Shape>(d.surface,index);auto texture=method<Texture>(d.surface,29);if(!shape||!texture)return L4P_ENTITY_MISSING;
    if((result=draw_color(color))!=L4P_OK)return result;texture(d.surface,0);shape(d.surface,x0,y0,x1,y1);return L4P_OK;
}
uint32_t L4P_CALL draw_rect(uint32_t token,int32_t x,int32_t y,int32_t w,int32_t h,L4P_ColorV1 color,uint32_t filled){if(w<0||h<0||w>32768||h>32768||filled>1||!draw_coord(x)||!draw_coord(y))return L4P_BAD_ARGUMENT;return draw_shape(token,x,y,x+w,y+h,color,filled?12:14);}
uint32_t L4P_CALL draw_line(uint32_t token,int32_t x0,int32_t y0,int32_t x1,int32_t y1,L4P_ColorV1 color){return draw_shape(token,x0,y0,x1,y1,color,15);}
uint32_t L4P_CALL draw_font(uint32_t token,const char* face,int32_t height,int32_t weight,uint32_t flags,uint32_t* out){
    if(!face||!*face||strlen(face)>63||!out||height<8||height>128||weight<100||weight>1000||(flags&~0xa90u))return L4P_BAD_ARGUMENT;
    auto result=draw_scope(token);if(result!=L4P_OK)return result;auto& d=drawing();if(!d.surface)d.surface=iface(L"vguimatsurface.dll","VGUI_Surface031");
    auto key=std::make_tuple(std::string(face),height,weight,flags);auto i=d.fonts.find(key);if(i!=d.fonts.end()){if(!i->second)return L4P_ENTITY_MISSING;*out=i->second;return L4P_OK;}
    if(d.fonts.size()>=128)return L4P_ERROR;using Create=unsigned long(__thiscall*)(void*);using Glyph=bool(__thiscall*)(void*,unsigned long,const char*,int,int,int,int,int,int,int);
    auto create=method<Create>(d.surface,63);auto glyph=method<Glyph>(d.surface,64);if(!create||!glyph)return L4P_ENTITY_MISSING;
    auto font=create(d.surface);if(!font||!glyph(d.surface,font,face,height,weight,0,0,int(flags),0,0)){d.fonts.emplace(key,0);return L4P_ENTITY_MISSING;}
    d.fonts.emplace(std::move(key),font);d.fontIds.insert(font);*out=font;return L4P_OK;
}
bool draw_wide(const char* text,std::wstring& out){if(!text||strlen(text)>4096)return false;int n=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text,-1,nullptr,0);if(n<=0)return false;out.resize(n);if(!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text,-1,out.data(),n))return false;out.resize(n-1);return true;}
uint32_t L4P_CALL draw_measure(uint32_t token,uint32_t font,const char* text,int32_t* width,int32_t* height){
    if(!width||!height)return L4P_BAD_ARGUMENT;auto result=draw_scope(token);if(result!=L4P_OK)return result;auto& d=drawing();if(!d.fontIds.count(font))return L4P_BAD_ARGUMENT;std::wstring wide;if(!draw_wide(text,wide))return L4P_BAD_ARGUMENT;
    using Fn=void(__thiscall*)(void*,unsigned long,const wchar_t*,int*,int*);auto fn=method<Fn>(d.surface,72);if(!fn)return L4P_ENTITY_MISSING;int w=0,h=0;fn(d.surface,font,wide.c_str(),&w,&h);*width=w;*height=h;return L4P_OK;
}
uint32_t L4P_CALL draw_text(uint32_t token,uint32_t font,int32_t x,int32_t y,L4P_ColorV1 color,const char* text){
    if(!draw_coord(x)||!draw_coord(y))return L4P_BAD_ARGUMENT;auto result=draw_touch(token);if(result!=L4P_OK)return result;auto& d=drawing();if(!d.fontIds.count(font))return L4P_BAD_ARGUMENT;std::wstring wide;if(!draw_wide(text,wide))return L4P_BAD_ARGUMENT;
    using Font=void(__thiscall*)(void*,unsigned long);using Position=void(__thiscall*)(void*,int,int);using Print=void(__thiscall*)(void*,const wchar_t*,int,int);
    auto set=method<Font>(d.surface,17);auto position=method<Position>(d.surface,20);auto print=method<Print>(d.surface,22);if(!set||!position||!print)return L4P_ENTITY_MISSING;
    if((result=draw_color(color,true))!=L4P_OK)return result;set(d.surface,font);position(d.surface,x,y);print(d.surface,wide.c_str(),int(wide.size()),0);return L4P_OK;
}
uint32_t L4P_CALL draw_texture_file(uint32_t token,const char* material,uint32_t* id,int32_t* width,int32_t* height){
    if(!material||!audio_path(material)||!id||!width||!height)return L4P_BAD_ARGUMENT;auto result=draw_touch(token);if(result!=L4P_OK)return result;auto& d=drawing();
    // VFileSystem018 has IAppSystem as its first base, IBaseFileSystem at +4.
    // FileExists is the secondary vtable slot 10 (Skeeto's filesystem header).
    auto fileSystem=static_cast<unsigned char*>(iface(L"filesystem_stdio.dll","VFileSystem018"));if(!fileSystem)return L4P_ENTITY_MISSING;
    using Exists=bool(__thiscall*)(void*,const char*,const char*);auto exists=method<Exists>(fileSystem+4,10);const auto file=std::string("materials/")+material+".vmt";
    if(!exists||!exists(fileSystem+4,file.c_str(),"GAME"))return L4P_ENTITY_MISSING;
    auto found=d.textures.find(material);if(found==d.textures.end()){
        if(d.textures.size()>=256)return L4P_ERROR;using Create=int(__thiscall*)(void*,bool);using Set=void(__thiscall*)(void*,int,const char*,int,bool);using Size=void(__thiscall*)(void*,int,int*,int*);
        auto create=method<Create>(d.surface,34);auto set=method<Set>(d.surface,27);auto size=method<Size>(d.surface,30);if(!create||!set||!size)return L4P_ENTITY_MISSING;
        DrawTexture texture{};texture.id=create(d.surface,false);if(texture.id>=0){set(d.surface,texture.id,material,1,false);size(d.surface,texture.id,&texture.width,&texture.height);}
        if(texture.width<=0||texture.height<=0||texture.width>16384||texture.height>16384)texture.id=-1;
        found=d.textures.emplace(material,texture).first;if(texture.id>=0)d.textureIds.emplace(uint32_t(texture.id),material);
    }
    if(found->second.id<0)return L4P_ENTITY_MISSING;*id=found->second.id;*width=found->second.width;*height=found->second.height;return L4P_OK;
}
uint32_t L4P_CALL draw_texture(uint32_t token,uint32_t id,int32_t x,int32_t y,int32_t w,int32_t h,const float* uv,L4P_ColorV1 color){
    if(!uv||!draw_coord(x)||!draw_coord(y)||w<0||h<0||w>32768||h>32768||!draw_coord(x+w)||!draw_coord(y+h))return L4P_BAD_ARGUMENT;
    for(int i=0;i<4;++i)if(!std::isfinite(uv[i])||uv[i]<0||uv[i]>1)return L4P_BAD_ARGUMENT;
    auto result=draw_touch(token);if(result!=L4P_OK)return result;auto& d=drawing();if(!d.textureIds.count(id))return L4P_BAD_ARGUMENT;
    using Set=void(__thiscall*)(void*,int);using Sub=void(__thiscall*)(void*,int,int,int,int,float,float,float,float);auto set=method<Set>(d.surface,29);auto sub=method<Sub>(d.surface,98);if(!set||!sub)return L4P_ENTITY_MISSING;
    if((result=draw_color(color))!=L4P_OK)return result;set(d.surface,int(id));sub(d.surface,x,y,x+w,y+h,uv[0],uv[1],uv[2],uv[3]);return L4P_OK;
}
uint32_t L4P_CALL draw_status(L4P_DrawStatusV1* out){if(!out||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);auto& d=drawing();*out={sizeof(*out),d.state,uint32_t(d.fonts.size()),uint32_t(d.textures.size())};return L4P_OK;}
