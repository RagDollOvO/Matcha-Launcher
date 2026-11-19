// GPL-3.0. Small configuration helper for independent SDK features.
#pragma once
#include <windows.h>
#include <nlohmann/json.hpp>
#include <filesystem>
#include <fstream>
#include <cmath>
#include <algorithm>
namespace flare_feature {
using nlohmann::json;
inline bool validate(const json& fields,const json& input,json& output){
    if(!input.is_object())return false;output=json::object();
    for(const auto& p:input.items())if(!fields.contains(p.key()))return false;
    for(const auto& p:fields.items()){const auto& spec=p.value();const auto value=input.contains(p.key())?input[p.key()]:spec["default"];
        const auto type=spec["type"].get<std::string>();
        if(type=="boolean"){if(!value.is_boolean())return false;}
        else if(type=="integer"||type=="number"){
            if(!value.is_number()||(type=="integer"&&!value.is_number_integer()))return false;double n=value.get<double>();
            if(!std::isfinite(n)||n<spec["minimum"].get<double>()||n>spec["maximum"].get<double>())return false;
        }else if(type=="enum"){if(!value.is_string()||std::find(spec["options"].begin(),spec["options"].end(),value)==spec["options"].end())return false;}
        else if(type=="string"){if(!value.is_string())return false;const auto& s=value.get_ref<const std::string&>();
            if(std::count_if(s.begin(),s.end(),[](unsigned char c){return (c&0xc0)!=0x80;})>spec.value("maxLength",4096u))return false;}
        else return false;
        output[p.key()]=value;
    }return true;
}
inline bool save(const std::filesystem::path& file,const json& settings){
    auto stage=file;stage+=L".pending";{std::ofstream out(stage,std::ios::binary|std::ios::trunc);out<<settings.dump(2);out.flush();if(!out)return false;}
    return MoveFileExW(stage.c_str(),file.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)!=0;
}
}
