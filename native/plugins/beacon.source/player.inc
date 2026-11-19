// GPL-3.0. Skeeto IdleView/Person/Flashlight/Wep restoration native boundaries.
extern "C" int __cdecl L4P_NativeTry(void(__cdecl*)(void*),void*);
uint32_t player_gate(uint32_t token,bool write){
    if(!paintCallback)return L4P_BAD_ARGUMENT;auto result=effects_scope(token);if(result)return result;
    const auto& f=service().frame;L4P_EntityRefV1 ref{};L4P_EntityInfoV1 info{sizeof(info)};int observer=1,team=0;uint8_t life=1;
    if(f.local_user<=0||entity_reference(f.local_player,&ref)||entity_describe(&ref,&info)||info.user_id!=f.local_user||info.is_bot||
       entity_read(&ref,"m_iObserverMode",L4P_FIELD_INT,&observer)||observer||entity_read(&ref,"m_iTeamNum",L4P_FIELD_INT,&team)||team!=2||
       entity_read(&ref,"m_lifeState",L4P_FIELD_BYTE,&life)||life)return L4P_ENTITY_SCOPE;
    if(write){L4P_ViewV1 view{sizeof(view)};if(view_snapshot(&view)||view.game_ui)return L4P_ENTITY_SCOPE;}
    return L4P_OK;
}
uint32_t L4P_CALL player_angles(uint32_t token,const float angles[3]){
    if(!angles||!effects_finite(angles)||angles[0]<=-90||angles[0]>=90||std::abs(angles[1])>360||std::abs(angles[2])>360)return L4P_BAD_ARGUMENT;
    auto result=player_gate(token,true);if(result)return result;using Fn=void(__thiscall*)(void*,const float*);auto fn=method<Fn>(service().engine,20);
    if(!fn)return L4P_ENTITY_MISSING;fn(service().engine,angles);return L4P_OK;
}
struct CameraService{const unsigned char* base=nullptr;uint32_t state=0;};
CameraService& camera(){static auto* s=new CameraService;return *s;}
bool camera_resolve(){auto& c=camera();if(c.state)return c.state==1;auto base=reinterpret_cast<const unsigned char*>(GetModuleHandleW(L"client.dll"));if(!base)return false;c.state=2;
    IMAGE_DOS_HEADER dos{};IMAGE_NT_HEADERS32 nt{};
    if(!entity_copy(&dos,base,sizeof(dos))||dos.e_magic!=IMAGE_DOS_SIGNATURE||dos.e_lfanew<0||dos.e_lfanew>1024*1024||
       !entity_copy(&nt,base+dos.e_lfanew,sizeof(nt))||nt.Signature!=IMAGE_NT_SIGNATURE||nt.FileHeader.Machine!=IMAGE_FILE_MACHINE_I386||
       nt.OptionalHeader.Magic!=IMAGE_NT_OPTIONAL_HDR32_MAGIC||nt.FileHeader.TimeDateStamp!=0x6a440ecf||nt.OptionalHeader.SizeOfImage!=0x963000)return false;
    const unsigned char getter[]={0x55,0x8b,0xec,0x56,0x8b,0xf1,0xe8,0xe5,0xe5,0x14,0x00};
    const unsigned char third[]={0x55,0x8b,0xec,0x83,0xec,0x0c,0x56,0x6a,0xff},first[]={0x6a,0xff,0xe8,0x39,0x36,0x00,0x00,0x33,0xc9};
    if(!draw_match(base+0x12e050,getter,sizeof(getter))||!draw_match(base+0x12ddc0,third,sizeof(third))||!draw_match(base+0x12de30,first,sizeof(first))||
       !executable(base+0x12e050)||!executable(base+0x12ddc0)||!executable(base+0x12de30))return false;
    c.base=base;c.state=1;return true;
}
struct CameraCall{const unsigned char* base;void* input;int operation;bool third=false;};
void __cdecl camera_call(void* context){auto& c=*static_cast<CameraCall*>(context);using Read=bool(__thiscall*)(void*,int);using Write=void(__thiscall*)(void*);
    if(c.operation<0)c.third=reinterpret_cast<Read>(uintptr_t(c.base)+0x12e050)(c.input,-1);
    else reinterpret_cast<Write>(uintptr_t(c.base)+(c.operation?0x12ddc0:0x12de30))(c.input);
}
uint32_t player_camera_call(uint32_t token,int operation,uint32_t* out){auto result=player_gate(token,operation>=0);if(result)return result;
    if(!camera_resolve())return L4P_ENTITY_MISSING;auto& c=camera();void* input=nullptr;
    if(!entity_copy(&input,c.base+0x6e2f04,4)||!readable(input,4))return L4P_ENTITY_MISSING;
    CameraCall call{c.base,input,operation};if(!L4P_NativeTry(camera_call,&call)){c.state=3;return L4P_ENTITY_MISSING;}
    if(out)*out=call.third?1:0;return L4P_OK;
}
uint32_t L4P_CALL player_camera_read(uint32_t token,uint32_t* out){if(!out)return L4P_BAD_ARGUMENT;return player_camera_call(token,-1,out);}
uint32_t L4P_CALL player_camera_write(uint32_t token,uint32_t third){if(third>1)return L4P_BAD_ARGUMENT;return player_camera_call(token,int(third),nullptr);}
uint32_t L4P_CALL player_camera_status(uint32_t* out){if(!out)return L4P_BAD_ARGUMENT;std::lock_guard<std::recursive_mutex> lock(service().mutex);*out=camera().state;return L4P_OK;}
uint32_t L4P_CALL player_action(uint32_t token,uint32_t action){if((action<1||action>5)&&action!=L4P_PLAYER_FLASHLIGHT)return L4P_BAD_ARGUMENT;
    auto result=player_gate(token,true);if(result)return result;using Fn=void(__thiscall*)(void*,const char*);auto fn=method<Fn>(service().engine,107);if(!fn)return L4P_ENTITY_MISSING;
    const char* commands[]={"slot1","slot2","slot3","slot4","slot5"};fn(service().engine,action==100?"impulse 100":commands[action-1]);return L4P_OK;
}
