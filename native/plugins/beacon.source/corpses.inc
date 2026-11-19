// GPL-3.0. Skeeto ClientUxHideEntHard; owned values replace hard-coded unhide.
struct CorpseField {int offset=-1;uint32_t before=0,written=0;bool owned=false;};
struct CorpseLease {uint32_t token=0;L4P_EntityRefV1 ref{};void* object=nullptr;const uint32_t* serial=nullptr;EntityClientClass* klass=nullptr;CorpseField fields[3];bool releasing=false;};
std::map<uint32_t,CorpseLease> corpses;
bool corpse_class(const char* name){
    if(strstr(name,"TerrorPlayer")||strstr(name,"CSPlayer")||!_stricmp(name,"C_BasePlayer")||!_stricmp(name,"CBasePlayer"))return false;
    for(auto n:{"C_ClientRagdoll","C_ClientRagdoll2","client_ragdoll","client_ragdoll2","C_InfectedRagdoll","CInfectedRagdoll","CCSRagdoll","C_CSRagdoll"})if(!_stricmp(name,n))return true;
    return !_stricmp(name,"Infected")||!_stricmp(name,"C_Infected")||!_stricmp(name,"Witch")||!_stricmp(name,"C_Witch")||strstr(name,"Ragdoll")||strstr(name,"ragdoll");
}
uint32_t corpse_gate(uint32_t token){auto result=effects_scope(token);if(result)return result;
    return service().subs.at(token)->scope==L4P_SOURCE_LOCAL&&service().frame.local_server?L4P_OK:L4P_ENTITY_SCOPE;}
// Direct identity check also works after shutdown reset the public frame.
int corpse_identity(const CorpseLease& l){if(l.ref.epoch!=entity_service().epoch)return 0;
    using Get=void*(__thiscall*)(void*,int);auto get=method<Get>(entity_service().list,3),net=method<Get>(entity_service().list,0);
    if(!get||!net)return 2;if(get(entity_service().list,int(l.ref.index))!=l.object)return 0;
    uint32_t serial=0;if(!entity_copy(&serial,l.serial,4))return 2;if(serial!=l.ref.handle)return 0;
    auto network=net(entity_service().list,int(l.ref.index));using Class=EntityClientClass*(__thiscall*)(void*);auto klass=method<Class>(network,1);if(!klass)return 2;return klass(network)==l.klass?1:0;
}
bool corpse_restore(CorpseLease& l){auto identity=corpse_identity(l);if(!identity)return true;if(identity==2)return false;bool complete=true;
    for(unsigned i=0;i<3;++i){auto& f=l.fields[i];if(!f.owned)continue;const size_t bytes=i==1?1:4;auto ptr=static_cast<unsigned char*>(l.object)+f.offset;uint32_t current=0;
        if(!entity_copy(&current,ptr,bytes)){complete=false;continue;}
        if(i==0){if((current&32)!=(f.written&32)){f.owned=false;continue;}current=(current&~32u)|(f.before&32);}
        else {if(current!=f.written){f.owned=false;continue;}current=f.before;}
        SIZE_T done=0;if(!writable(ptr,bytes)||!WriteProcessMemory(GetCurrentProcess(),ptr,&current,bytes,&done)||done!=bytes){complete=false;continue;}f.owned=false;
    }return complete;
}
void corpse_epoch(){corpses.clear();}
void corpse_pump(){for(auto i=corpses.begin();i!=corpses.end();){auto& l=i->second;
    if(!corpse_identity(l)||((l.releasing||corpse_gate(l.token)!=L4P_OK)&&corpse_restore(l))){i=corpses.erase(i);continue;}++i;}}
uint32_t L4P_CALL corpse_release(uint32_t token,const L4P_EntityRefV1* ref){
    if(!token||(ref&&(ref->index<65||ref->index>=2048)))return L4P_BAD_ARGUMENT;std::lock_guard<std::recursive_mutex> lock(service().mutex);
    for(auto& p:corpses){auto& l=p.second;if(l.token==token&&(!ref||(l.ref.index==ref->index&&l.ref.handle==ref->handle&&l.ref.epoch==ref->epoch)))l.releasing=true;}
    if(paintCallback)corpse_pump();return L4P_OK;
}
uint32_t L4P_CALL corpse_hide(uint32_t token,const L4P_EntityRefV1* ref){
    if(!paintCallback||!ref||ref->index<65||ref->index>=2048)return L4P_BAD_ARGUMENT;auto code=corpse_gate(token);if(code)return code;
    EntityRecord* r=nullptr;code=entity_resolve(ref,r);if(code)return code;if(diss_target_owned(*ref))return L4P_CORPSE_CONFLICT;L4P_EntityInfoV1 info{sizeof(info)};
    if(entity_describe(ref,&info)||!corpse_class(info.class_name))return L4P_ENTITY_MISSING;
    auto i=corpses.find(ref->index);if(i!=corpses.end()&&!corpse_identity(i->second)){corpses.erase(i);i=corpses.end();}
    if(i!=corpses.end()&&corpse_identity(i->second)==2)return L4P_ENTITY_MISSING;
    if(i!=corpses.end()&&(i->second.token!=token||i->second.releasing))return L4P_CORPSE_CONFLICT;
    if(i==corpses.end()){
        if(corpses.size()>=256)return L4P_ERROR;using Handle=const uint32_t*(__thiscall*)(void*);auto handle=method<Handle>(r->entity,2);if(!handle)return L4P_ENTITY_MISSING;
        CorpseLease l{};l.token=token;l.ref=*ref;l.object=r->entity;l.serial=handle(r->entity);l.klass=r->klass;
        const char* names[]={"m_fEffects","m_nRenderMode","m_clrRender"};
        for(unsigned k=0;k<3;++k){auto f=entity_field(*r,names[k]);if(f.type==0&&f.offset>0&&f.offset<=0x4000)l.fields[k].offset=f.offset;}
        i=corpses.emplace(ref->index,l).first;
    }
    auto& l=i->second;bool any=false,failed=false;
    for(unsigned k=0;k<3;++k){auto& f=l.fields[k];if(f.offset<0)continue;size_t bytes=k==1?1:4;auto ptr=static_cast<unsigned char*>(l.object)+f.offset;uint32_t value=0;
        if(!entity_copy(&value,ptr,bytes)){failed=true;continue;}
        if(!f.owned||(k==0?(value&32)!=(f.written&32):value!=f.written))f.before=value;
        uint32_t desired=k==0?value|32u:k==1?10u:0u;SIZE_T done=0;
        if(!writable(ptr,bytes)||!WriteProcessMemory(GetCurrentProcess(),ptr,&desired,bytes,&done)||done!=bytes){failed=true;continue;}
        f.owned=true;f.written=desired;any=true;
    }return failed?L4P_ERROR:any?L4P_OK:L4P_ENTITY_MISSING;
}
uint32_t L4P_CALL corpse_destroy(uint32_t token){if(!paintCallback)return L4P_BAD_ARGUMENT;auto result=corpse_gate(token);if(result)return result;
    using Fn=void(__thiscall*)(void*,const char*);auto fn=method<Fn>(service().engine,107);if(!fn)return L4P_ENTITY_MISSING;fn(service().engine,"cl_destroy_ragdolls");return L4P_OK;
}
