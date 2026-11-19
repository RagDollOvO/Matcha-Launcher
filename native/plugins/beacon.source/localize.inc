// GPL-3.0. Skeeto BOT-name VGUI_Localize005 read interception, generalized.
struct LocalizedValue{uint32_t token;const wchar_t* text;};
struct LocalizeService{
    std::map<std::string,LocalizedValue> values;std::set<std::wstring> strings;
    void** location=nullptr;std::atomic<void*> original{nullptr};uint32_t state=0;
};
LocalizeService& localization(){static auto* s=new LocalizeService;return *s;}
std::string localize_key(const char* key){if(!key)return {};if(*key=='#')++key;if(!*key||strlen(key)>79||strspn(key,"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")!=strlen(key))return {};return cvar_key(key);}
bool localize_active(uint32_t token){auto& s=service();auto sub=s.subs.find(token);return s.running&&sub!=s.subs.end()&&sub->second->active&&(sub->second->scope==L4P_SOURCE_ANY||allowed(&s.frame,sub->second->scope));}
wchar_t* __fastcall localize_find(void* self,void*,const char* key){auto& l=localization();using Fn=wchar_t*(__thiscall*)(void*,const char*);auto original=reinterpret_cast<Fn>(l.original.load());
    auto fallback=original?original(self,key):nullptr;std::lock_guard<std::recursive_mutex> lock(service().mutex);
    auto found=l.values.find(localize_key(key));return found!=l.values.end()&&localize_active(found->second.token)?const_cast<wchar_t*>(found->second.text):fallback;
}
void localize_pump(){auto& l=localization();bool wanted=false;for(const auto& p:l.values)if(localize_active(p.second.token)){wanted=true;break;}
    auto hook=reinterpret_cast<void*>(&localize_find);if(!wanted){
        if(l.location&&readable(l.location,4)&&*l.location==hook)cvar_swap(l.location,hook,l.original.load());l.state=0;return;}
    auto object=iface(L"vgui2.dll","VGUI_Localize005");auto original=slot(object,2);if(!original){l.state=1;return;}auto location=&(*static_cast<void***>(object))[2];
    if(l.location&&(l.location!=location||(original!=hook&&original!=l.original.load()))){l.state=3;return;}
    if(!l.location){l.location=location;l.original.store(original);}
    l.state=original==hook||cvar_swap(location,original,hook)?2:3;
}
void localize_remove(uint32_t token){auto& l=localization();for(auto i=l.values.begin();i!=l.values.end();)if(!token||i->second.token==token)i=l.values.erase(i);else ++i;}
uint32_t L4P_CALL localize_set(uint32_t token,const char* key,const char* value){if(!paintCallback||!value||!*value||strlen(value)>1024)return L4P_BAD_ARGUMENT;
    auto name=localize_key(key);if(name.empty())return L4P_BAD_ARGUMENT;wchar_t wide[257]{};int size=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,value,-1,wide,257);if(size<2)return L4P_BAD_ARGUMENT;
    for(int i=0;i<size-1;++i)if(wide[i]<32||wide[i]==127)return L4P_BAD_ARGUMENT;
    if(!localize_active(token))return L4P_ENTITY_SCOPE;auto& l=localization();auto it=l.values.find(name);if(it!=l.values.end()&&it->second.token!=token)return 5;
    if((it==l.values.end()&&l.values.size()>=256)||(l.strings.size()>=4096&&!l.strings.count(wide)))return L4P_ERROR;
    auto stable=l.strings.insert(wide).first;l.values[name]={token,stable->c_str()};localize_pump();return l.state==2?L4P_OK:l.state==3?5:L4P_ENTITY_MISSING;
}
uint32_t L4P_CALL localize_clear(uint32_t token,const char* key){auto name=key?localize_key(key):std::string();if(!token||(key&&name.empty()))return L4P_BAD_ARGUMENT;
    std::lock_guard<std::recursive_mutex> lock(service().mutex);auto& values=localization().values;
    if(!key)localize_remove(token);else{auto found=values.find(name);if(found!=values.end()&&found->second.token==token)values.erase(found);}if(paintCallback)localize_pump();return L4P_OK;
}
uint32_t L4P_CALL localize_status(uint32_t* out){if(!out)return L4P_BAD_ARGUMENT;std::lock_guard<std::recursive_mutex> lock(service().mutex);*out=localization().state;return L4P_OK;}
uint32_t L4P_CALL localize_read(const char* key,char* output,uint32_t capacity,uint32_t* size){if(!paintCallback||localize_key(key).empty()||!output||!size)return L4P_BAD_ARGUMENT;
    auto object=iface(L"vgui2.dll","VGUI_Localize005");using Fn=wchar_t*(__thiscall*)(void*,const char*);auto fn=method<Fn>(object,2);if(!fn)return L4P_ENTITY_MISSING;
    const wchar_t* value=fn(object,key);wchar_t wide[1025]{};size_t length=0;
    for(;length<1025;++length){if(!entity_copy(wide+length,value?value+length:nullptr,sizeof(wchar_t)))return L4P_ENTITY_MISSING;if(!wide[length])break;}
    if(length==1025)return L4P_ENTITY_MISSING;int needed=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,wide,-1,nullptr,0,nullptr,nullptr);if(!needed)return L4P_ENTITY_MISSING;
    *size=uint32_t(needed);if(capacity<*size)return L4P_BUFFER_TOO_SMALL;WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,wide,-1,output,needed,nullptr,nullptr);return L4P_OK;
}
