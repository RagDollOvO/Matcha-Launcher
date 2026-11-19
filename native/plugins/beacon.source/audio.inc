// GPL-3.0. Skeeto EngEmitLocalSpatialVoice and local SFX, owned by Source SDK.
// IEngineSoundClient003 GUID methods match Valve's L4D2 IEngineSound.h (14..16).
struct AudioOwner {uint32_t bank;bool stopping=false;std::set<int> voices;};
struct AudioService {void* engine=nullptr;std::array<bool,128> banks{};std::map<uint32_t,AudioOwner> owners;};
AudioService& audio_service(){static auto* a=new AudioService;return *a;}
struct AudioRecipients {void** vtable;int player;};
void* __fastcall audio_destructor(void* self,void*,unsigned){return self;}
bool __fastcall audio_false(void*,void*){return false;}
int __fastcall audio_count(void*,void*){return 1;}
int __fastcall audio_recipient(void* self,void*,int){return static_cast<AudioRecipients*>(self)->player;}
void* audioRecipientVtable[]={reinterpret_cast<void*>(&audio_destructor),reinterpret_cast<void*>(&audio_false),reinterpret_cast<void*>(&audio_false),reinterpret_cast<void*>(&audio_count),reinterpret_cast<void*>(&audio_recipient)};
bool audio_path(const char* path){
    if(!path||!*path||strlen(path)>240)return false;
    const std::string p=path;return p.front()!='/'&&p.find("..") == std::string::npos&&p.find_first_of(":\\\r\n\";")==std::string::npos&&p.find('\0')==std::string::npos;
}
void* audio_engine(){auto& a=audio_service();if(!a.engine)a.engine=iface(L"engine.dll","IEngineSoundClient003");return a.engine;}
uint32_t L4P_CALL audio_prepare(uint32_t token,const char* sample){
    if(!callbackThread||!audio_path(sample))return L4P_BAD_ARGUMENT;auto status=effects_scope(token);if(status!=L4P_OK)return status;
    auto e=audio_engine();using Has=bool(__thiscall*)(void*,const char*);using Prepare=bool(__thiscall*)(void*,const char*,bool,bool);
    auto has=method<Has>(e,1);auto prepare=method<Prepare>(e,0);if(!has||!prepare)return L4P_ENTITY_MISSING;
    return has(e,sample)||prepare(e,sample,false,false)?L4P_OK:L4P_ENTITY_MISSING;
}
void audio_epoch(){auto& a=audio_service();auto e=audio_engine();using Playing=bool(__thiscall*)(void*,int);using Stop=void(__thiscall*)(void*,int);
    auto playing=method<Playing>(e,15);auto stop=method<Stop>(e,16);
    if(playing&&stop)for(auto& p:a.owners)for(int id:p.second.voices)if(playing(e,id))stop(e,id);
    a.owners.clear();a.banks.fill(false);
}
void audio_pump(){
    auto& a=audio_service();if(a.owners.empty())return;auto e=audio_engine();using Playing=bool(__thiscall*)(void*,int);using Stop=void(__thiscall*)(void*,int);
    auto playing=method<Playing>(e,15);auto stop=method<Stop>(e,16);if(!playing||!stop)return;
    for(auto i=a.owners.begin();i!=a.owners.end();){auto& owner=i->second;bool remove=owner.stopping||effects_scope(i->first)!=L4P_OK;
        for(auto v=owner.voices.begin();v!=owner.voices.end();){if(!playing(e,*v)){v=owner.voices.erase(v);continue;}if(remove){stop(e,*v);v=owner.voices.erase(v);continue;}++v;}
        if(remove){a.banks[owner.bank]=false;i=a.owners.erase(i);}else ++i;
    }
}
uint32_t L4P_CALL audio_stop(uint32_t token){
    auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);auto& a=audio_service();auto i=a.owners.find(token);if(i!=a.owners.end())i->second.stopping=true;if(callbackThread)audio_pump();return L4P_OK;
}
uint32_t L4P_CALL audio_emit(uint32_t token,const L4P_AudioEmitV1* input,int32_t* guid){
    if(!callbackThread||!input||!guid||input->struct_size!=sizeof(*input)||input->slot>7||input->spatial>1||!std::isfinite(input->volume)||input->volume<0||input->volume>1||!std::isfinite(input->attenuation)||input->attenuation<0||input->attenuation>4||input->pitch<1||input->pitch>255)return L4P_BAD_ARGUMENT;
    auto status=audio_prepare(token,input->sample);if(status!=L4P_OK)return status;int index=-1;
    if(input->spatial){if(!effects_finite(input->origin))return L4P_BAD_ARGUMENT;EntityRecord* record=nullptr;status=entity_resolve(&input->entity,record);if(status!=L4P_OK)return status;index=int(input->entity.index);}
    auto e=audio_engine();using Emit=void(__thiscall*)(void*,void*,int,int,const char*,float,float,int,int,const float*,const float*,void*,bool,float,int);using Guid=int(__thiscall*)(void*);using Playing=bool(__thiscall*)(void*,int);using Stop=void(__thiscall*)(void*,int);
    auto emit=method<Emit>(e,6);auto last=method<Guid>(e,14);auto playing=method<Playing>(e,15);auto stop=method<Stop>(e,16);if(!emit||!last||!playing||!stop)return L4P_ENTITY_MISSING;
    auto& a=audio_service();audio_pump();auto i=a.owners.find(token);
    if(i==a.owners.end()){auto bank=std::find(a.banks.begin(),a.banks.end(),false);if(bank==a.banks.end())return L4P_ERROR;uint32_t b=uint32_t(bank-a.banks.begin());*bank=true;i=a.owners.emplace(token,AudioOwner{b}).first;}
    if(i->second.voices.size()>=256)return L4P_ERROR;
    AudioRecipients filter{audioRecipientVtable,service().frame.local_player};if(filter.player<=0)return L4P_ENTITY_MISSING;
    const int before=last(e);
    emit(e,&filter,index,256+int(i->second.bank)*8+int(input->slot),input->sample,input->volume,input->spatial?input->attenuation:0.f,0,input->pitch,input->spatial?input->origin:nullptr,nullptr,nullptr,true,0.f,-1);
    const int id=last(e);if(id<0||id==before)return L4P_ERROR;i->second.voices.insert(id);*guid=id;return L4P_OK;
}
