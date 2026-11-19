struct ResourceLease {uint32_t token;bool releasing=false;std::string id;};
std::map<std::string,ResourceLease> resources;
bool resource_name(const char* name){return name&&*name&&strlen(name)<=96&&strspn(name,"abcdefghijklmnopqrstuvwxyz0123456789._-")==strlen(name);}
void resource_pump(){for(auto i=resources.begin();i!=resources.end();){if(i->second.releasing||effects_scope(i->second.token)!=L4P_OK)i=resources.erase(i);else ++i;}}
uint32_t L4P_CALL resource_claim(uint32_t token,const char* name){
    if(!paintCallback||!resource_name(name))return L4P_BAD_ARGUMENT;auto result=effects_scope(token);if(result!=L4P_OK)return result;
    auto i=resources.find(name);if(i!=resources.end()){if(i->second.token!=token)return L4P_RESOURCE_CONFLICT;i->second.releasing=false;return L4P_OK;}
    if(resources.size()>=256)return L4P_ERROR;resources.emplace(name,ResourceLease{token,false,service().subs.at(token)->id});return L4P_OK;
}
uint32_t L4P_CALL resource_release(uint32_t token,const char* name){
    if(name&&!resource_name(name))return L4P_BAD_ARGUMENT;auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);
    for(auto i=resources.begin();i!=resources.end();){if(i->second.token==token&&(!name||i->first==name)){if(paintCallback){i=resources.erase(i);continue;}i->second.releasing=true;}++i;}return L4P_OK;
}
uint32_t L4P_CALL resource_owner(const char* name,char* out){
    if(!resource_name(name)||!out)return L4P_BAD_ARGUMENT;auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);
    auto i=resources.find(name);out[0]=0;if(i!=resources.end())memcpy(out,i->second.id.c_str(),i->second.id.size()+1);return L4P_OK;
}
