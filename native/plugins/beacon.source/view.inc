// GPL-3.0. EngGetViewAngles / EngGameUiVisible from Skeeto 2.2.19.
uint32_t L4P_CALL view_snapshot(L4P_ViewV1* out){
    if(!paintCallback||!out||out->struct_size!=sizeof(*out))return L4P_BAD_ARGUMENT;
    L4P_ViewV1 value{sizeof(value)};value.paint_mode=uint32_t(paintMode);
    using Visible=bool(__thiscall*)(void*);auto vgui=iface(L"engine.dll","VEngineVGui001");auto visible=method<Visible>(vgui,2);
    if(!visible)return L4P_ENTITY_MISSING;value.game_ui=visible(vgui);
    if(allowed(&service().frame,L4P_SOURCE_ANY)){
        using Angles=void(__thiscall*)(void*,float*);auto angles=method<Angles>(service().engine,19);
        if(angles){angles(service().engine,value.angles);value.angles_valid=effects_finite(value.angles);}
    }
    *out=value;return L4P_OK;
}
