#pragma once
#include "settings.h"
namespace layout {
struct Item {int custom=0,x=0,y=0,scale=100;};
struct Box {int x=0,y=0,w=0,h=0;};
static Item items[unsigned(items::Label::Count)],backup[unsigned(items::Label::Count)],saved[unsigned(items::Label::Count)];static Box boxes[unsigned(items::Label::Count)],visualBoxes[unsigned(items::Label::Count)],alignmentBoxes[unsigned(items::Label::Count)];
// Coordinates in the existing INI use the nominal scaled grid size. The
// painted cell can grow to fit text; never use that larger size as the origin
// of a different coordinate system when pinning a keyboard move.
static Box coordinateBases[unsigned(items::Label::Count)];
static unsigned saveWrites,saveFailures;
static bool active=false;static unsigned selected=1;static int width=1280,height=720;
struct SnapGuide {unsigned target=0;bool axisX=false;int coordinate=0;unsigned anchor=0;};
static SnapGuide snapGuide;
// Keep the unsnapped keyboard intent while the visible card is held on an
// anchor. Repeated small moves can then leave the snap radius naturally.
struct MoveIntent {bool valid=false,axisX=false;unsigned selected=0;int width=0,height=0,scale=0,x=0,y=0,raw=0;Box box,card;};
static MoveIntent moveIntent;
inline void ClearSnap(){snapGuide={};moveIntent={};}
inline int Anchor(Box b,bool axisX,unsigned anchor){int start=axisX?b.x:b.y,extent=axisX?b.w:b.h;return start+(anchor==1?extent/2:anchor==2?extent:0);}
inline bool GuideValid(){
    unsigned target=snapGuide.target;if(!active||!target||target>=unsigned(items::Label::Count)||selected>=unsigned(items::Label::Count)||target==selected||snapGuide.anchor>2)return false;
    if(!options::Enabled(items::Label(selected))||!options::Enabled(items::Label(target))||!moveIntent.valid||moveIntent.width!=width||moveIntent.height!=height||moveIntent.selected!=selected||moveIntent.scale!=items[selected].scale)return false;
    auto a=alignmentBoxes[selected],b=alignmentBoxes[target];return a.w>0&&a.h>0&&b.w>0&&b.h>0&&Anchor(a,snapGuide.axisX,snapGuide.anchor)==snapGuide.coordinate&&Anchor(b,snapGuide.axisX,snapGuide.anchor)==snapGuide.coordinate;
}
inline Box CoordinateSize(unsigned id){auto b=coordinateBases[id];float scale=float(items[id].scale)/100.f;b.w=Limit(int(float(b.w)*scale+.5f),16,width-8);b.h=Limit(int(float(b.h)*scale+.5f),8,height-8);return b;}
inline void Load(const WCHAR* path){ClearSnap();for(unsigned i=1;i<unsigned(items::Label::Count);++i){WCHAR section[24];wsprintfW(section,L"Item%02u",i);auto& item=items[i];item.custom=Limit(int(GetPrivateProfileIntW(section,L"Custom",0,path)),0,1);item.x=Limit(int(GetPrivateProfileIntW(section,L"X",0,path)),0,10000);item.y=Limit(int(GetPrivateProfileIntW(section,L"Y",0,path)),0,10000);item.scale=Limit(int(GetPrivateProfileIntW(section,L"Scale",100,path)),50,200);saved[i]=item;}}
// True means every changed key is durable. A failed key retains its previous
// baseline so the next save retries it without rewriting successful keys.
inline bool Save(const WCHAR* path){
    bool ok=true;
    for(unsigned i=1;i<unsigned(items::Label::Count);++i){
        WCHAR section[24],number[16];wsprintfW(section,L"Item%02u",i);
        const WCHAR* keys[]={L"Custom",L"X",L"Y",L"Scale"};
        const int values[]={items[i].custom,items[i].x,items[i].y,items[i].scale};
        const int previous[]={saved[i].custom,saved[i].x,saved[i].y,saved[i].scale};
        for(unsigned k=0;k<4;++k){
            if(values[k]==previous[k])continue;
            wsprintfW(number,L"%d",values[k]);++saveWrites;
            if(!WritePrivateProfileStringW(section,keys[k],number,path)){++saveFailures;ok=false;continue;}
            switch(k){case 0:saved[i].custom=values[k];break;case 1:saved[i].x=values[k];break;case 2:saved[i].y=values[k];break;case 3:saved[i].scale=values[k];break;}
        }
    }
    return ok;
}
inline bool Dirty(){for(unsigned i=1;i<unsigned(items::Label::Count);++i)if(items[i].custom!=saved[i].custom||items[i].x!=saved[i].x||items[i].y!=saved[i].y||items[i].scale!=saved[i].scale)return true;return false;}
inline unsigned Next(unsigned from,bool backwards){for(unsigned k=1;k<unsigned(items::Label::Count);++k){unsigned i=backwards?(from+unsigned(items::Label::Count)-k)%unsigned(items::Label::Count):(from+k)%unsigned(items::Label::Count);if(options::Enabled(items::Label(i)))return i;}return from;}
inline void Begin(unsigned id=0){if(id&&!options::Enabled(items::Label(id)))return;if(active){if(id){selected=id;ClearSnap();}return;}ClearSnap();if(id)selected=id;if(!options::Enabled(items::Label(selected)))selected=Next(0,false);if(!options::Enabled(items::Label(selected)))return;for(unsigned i=0;i<unsigned(items::Label::Count);++i)backup[i]=items[i];active=true;}
inline void End(bool commit){if(!commit)for(unsigned i=0;i<unsigned(items::Label::Count);++i)items[i]=backup[i];active=false;ClearSnap();}
inline int Position(int screen,int cell,int normalized){return 4+((screen-cell-8)*normalized+5000)/10000;}
inline Box Place(unsigned id,Box automatic){if(id>=unsigned(items::Label::Count))return automatic;auto& item=items[id];coordinateBases[id]=automatic;Box b=CoordinateSize(id);if(item.custom){b.x=Position(width,b.w,item.x);b.y=Position(height,b.h,item.y);}b.x=Limit(b.x,4,width-b.w-4);b.y=Limit(b.y,item.custom?4:2,height-b.h-4);boxes[id]=b;return b;}
inline void Pin(unsigned id,int x,int y,int w,int h){auto& item=items[id];item.custom=1;auto coordinate=CoordinateSize(id);int spanX=width-coordinate.w-8,spanY=height-coordinate.h-8;x=Limit(x,4,width-w-4);y=Limit(y,4,height-h-4);item.x=spanX>0?Limit(((x-4)*10000+spanX/2)/spanX,0,10000):0;item.y=spanY>0?Limit(((y-4)*10000+spanY/2)/spanY,0,10000):0;}
inline void Include(Box& bounds,Box drawn){if(drawn.w<=0||drawn.h<=0)return;int right=bounds.x+bounds.w,bottom=bounds.y+bounds.h;if(drawn.x+drawn.w>right)right=drawn.x+drawn.w;if(drawn.y+drawn.h>bottom)bottom=drawn.y+drawn.h;if(drawn.x<bounds.x)bounds.x=drawn.x;if(drawn.y<bounds.y)bounds.y=drawn.y;bounds.w=right-bounds.x;bounds.h=bottom-bounds.y;}
inline bool SameBox(Box a,Box b){return a.x==b.x&&a.y==b.y&&a.w==b.w&&a.h==b.h;}
// Reproduce Place's normalized-coordinate rounding immediately, including the
// painted cell's bounds. A later draw must not reset intent by rounding a move.
inline Box PinnedBox(unsigned id,Box b){auto coordinate=CoordinateSize(id);b.x=Limit(Position(width,coordinate.w,items[id].x),4,width-b.w-4);b.y=Limit(Position(height,coordinate.h,items[id].y),4,height-b.h-4);return b;}
inline void Move(bool axisX,int step,bool freeMove){
    auto& item=items[selected];auto b=boxes[selected],card=alignmentBoxes[selected];
    bool same=moveIntent.valid&&moveIntent.axisX==axisX&&moveIntent.selected==selected&&moveIntent.width==width&&moveIntent.height==height&&moveIntent.scale==item.scale&&moveIntent.x==item.x&&moveIntent.y==item.y&&SameBox(moveIntent.box,b)&&SameBox(moveIntent.card,card);
    int raw=(!freeMove&&same?moveIntent.raw:axisX?b.x:b.y)+step;
    raw=Limit(raw,4,(axisX?width-b.w:height-b.h)-4);int position=raw;snapGuide={};
    if(!freeMove&&card.w>0&&card.h>0){
        auto proposed=card;if(axisX)proposed.x+=raw-b.x;else proposed.y+=raw-b.y;
        int radius=Limit((height*6+360)/720,4,12),best=radius+1;
        for(unsigned id=1;id<unsigned(items::Label::Count);++id){
            auto target=alignmentBoxes[id];if(id==selected||!options::Enabled(items::Label(id))||target.w<=0||target.h<=0)continue;
            for(unsigned anchor=0;anchor<3;++anchor){
                int coordinate=Anchor(target,axisX,anchor),delta=coordinate-Anchor(proposed,axisX,anchor),distance=delta<0?-delta:delta;
                int candidate=raw+delta;if(distance>=best||candidate<4||candidate>(axisX?width-b.w:height-b.h)-4)continue;
                best=distance;position=candidate;snapGuide={id,axisX,coordinate,anchor};
            }
        }
    }
    bool custom=item.custom!=0;int previousX=item.x,previousY=item.y;
    Pin(selected,axisX?position:b.x,axisX?b.y:position,b.w,b.h);
    if(custom){if(axisX)item.y=previousY;else item.x=previousX;}
    auto moved=PinnedBox(selected,b);int dx=moved.x-b.x,dy=moved.y-b.y;boxes[selected]=moved;
    visualBoxes[selected].x+=dx;visualBoxes[selected].y+=dy;alignmentBoxes[selected].x+=dx;alignmentBoxes[selected].y+=dy;
    moveIntent={true,axisX,selected,width,height,item.scale,item.x,item.y,raw,moved,alignmentBoxes[selected]};
    if(freeMove)ClearSnap();else if(snapGuide.target&&!GuideValid())snapGuide={};
}
// Return 1: handled, 2: save, 3: cancel. No changes persist before explicit save.
inline int Key(unsigned key,bool shift,bool freeMove=false){if(!active)return 0;if(!options::Enabled(items::Label(selected))){selected=Next(0,false);ClearSnap();if(!options::Enabled(items::Label(selected))){End(false);return 0;}}if(key==13)return 2;if(key==27)return 3;
    if(!options::Enabled(items::Label(selected)))return 1;if(key=='R'){items[selected]={};ClearSnap();return 1;}auto& item=items[selected];Box b=boxes[selected];if(!b.w||!b.h)return 1;
    if(key>=37&&key<=40){int step=shift?10:2;if(key==37||key==38)step=-step;Move(key==37||key==39,step,freeMove);return 1;}
    if(key==187||key==107||key==189||key==109){ClearSnap();int next=Limit(item.scale+((key==187||key==107)?5:-5),50,200);if(next==item.scale)return 1;int nw=(b.w*next+item.scale/2)/item.scale,nh=(b.h*next+item.scale/2)/item.scale;item.scale=next;Pin(selected,b.x,b.y,nw,nh);boxes[selected].w=nw;boxes[selected].h=nh;return 1;}return 0;
}
}
