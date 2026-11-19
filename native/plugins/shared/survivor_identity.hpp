// GPL-3.0. Skeeto 2.2.19 TeamHudResolveAvatarProp / TeamHudDedupRecs.
// Copied SDK values only; shared by independently built survivor-facing features.
#pragma once
#include "l4p_entity.h"
#include <string>
#include <vector>
#include <algorithm>
#include <cstring>
namespace skeeto_survivor {
inline std::string lower(std::string text){for(auto& c:text)if(c>='A'&&c<='Z')c+=32;return text;}
inline int name_role(const char* name){const char* names[]={"Nick","Rochelle","Coach","Ellis","Bill","Zoey","Francis","Louis"};
    for(int i=0;i<8;++i)if(!_stricmp(name,names[i]))return i;return -1;}
inline int model_role(const char* name){auto text=lower(std::string(name).substr(0,79));const char* names[]={"survivor_gambler","survivor_producer","survivor_coach","survivor_mechanic","survivor_namvet","survivor_teenangst","survivor_biker","survivor_manager"};
    for(int i=0;i<8;++i)if(text.find(names[i])!=std::string::npos)return i;return -1;}
inline int official_set(const std::string& map){auto base=lower(map.substr(map.find_last_of("/\\")+1));
    if(base.find("l4d1")!=std::string::npos)return 1;
    if(base.size()>2&&base[0]=='c'&&base[1]>='1'&&base[1]<='9'){
        unsigned n=0;size_t i=1;for(;i<base.size()&&base[i]>='0'&&base[i]<='9';++i)n=std::min(100u,n*10+unsigned(base[i]-'0'));
        if(i<base.size()&&base[i]=='m'){if((n>=7&&n<=12)||n==14)return 1;if(n>=1&&n<=13)return 2;}}
    return base.find("l4d2")!=std::string::npos?2:0;
}
struct Sample {
    L4P_EntityInfoV1 info{sizeof(info)};int raw=-1,model=-1,role=0,hp=100,observer=0,priority=0;
    unsigned char life=0,incap=0;bool dead=false;
};
struct Identity {
    std::string map;int cast=0;
    void clear(){map.clear();cast=0;}
    void map_changed(const char* value){if(*value&&_stricmp(value,map.c_str())){map=value;cast=official_set(map);}}
    int resolve(const Sample& p)const{
        if(p.raw>=4&&p.raw<=7)return p.raw;if(p.model>=0)return p.model;
        int named=p.info.is_bot?name_role(p.info.player_name):-1;if(named>=0)return named;
        if(p.raw<0||p.raw>3)return 0;const int l4d1[]={4,5,7,6};return cast==1?l4d1[p.raw]:p.raw;
    }
    std::vector<Sample> gather(const L4P_EntityApiV1& api,const char* currentMap){
        map_changed(currentMap);std::vector<Sample> rows;
        for(int index=1;index<=32&&rows.size()<16;++index){
            Sample p;L4P_EntityRefV1 ref{};if(api.reference(index,&ref)||api.describe(&ref,&p.info))continue;
            int team=0,zombie=0;if(api.read(&ref,"m_iTeamNum",L4P_FIELD_INT,&team)||team!=2)continue;
            api.read(&ref,"m_zombieClass",L4P_FIELD_INT,&zombie);if(zombie>=1&&zombie<=8)continue;
            if(!*p.info.player_name&&!strstr(p.info.class_name,"Player"))continue;
            const bool hasLife=api.read(&ref,"m_lifeState",L4P_FIELD_BYTE,&p.life)==0;
            const bool hasHp=api.read(&ref,"m_iHealth",L4P_FIELD_INT,&p.hp)==0;
            api.read(&ref,"m_isIncapacitated",L4P_FIELD_BYTE,&p.incap);api.read(&ref,"m_iObserverMode",L4P_FIELD_INT,&p.observer);
            if(p.observer&&!p.incap&&!(hasLife&&!p.life)&&!(hasHp&&p.hp>0))continue;
            p.priority=(hasLife&&!p.life?200:0)+(hasHp&&p.hp>0?100:0)+(p.incap?80:0)-(p.observer?120:0)-index;
            p.dead=!p.incap&&((hasLife&&p.life)||(hasHp&&p.hp<=0));
            api.read(&ref,"m_survivorCharacter",L4P_FIELD_INT,&p.raw);char model[260]{};uint32_t size=0;
            if(api.model_name(&ref,model,sizeof(model),&size)==0)p.model=model_role(model);rows.push_back(p);
        }
        // Upstream gathers at most 16 first, then deduplicates positive user IDs.
        std::vector<Sample> unique;for(const auto& p:rows){auto i=std::find_if(unique.begin(),unique.end(),[&](const auto& q){return p.info.user_id>0&&p.info.user_id==q.info.user_id;});
            if(i==unique.end())unique.push_back(p);else if(p.priority>i->priority)*i=p;}
        if(!cast){int one=0,two=0;for(const auto& p:unique){int role=p.info.is_bot?name_role(p.info.player_name):-1;if(role>=4)++one;else if(role>=0)++two;}
            if(one>=2&&!two)cast=1;else if(two>=2&&!one)cast=2;}
        for(auto& p:unique)p.role=resolve(p);return unique;
    }
};
}
