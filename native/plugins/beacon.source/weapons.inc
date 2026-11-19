// GPL-3.0. Skeeto 2.2.19 WeaponCapacityResolve / WeaponClipCapacity.
using WeaponInfoFn=void*(__cdecl*)(uint16_t);
struct WeaponService {WeaponInfoFn lookup=nullptr;uint32_t state=0;};
WeaponService& weapons(){static auto* s=new WeaponService;return *s;}
extern "C" int __cdecl L4P_NativeTry(void(__cdecl*)(void*),void*);
bool weapon_resolve(){auto& s=weapons();if(s.state)return s.state==1;if(!GetModuleHandleW(L"client.dll"))return false;s.state=2;
    const int getter[]={0x0f,0xb7,0x81,0xda,0x09,0,0,0x50,0xe8,-1,-1,-1,-1,0x83,0xc4,0x04,0x05,0xa6,0,0,0,0xc2,0x04,0};
    const int parser[]={0x68,-1,-1,-1,-1,0x8b,0xcf,0xe8,-1,-1,-1,-1,0x6a,0xff,0x68,-1,-1,-1,-1,0x8b,0xcf,0x89,0x86,0x60,0x01,0,0,0xe8,-1,-1,-1,-1,0x89,0x86,0x64,0x01,0,0};uint32_t count=0;
    auto g=find_unique(L"client.dll",getter,std::size(getter),count),p=find_unique(L"client.dll",parser,std::size(parser),count);if(!g||!p)return false;
    const char* key=nullptr;char text[16]{};int relative=0;if(!entity_copy(&key,p+1,4)||!entity_copy(&relative,g+9,4))return false;copy(text,key);if(strcmp(text,"clip_size"))return false;
    auto lookup=g+13+relative;const unsigned char expected[]={0x55,0x8b,0xec,0x66,0x8b,0x45,0x08};unsigned char body[sizeof(expected)]{};
    if(!executable(lookup)||!entity_copy(body,lookup,sizeof(body))||memcmp(body,expected,sizeof(body)))return false;
    s.lookup=reinterpret_cast<WeaponInfoFn>(lookup);s.state=1;return true;
}
struct WeaponCall {WeaponInfoFn lookup;uint16_t handle;void* output=nullptr;};
void __cdecl weapon_call(void* data){auto& c=*static_cast<WeaponCall*>(data);c.output=c.lookup(c.handle);}
uint32_t L4P_CALL weapon_capacity(uint32_t token,const L4P_EntityRefV1* ref,int32_t* out){
    if(!paintCallback||!ref||!out)return L4P_BAD_ARGUMENT;auto sub=service().subs.find(token);
    if(sub==service().subs.end()||sub->second->scope!=L4P_SOURCE_LOCAL||effects_scope(token)!=L4P_OK)return L4P_ENTITY_SCOPE;
    EntityRecord* record=nullptr;auto result=entity_resolve(ref,record);if(result)return result;
    if(entity_field(*record,"m_iClip1").offset<0||!weapon_resolve())return L4P_ENTITY_MISSING;
    uint16_t handle=0xffff;if(!entity_copy(&handle,static_cast<unsigned char*>(record->entity)+0x9da,2)||handle==0xffff)return L4P_ENTITY_MISSING;
    auto& s=weapons();WeaponCall call{s.lookup,handle};if(!L4P_NativeTry(weapon_call,&call)){s.state=3;s.lookup=nullptr;return L4P_ENTITY_MISSING;}
    int capacity=0;if(!call.output||!entity_copy(&capacity,static_cast<unsigned char*>(call.output)+0x160,4)||capacity<1||capacity>65535)return L4P_ENTITY_MISSING;
    *out=capacity;return L4P_OK;
}
uint32_t L4P_CALL weapon_status(uint32_t* out){if(!out)return L4P_BAD_ARGUMENT;auto& s=service();std::lock_guard<std::recursive_mutex> lock(s.mutex);*out=weapons().state;return L4P_OK;}
