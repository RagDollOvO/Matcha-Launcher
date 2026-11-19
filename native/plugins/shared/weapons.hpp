#pragma once
// GPL-3.0. Weapon taxonomy from Skeeto 2.2.19 skeeto_hud.cpp/.h.
#include <cstring>
#include <cctype>
namespace flare_weapon {
enum TeamWep : int {
	TW_None = 0,
	TW_Pistol, TW_Magnum, TW_Melee, TW_Saw,
	TW_Smg, TW_SmgS, TW_Mp5,
	TW_Pump, TW_Chrome, TW_Auto, TW_Spas,
	TW_M16, TW_Ak, TW_Scar, TW_Sg, TW_M60,
	TW_Hunt, TW_Mil, TW_Scout, TW_Awp, TW_GL,
	TW_Molly, TW_Pipe, TW_Bile,
	TW_Kit, TW_Defib, TW_Exp, TW_Inc,
	TW_Pills, TW_Adren,
	TW_Carry,
	TW_Count
};

inline bool TeamHudHas(const char* cn, const char* s) {
	return cn && s && strstr(cn, s) != nullptr;
}

inline bool TeamHudCnIHas(const char* cn, const char* needle) {
	if (!cn || !needle || !needle[0]) return false;
	for (const char* p = cn; *p; ++p) {
		const char* a = p;
		const char* b = needle;
		while (*a && *b) {
			char ca = (char)tolower((unsigned char)*a);
			char cb = (char)tolower((unsigned char)*b);
			if (ca != cb) break;
			++a;
			++b;
		}
		if (!*b) return true;
	}
	return false;
}

inline bool TeamHudIsHuntRifle(const char* cn) {
	if (!cn || !cn[0]) return false;
	// EntNetClassName is often mixed case; "rifle" alone must not beat hunt.
	if (TeamHudCnIHas(cn, "hunting")) return true;
	return TeamHudCnIHas(cn, "sniper_hunting")
		|| TeamHudCnIHas(cn, "hunting_rifle")
		|| TeamHudCnIHas(cn, "huntingrifle")
		|| TeamHudCnIHas(cn, "sniperhunting");
}

inline int TeamHudWepKind(const char* cn) {
	if (!cn || !cn[0]) return TW_None;
	if (TeamHudIsHuntRifle(cn)) return TW_Hunt;
	if (TeamHudHas(cn, "Molotov") || TeamHudHas(cn, "molotov")) return TW_Molly;
	if (TeamHudHas(cn, "PipeBomb") || TeamHudHas(cn, "Pipebomb") || TeamHudHas(cn, "pipe_bomb")
		|| TeamHudHas(cn, "pipebomb") || TeamHudHas(cn, "Pipe_bomb"))
		return TW_Pipe;
	if (TeamHudHas(cn, "Vomit") || TeamHudHas(cn, "vomitjar") || TeamHudHas(cn, "VomitJar")
		|| TeamHudHas(cn, "Bile") || TeamHudHas(cn, "bile_flask"))
		return TW_Bile;
	if (TeamHudHas(cn, "Defib") || TeamHudHas(cn, "defibrillator")) return TW_Defib;
	if (TeamHudHas(cn, "FirstAid") || TeamHudHas(cn, "first_aid") || TeamHudHas(cn, "Medkit")
		|| TeamHudHas(cn, "MedKit"))
		return TW_Kit;
	if (TeamHudHas(cn, "Incendiary") || TeamHudHas(cn, "upgradepack_incendiary")) return TW_Inc;
	if (TeamHudHas(cn, "Explosive") || TeamHudHas(cn, "upgradepack_explosive")) return TW_Exp;
	if (TeamHudHas(cn, "Adrenaline") || TeamHudHas(cn, "adrenaline")) return TW_Adren;
	if (TeamHudHas(cn, "PainPills") || TeamHudHas(cn, "pain_pills") || TeamHudHas(cn, "Pain_pills")
		|| TeamHudHas(cn, "Pills"))
		return TW_Pills;
	if (TeamHudHas(cn, "AK47") || TeamHudHas(cn, "Ak47")) return TW_Ak;
	if (TeamHudHas(cn, "SG552") || TeamHudHas(cn, "Sg552")) return TW_Sg;
	if (TeamHudHas(cn, "Desert") || TeamHudHas(cn, "SCAR") || TeamHudHas(cn, "Scar")) return TW_Scar;
	if (TeamHudHas(cn, "M60") || TeamHudHas(cn, "m60")) return TW_M60;
	if (TeamHudHas(cn, "GrenadeLauncher") || TeamHudHas(cn, "grenade_launcher")) return TW_GL;
	if (TeamHudHas(cn, "Sniper_AWP") || TeamHudHas(cn, "AWP") || TeamHudHas(cn, "awp")) return TW_Awp;
	if (TeamHudHas(cn, "Scout") || TeamHudHas(cn, "scout")) return TW_Scout;
	if (TeamHudHas(cn, "Military") || TeamHudHas(cn, "sniper_military")) return TW_Mil;
	if (TeamHudHas(cn, "MP5") || TeamHudHas(cn, "Mp5") || TeamHudHas(cn, "mp5")) return TW_Mp5;
	if (TeamHudHas(cn, "Silenced") || TeamHudHas(cn, "smg_silenced")) return TW_SmgS;
	if (TeamHudHas(cn, "Spas") || TeamHudHas(cn, "SPAS") || TeamHudHas(cn, "shotgun_spas")) return TW_Spas;
	if (TeamHudHas(cn, "Chrome") || TeamHudHas(cn, "shotgun_chrome")) return TW_Chrome;
	if (TeamHudHas(cn, "AutoShotgun") || TeamHudHas(cn, "autoshotgun") || TeamHudHas(cn, "Autoshotgun")) return TW_Auto;
	if (TeamHudHas(cn, "Pump") || TeamHudHas(cn, "pumpshotgun")) return TW_Pump;
	if (TeamHudHas(cn, "Magnum") || TeamHudHas(cn, "Pistol_Magnum") || TeamHudHas(cn, "pistol_magnum")) return TW_Magnum;
	if (TeamHudHas(cn, "Chainsaw") || TeamHudHas(cn, "chainsaw")) return TW_Saw;
	if (TeamHudHas(cn, "Melee") || TeamHudHas(cn, "melee")) return TW_Melee;
	if (TeamHudHas(cn, "SubMachine") || TeamHudHas(cn, "SMG") || TeamHudHas(cn, "Smg") || TeamHudHas(cn, "smg")) return TW_Smg;
	if ((TeamHudHas(cn, "Rifle") || TeamHudHas(cn, "rifle") || TeamHudHas(cn, "M16") || TeamHudHas(cn, "m16"))
		&& !TeamHudIsHuntRifle(cn))
		return TW_M16;
	if (TeamHudHas(cn, "Pistol") || TeamHudHas(cn, "pistol")) return TW_Pistol;
	if (TeamHudHas(cn, "GasCan") || TeamHudHas(cn, "Gnome") || TeamHudHas(cn, "Cola")
		|| TeamHudHas(cn, "Firework") || TeamHudHas(cn, "Oxygen") || TeamHudHas(cn, "Propane"))
		return TW_Carry;
	return TW_None;
}

inline int TeamHudGunMaxClipKind(int kind){switch(kind){
    case TW_Pistol:return 15;case TW_Magnum:return 8;
    case TW_Smg:case TW_SmgS:case TW_Mp5:case TW_M16:case TW_Sg:return 50;
    case TW_Ak:return 40;case TW_Scar:return 60;case TW_Pump:case TW_Chrome:return 8;
    case TW_Auto:case TW_Spas:return 10;case TW_M60:return 150;case TW_GL:return 1;
    case TW_Hunt:case TW_Scout:return 15;case TW_Mil:return 30;case TW_Awp:return 20;default:return 0;
}}

}
