// GPL-3.0, Source layouts from Skeeto 2.2.19 EntGet, FindOffset and GetRefEHandle.
// Copy from this process through the OS so inaccessible/stale fields return a
// failure without consuming another component's guard page. LLVM-MinGW's x86
// __try memory probe compiled but failed the actual inaccessible-page fixture.
bool entity_copy(void* to,const void* from,size_t bytes){
    if(!to||uintptr_t(from)<0x10000||uintptr_t(from)+bytes<uintptr_t(from))return false;
    SIZE_T copied=0;return ReadProcessMemory(GetCurrentProcess(),from,to,bytes,&copied)&&copied==bytes;
}
struct EntityRecvTable {unsigned char* props;int count;void* decoder;const char* name;};
struct EntityClientClass {void* create;void* event;const char* name;EntityRecvTable* table;EntityClientClass* next;int id;};
struct EntityRecord {void* entity=nullptr;void* network=nullptr;EntityClientClass* klass=nullptr;uint32_t handle=0;};
struct EntityField {int offset=-1,type=-1;unsigned char* prop=nullptr;};
struct EntityService {
    void* list=nullptr;uint32_t epoch=1,sequence=0;bool connected=false;std::array<EntityRecord,2048> records{};
    std::array<bool,2048> resolved{};
    std::map<std::pair<EntityClientClass*,std::string>,EntityField> fields;
    void** globals=nullptr;bool clockScanned=false;
};
EntityService& entity_service(){static auto* e=new EntityService;return *e;}
void entity_epoch(){auto& e=entity_service();++e.epoch;e.resolved.fill(false);e.sequence=0;}
void entity_frame(){auto& e=entity_service();auto& f=service().frame;
    if(e.connected!=bool(f.connected)){e.connected=f.connected;entity_epoch();}
    if(e.sequence!=f.sequence){e.sequence=f.sequence;e.resolved.fill(false);}
}
EntityRecord* entity_record(int index){
    if(!callbackThread||index<1||index>=2048||!service().frame.in_game)return nullptr;
    auto& e=entity_service();entity_frame();if(e.resolved[index])return e.records[index].entity?&e.records[index]:nullptr;
    e.resolved[index]=true;auto& r=e.records[index];r={};
    if(!e.list)e.list=iface(L"client.dll","VClientEntityList003");
    using Get=void*(__thiscall*)(void*,int);auto get=method<Get>(e.list,3),network=method<Get>(e.list,0);if(!get||!network)return nullptr;
    void* object=get(e.list,index);void* net=network(e.list,index);if(!object||!net)return nullptr;
    using Class=EntityClientClass*(__thiscall*)(void*);using Handle=const uint32_t*(__thiscall*)(void*);
    auto klass=method<Class>(net,1);auto handle=method<Handle>(object,2);if(!klass||!handle)return nullptr;
    uint32_t value=0;if(!entity_copy(&value,handle(object),4)||(value&0xfff)!=uint32_t(index))return nullptr;
    auto c=klass(net);EntityClientClass desc{};if(!entity_copy(&desc,c,sizeof(desc))||!desc.table)return nullptr;
    r={object,net,c,value};return &r;
}
uint32_t entity_resolve(const L4P_EntityRefV1* ref,EntityRecord*& out){
    if(!callbackThread||!ref||ref->index<1||ref->index>=2048)return L4P_BAD_ARGUMENT;
    out=entity_record(int(ref->index));if(!out)return L4P_ENTITY_MISSING;
    return ref->epoch==entity_service().epoch&&ref->handle==out->handle?L4P_OK:L4P_ENTITY_STALE;
}
uint32_t L4P_CALL entity_reference(int32_t index,L4P_EntityRefV1* out){
    if(!callbackThread||!out||index<1||index>=2048)return L4P_BAD_ARGUMENT;
    auto r=entity_record(index);if(!r)return L4P_ENTITY_MISSING;
    *out={uint32_t(index),r->handle,entity_service().epoch};return L4P_OK;
}
uint32_t L4P_CALL entity_handle(uint32_t handle,L4P_EntityRefV1* out){
    if(!out)return L4P_BAD_ARGUMENT;L4P_EntityRefV1 value{};auto result=entity_reference(handle&0xfff,&value);
    if(result!=L4P_OK)return result;if(value.handle!=handle)return L4P_ENTITY_STALE;*out=value;return L4P_OK;
}
EntityField entity_field_find(EntityRecvTable* table,const std::string& name,int depth=0){
    EntityRecvTable t{};if(depth>=24||!entity_copy(&t,table,sizeof(t))||t.count<0||t.count>4096)return {};
    auto dot=name.find('.');auto head=name.substr(0,dot);
    for(int i=0;i<t.count;++i){unsigned char prop[0x3c]{};if(!entity_copy(prop,t.props+i*0x3c,sizeof(prop)))return {};
        char label[128]{};copy(label,*reinterpret_cast<const char**>(prop));
        auto child=*reinterpret_cast<EntityRecvTable**>(prop+0x28);int off=*reinterpret_cast<int*>(prop+0x2c);if(off<0||off>0x10000)continue;
        const int type=*reinterpret_cast<int*>(prop+4);
        if(head==label){if(dot==std::string::npos)return {off,type,t.props+i*0x3c};
            if(child){auto sub=entity_field_find(child,name.substr(dot+1),depth+1);if(sub.offset>=0&&sub.offset+off<=0x10000)return {sub.offset+off,sub.type,sub.prop};}}
        if(dot==std::string::npos&&child){auto sub=entity_field_find(child,name,depth+1);if(sub.offset>=0&&sub.offset+off<=0x10000)return {sub.offset+off,sub.type,sub.prop};}
    }return {};
}
EntityField entity_field(EntityRecord& r,const char* name){
    auto key=std::make_pair(r.klass,std::string(name));auto& fields=entity_service().fields;auto found=fields.find(key);if(found!=fields.end())return found->second;
    EntityClientClass c{};EntityField result{};if(entity_copy(&c,r.klass,sizeof(c)))result=entity_field_find(c.table,name);
    if(fields.size()<16384)fields.emplace(std::move(key),result);return result;
}
uint32_t L4P_CALL entity_read(const L4P_EntityRefV1* ref,const char* name,uint32_t type,void* out){
    if(!out||!name||!*name||strlen(name)>159||strspn(name,"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.[]")!=strlen(name)||type>4)return L4P_BAD_ARGUMENT;
    EntityRecord* r=nullptr;auto result=entity_resolve(ref,r);if(result!=L4P_OK)return result;
    auto field=entity_field(*r,name);if(field.offset<0)return L4P_ENTITY_MISSING;
    if((type==L4P_FIELD_FLOAT&&field.type!=1)||(type==L4P_FIELD_VECTOR&&field.type!=2&&field.type!=1)||((type==L4P_FIELD_BYTE||type==L4P_FIELD_SHORT||type==L4P_FIELD_INT)&&field.type!=0))return L4P_BAD_ARGUMENT;
    const size_t bytes=type==L4P_FIELD_VECTOR?12:type==L4P_FIELD_BYTE?1:type==L4P_FIELD_SHORT?2:4;unsigned char value[12]{};
    if(!entity_copy(value,static_cast<unsigned char*>(r->entity)+field.offset,bytes))return L4P_ENTITY_MISSING;
    if(type==L4P_FIELD_FLOAT||type==L4P_FIELD_VECTOR)for(size_t i=0;i<bytes/4;++i){float f;memcpy(&f,value+i*4,4);if(!std::isfinite(f))return L4P_ENTITY_MISSING;}
    memcpy(out,value,bytes);return L4P_OK;
}
uint32_t L4P_CALL entity_describe(const L4P_EntityRefV1* ref,L4P_EntityInfoV1* out){
    if(!out||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;EntityRecord* r=nullptr;auto result=entity_resolve(ref,r);if(result!=L4P_OK)return result;
    L4P_EntityInfoV1 info{sizeof(info)};info.ref=*ref;EntityClientClass c{};if(!entity_copy(&c,r->klass,sizeof(c)))return L4P_ENTITY_MISSING;copy(info.class_name,c.name);
    if(ref->index<=64){struct Player{char pad[8],name[32];int id;char rest[0x150];} p{};using Get=bool(__thiscall*)(void*,int,void*);auto get=method<Get>(service().engine,8);
        if(get&&get(service().engine,int(ref->index),&p)){p.name[31]=0;copy(info.player_name,p.name);info.user_id=p.id;info.is_bot=p.rest[72]!=0;}}
    *out=info;return L4P_OK;
}
uint32_t L4P_CALL entity_move_type(const L4P_EntityRefV1* ref,uint8_t* out){
    if(!out)return L4P_BAD_ARGUMENT;EntityRecord* r=nullptr;auto result=entity_resolve(ref,r);if(result)return result;int offset=-1;
    for(const char* name:{"m_MoveType","m_nMoveType","movetype"}){auto f=entity_field(*r,name);if(f.offset>0&&f.offset<=0x4000&&f.type==0){offset=f.offset;break;}}
    if(offset<0){auto f=entity_field(*r,"m_nRenderMode");if(f.offset>0&&f.offset<0x4000&&f.type==0)offset=f.offset+1;}
    uint8_t value=0;if(offset<0||!entity_copy(&value,static_cast<unsigned char*>(r->entity)+offset,1))return L4P_ENTITY_MISSING;*out=value;return L4P_OK;
}
uint32_t L4P_CALL entity_highest(int32_t* out){
    if(!callbackThread||!out)return L4P_BAD_ARGUMENT;auto& e=entity_service();if(!e.list)e.list=iface(L"client.dll","VClientEntityList003");
    using Get=int(__thiscall*)(void*);auto get=method<Get>(e.list,6);if(!get)return L4P_ENTITY_MISSING;int value=get(e.list);if(value<0||value>=2048)return L4P_ERROR;*out=value;return L4P_OK;
}
uint32_t L4P_CALL entity_time(float* out){
    if(!callbackThread||!out)return L4P_BAD_ARGUMENT;auto& e=entity_service();
    if(!e.clockScanned&&GetModuleHandleW(L"client.dll")){e.clockScanned=true;const int pattern[]={0xa1,-1,-1,-1,-1,0xd9,0x40,0x0c,0x51,0xd9,0x1c,0x24,0x57};uint32_t count=0;
        auto hit=find_unique(L"client.dll",pattern,std::size(pattern),count);if(hit)entity_copy(&e.globals,hit+1,sizeof(e.globals));}
    void* globals=nullptr;float now=0;
    if(e.globals&&entity_copy(&globals,e.globals,sizeof(globals))&&globals&&entity_copy(&now,static_cast<unsigned char*>(globals)+0x0c,4)&&std::isfinite(now)&&now>=0&&now<1e8f){*out=now;return L4P_OK;}
    using Get=float(__thiscall*)(void*);auto get=method<Get>(service().engine,15);if(!get)return L4P_ENTITY_MISSING;now=get(service().engine);
    if(!std::isfinite(now)||now<0||now>=1e8f)return L4P_ENTITY_MISSING;*out=now;return L4P_OK;
}
uint32_t L4P_CALL entity_eye(const L4P_EntityRefV1* ref,float* out){
    if(!out)return L4P_BAD_ARGUMENT;float origin[3]{},view[3]{0,0,62};auto result=entity_read(ref,"m_vecOrigin",L4P_FIELD_VECTOR,origin);if(result!=L4P_OK)return result;
    result=entity_read(ref,"m_vecViewOffset[0]",L4P_FIELD_VECTOR,view);if(result!=L4P_OK&&result!=L4P_ENTITY_MISSING)return result;
    for(int i=0;i<3;++i)out[i]=origin[i]+view[i];return L4P_OK;
}
uint32_t L4P_CALL entity_user(int32_t id,L4P_EntityRefV1* out){
    if(!callbackThread||!out||id<=0)return L4P_BAD_ARGUMENT;
    using Get=int(__thiscall*)(void*,int);auto get=method<Get>(service().engine,9);if(!get)return L4P_ENTITY_MISSING;
    int index=get(service().engine,id);if(index<1||index>64)return L4P_ENTITY_MISSING;return entity_reference(index,out);
}
bool entity_model_copy(void* info,int index,char (&out)[260]){
    using Get=void*(__thiscall*)(void*,int);using Name=const char*(__thiscall*)(void*,const void*);
    auto get=method<Get>(info,1);auto name=method<Name>(info,3);if(!get||!name)return false;
    auto model=get(info,index);if(!model)return false;copy(out,name(info,model));return out[0]!=0;
}
uint32_t L4P_CALL entity_model(const L4P_EntityRefV1* ref,char* out,uint32_t capacity,uint32_t* size){
    if(!out||!size)return L4P_BAD_ARGUMENT;uint16_t index=0;auto result=entity_read(ref,"m_nModelIndex",L4P_FIELD_SHORT,&index);if(result!=L4P_OK)return result;
    if(index<=0||index>8192)return L4P_ENTITY_MISSING;auto info=iface(L"engine.dll","VModelInfoClient004");
    char value[260]{};if(!entity_model_copy(info,index,value))return L4P_ENTITY_MISSING;
    *size=uint32_t(strlen(value)+1);if(capacity<*size)return L4P_BUFFER_TOO_SMALL;memcpy(out,value,*size);return L4P_OK;
}
uint32_t L4P_CALL entity_read_index(const L4P_EntityRefV1* ref,const char* name,int32_t index,int32_t* out){
    if(!out||!name||!*name||strlen(name)>159||strspn(name,"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.[]")!=strlen(name)||index<0||index>64)return L4P_BAD_ARGUMENT;
    EntityRecord* r=nullptr;auto result=entity_resolve(ref,r);if(result!=L4P_OK)return result;auto field=entity_field(*r,name);EntityRecvTable* child=nullptr;EntityRecvTable table{};
    if(field.offset<0||!field.prop||!entity_copy(&child,field.prop+0x28,4)||!entity_copy(&table,child,sizeof(table))||table.count<2||table.count>4096||index>=table.count)return L4P_ENTITY_MISSING;
    int first=0,second=0,offset=0,type=-1;if(!entity_copy(&first,table.props+0x2c,4)||!entity_copy(&second,table.props+0x3c+0x2c,4)||!entity_copy(&offset,table.props+index*0x3c+0x2c,4)||!entity_copy(&type,table.props+index*0x3c+4,4))return L4P_ENTITY_MISSING;
    const int stride=second-first;if(type!=0||(stride!=1&&stride!=2&&stride!=4)||first<0||offset!=first+index*stride||field.offset+offset>0x10000)return L4P_ENTITY_MISSING;
    int value=0;if(!entity_copy(&value,static_cast<unsigned char*>(r->entity)+field.offset+offset,stride))return L4P_ENTITY_MISSING;
    if(stride==2)value=int(int16_t(value));*out=value;return L4P_OK;
}
uint32_t L4P_CALL entity_player(int32_t index,L4P_EntityInfoV1* out){
    if(!callbackThread||index<1||index>64||!out||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    struct Player{char pad[8],name[32];int id;char rest[0x150];} p{};using Get=bool(__thiscall*)(void*,int,void*);auto get=method<Get>(service().engine,8);
    if(!get||!get(service().engine,index,&p)||!p.name[0])return L4P_ENTITY_MISSING;p.name[31]=0;L4P_EntityInfoV1 info{sizeof(info)};copy(info.player_name,p.name);info.user_id=p.id;info.is_bot=p.rest[72]!=0;
    if(auto r=entity_record(index)){info.ref={uint32_t(index),r->handle,entity_service().epoch};EntityClientClass c{};if(entity_copy(&c,r->klass,sizeof(c)))copy(info.class_name,c.name);}
    *out=info;return L4P_OK;
}
