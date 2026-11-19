// GPL-3.0. Verbatim classifier and assertions from regoists/Skeeto 2.2.19.
// Commit 7a18b4988d089fdf6cc7e857560cf82a9609a32c, skeeto_proxy.cpp.
enum class SoundVolumeGroup : unsigned char {
	None,
	Gunfire,
	WeaponHandling,
	Melee,
	Chainsaw,
	Footsteps,
	SurvivorVoice,
	SpecialInfected,
	CommonInfected,
	Tank,
	Witch,
	Explosions,
	Throwables,
	Ambient,
	Ui,
	Vehicles,
	Items,
	ScriptCue,
};

static constexpr char SoundPathLower(char c) {
	return c >= 'A' && c <= 'Z' ? (char)(c + ('a' - 'A')) : (c == '\\' ? '/' : c);
}

static constexpr bool SoundPathStartsWith(const char* sample, const char* prefix) {
	if (!sample || !prefix) return false;
	while (*prefix) {
		if (!*sample || SoundPathLower(*sample) != SoundPathLower(*prefix)) return false;
		++sample;
		++prefix;
	}
	return true;
}

static constexpr bool SoundPathContains(const char* sample, const char* needle) {
	if (!sample || !needle || !*needle) return false;
	for (const char* p = sample; *p; ++p) {
		const char* a = p;
		const char* b = needle;
		while (*a && *b && SoundPathLower(*a) == SoundPathLower(*b)) {
			++a;
			++b;
		}
		if (!*b) return true;
	}
	return false;
}

static constexpr bool SoundSourceControlPrefix(char c) {
	return c == '*' || c == '#' || c == '!' || c == '@' || c == '>' || c == '<'
		|| c == '^' || c == ')' || c == '}' || c == '$' || c == '?' || c == ' ' || c == '\t';
}

static constexpr const char* NormalizeSoundSample(const char* sample) {
	if (!sample) return "";
	while (*sample && SoundSourceControlPrefix(*sample)) ++sample;
	return SoundPathStartsWith(sample, "sound/") ? sample + 6 : sample;
}

static constexpr bool IsKnownMeleeWeaponPath(const char* sample) {
	return SoundPathStartsWith(sample, "weapons/melee/")
		|| SoundPathStartsWith(sample, "weapons/axe/")
		|| SoundPathStartsWith(sample, "weapons/bat/")
		|| SoundPathStartsWith(sample, "weapons/baseball_bat/")
		|| SoundPathStartsWith(sample, "weapons/cricket_bat/")
		|| SoundPathStartsWith(sample, "weapons/cricketbat/")
		|| SoundPathStartsWith(sample, "weapons/crowbar/")
		|| SoundPathStartsWith(sample, "weapons/electric_guitar/")
		|| SoundPathStartsWith(sample, "weapons/fireaxe/")
		|| SoundPathStartsWith(sample, "weapons/frying_pan/")
		|| SoundPathStartsWith(sample, "weapons/golf_club/")
		|| SoundPathStartsWith(sample, "weapons/guitar/")
		|| SoundPathStartsWith(sample, "weapons/katana/")
		|| SoundPathStartsWith(sample, "weapons/knife/")
		|| SoundPathStartsWith(sample, "weapons/machete/")
		|| SoundPathStartsWith(sample, "weapons/pan/")
		|| SoundPathStartsWith(sample, "weapons/pitchfork/")
		|| SoundPathStartsWith(sample, "weapons/shovel/")
		|| SoundPathStartsWith(sample, "weapons/tonfa/");
}

static constexpr bool IsThrowableWeaponPath(const char* sample) {
	return SoundPathStartsWith(sample, "weapons/molotov/")
		|| SoundPathStartsWith(sample, "weapons/pipe_bomb/")
		|| SoundPathStartsWith(sample, "weapons/pipebomb/")
		|| SoundPathStartsWith(sample, "weapons/vomitjar/")
		|| SoundPathStartsWith(sample, "weapons/bile_jar/")
		|| SoundPathStartsWith(sample, "weapons/bilejar/");
}

static constexpr bool IsExplosionPath(const char* sample) {
	if (SoundPathStartsWith(sample, "weapons/explode/")
		|| SoundPathStartsWith(sample, "ambient/explosions/"))
		return true;
	if (SoundPathContains(sample, "explod") || SoundPathContains(sample, "/blast"))
		return true;
	return false;
}

static constexpr bool IsVehiclePath(const char* sample) {
	if (SoundPathStartsWith(sample, "vehicles/")
		|| SoundPathStartsWith(sample, "npc/vehicles/"))
		return true;
	// Parish finale uses a C130; its loops often say propeller/c130, not helicopter.
	return SoundPathContains(sample, "helicopter")
		|| SoundPathContains(sample, "chopper")
		|| SoundPathContains(sample, "c130")
		|| SoundPathContains(sample, "propeller")
		|| SoundPathContains(sample, "airplane")
		|| SoundPathContains(sample, "aircraft")
		|| SoundPathContains(sample, "rotor")
		|| SoundPathContains(sample, "/boat")
		|| SoundPathContains(sample, "ferry");
}

static constexpr bool IsSpecialInfectedPath(const char* sample) {
	return SoundPathStartsWith(sample, "player/hunter/")
		|| SoundPathStartsWith(sample, "player/smoker/")
		|| SoundPathStartsWith(sample, "player/boomer/")
		|| SoundPathStartsWith(sample, "player/charger/")
		|| SoundPathStartsWith(sample, "player/jockey/")
		|| SoundPathStartsWith(sample, "player/spitter/")
		|| SoundPathStartsWith(sample, "player/pz/");
}

static constexpr SoundVolumeGroup ClassifySoundVolumeSample(const char* rawSample) {
	const char* sample = NormalizeSoundSample(rawSample);
	if (SoundPathStartsWith(sample, "emsc/")
		|| SoundPathStartsWith(sample, "lasc/")
		|| SoundPathStartsWith(sample, "weapons/spent_mags/"))
		return SoundVolumeGroup::ScriptCue;
	if (SoundPathStartsWith(sample, "player/footsteps/"))
		return SoundVolumeGroup::Footsteps;
	if (SoundPathStartsWith(sample, "player/survivor/voice/"))
		return SoundVolumeGroup::SurvivorVoice;
	// swing = whoosh / miss; hit = shove + melee flesh/world impact (vanilla shove lives here).
	if (SoundPathStartsWith(sample, "player/survivor/swing/")
		|| SoundPathStartsWith(sample, "player/survivor/hit/"))
		return SoundVolumeGroup::Melee;
	if (SoundPathStartsWith(sample, "weapons/chainsaw/"))
		return SoundVolumeGroup::Chainsaw;
	if (IsKnownMeleeWeaponPath(sample))
		return SoundVolumeGroup::Melee;
	if (IsThrowableWeaponPath(sample))
		return SoundVolumeGroup::Throwables;
	if (SoundPathStartsWith(sample, "weapons/")
		&& (SoundPathContains(sample, "/gunfire/")
			|| (SoundPathContains(sample, "/grenadefire/")
				&& SoundPathContains(sample, "/grenade_launcher_fire"))
			|| SoundPathContains(sample, "/50cal_shoot")
			|| SoundPathContains(sample, "/minigun_shoot")))
		return SoundVolumeGroup::Gunfire;
	if (SoundPathStartsWith(sample, "weapons/")
		&& (SoundPathContains(sample, "/gunother/")
			|| SoundPathContains(sample, "/grenadeother/")
			|| SoundPathContains(sample, "/clipempty_")))
		return SoundVolumeGroup::WeaponHandling;
	if (IsExplosionPath(sample))
		return SoundVolumeGroup::Explosions;
	if (SoundPathStartsWith(sample, "player/tank/")
		|| SoundPathStartsWith(sample, "npc/tank/"))
		return SoundVolumeGroup::Tank;
	if (SoundPathStartsWith(sample, "npc/witch/"))
		return SoundVolumeGroup::Witch;
	if (IsSpecialInfectedPath(sample))
		return SoundVolumeGroup::SpecialInfected;
	if (SoundPathStartsWith(sample, "npc/infected/"))
		return SoundVolumeGroup::CommonInfected;
	if (IsVehiclePath(sample))
		return SoundVolumeGroup::Vehicles;
	if (SoundPathStartsWith(sample, "player/items/")
		|| SoundPathStartsWith(sample, "items/"))
		return SoundVolumeGroup::Items;
	if (SoundPathStartsWith(sample, "ui/")
		|| SoundPathStartsWith(sample, "buttons/"))
		return SoundVolumeGroup::Ui;
	if (SoundPathStartsWith(sample, "ambient/")
		|| SoundPathStartsWith(sample, "doors/")
		|| SoundPathStartsWith(sample, "physics/"))
		return SoundVolumeGroup::Ambient;
	return SoundVolumeGroup::None;
}

static_assert(ClassifySoundVolumeSample("weapons/rifle/gunfire/rifle_fire_1.wav") == SoundVolumeGroup::Gunfire,
	"rifle fire must use the gunfire slider");
static_assert(ClassifySoundVolumeSample("weapons/grenade_launcher/grenadefire/grenade_launcher_fire_1.wav") == SoundVolumeGroup::Gunfire,
	"grenade launcher firing must use the gunfire slider");
static_assert(ClassifySoundVolumeSample("weapons/grenade_launcher/grenadefire/grenade_launcher_explode_2.wav") == SoundVolumeGroup::Explosions,
	"grenade explosions must use the explosion slider");
static_assert(ClassifySoundVolumeSample("weapons/smg/gunother/smg_clipout_1.wav") == SoundVolumeGroup::WeaponHandling,
	"reload and handling samples must use the handling slider");
static_assert(ClassifySoundVolumeSample("weapons/melee/katana/katana_swing_miss1.wav") == SoundVolumeGroup::Melee,
	"melee samples must use the melee slider");
static_assert(ClassifySoundVolumeSample("weapons/chainsaw/chainsaw_start_1.wav") == SoundVolumeGroup::Chainsaw,
	"chainsaw must use its own slider");
static_assert(ClassifySoundVolumeSample("weapons/cricketbat/melee_cricket_bat_01.wav") == SoundVolumeGroup::Melee,
	"the shipped cricket-bat directory must use the melee slider");
static_assert(ClassifySoundVolumeSample("player/survivor/swing/Swish_WeaponSwing_Swipe6.wav") == SoundVolumeGroup::Melee,
	"shared survivor melee swings must use the melee slider");
static_assert(ClassifySoundVolumeSample("player/survivor/hit/rifle_swing_hit_infected1.wav") == SoundVolumeGroup::Melee,
	"vanilla shove / survivor hit samples must use the melee slider");
static_assert(ClassifySoundVolumeSample(")player/hunter/voice/attack/hunter_attackmix_01.wav") == SoundVolumeGroup::SpecialInfected,
	"special-infected paths must use the special slider");
static_assert(ClassifySoundVolumeSample("npc/witch/voice/attack/female_distantscream1.wav") == SoundVolumeGroup::Witch,
	"witch paths must use the witch slider");
static_assert(ClassifySoundVolumeSample("player/tank/voice/pain/tank_pain_01.wav") == SoundVolumeGroup::Tank,
	"tank paths must use the tank slider");
static_assert(ClassifySoundVolumeSample("npc/infected/action/rage/female/rage_68.wav") == SoundVolumeGroup::CommonInfected,
	"common-infected paths must use the common slider");
static_assert(ClassifySoundVolumeSample("player/survivor/voice/producer/thanks01.wav") == SoundVolumeGroup::SurvivorVoice,
	"survivor speech must use the voice slider");
static_assert(ClassifySoundVolumeSample("player/footsteps/concrete1.wav") == SoundVolumeGroup::Footsteps,
	"footsteps must use the movement slider");
static_assert(ClassifySoundVolumeSample("weapons/molotov/fire_loop_1.wav") == SoundVolumeGroup::Throwables,
	"molotov samples must use the throwable slider");
static_assert(ClassifySoundVolumeSample("weapons/pipe_bomb/beep.wav") == SoundVolumeGroup::Throwables,
	"pipe bomb samples must use the throwable slider");
static_assert(ClassifySoundVolumeSample("ambient/atmosphere/town_ambience.wav") == SoundVolumeGroup::Ambient,
	"ambient samples must use the ambient slider");
static_assert(ClassifySoundVolumeSample("ui/menu_click01.wav") == SoundVolumeGroup::Ui,
	"ui samples must use the ui slider");
static_assert(ClassifySoundVolumeSample("buttons/button14.wav") == SoundVolumeGroup::Ui,
	"button samples must use the ui slider");
static_assert(ClassifySoundVolumeSample("vehicles/helicopter_start.wav") == SoundVolumeGroup::Vehicles,
	"vehicle samples must use the vehicle slider");
static_assert(ClassifySoundVolumeSample("ambient/machines/c130_propeller_loop.wav") == SoundVolumeGroup::Vehicles,
	"parish C130-style propeller loops must use the vehicle slider");
static_assert(ClassifySoundVolumeSample("player/items/pain_pills/pills_deploy_1.wav") == SoundVolumeGroup::Items,
	"item samples must use the item slider");
static_assert(ClassifySoundVolumeSample("emsc/dryfire_rifle.mp3") == SoundVolumeGroup::ScriptCue,
	"dry-fire cues must use the ammo cue slider");
static_assert(ClassifySoundVolumeSample("lasc/click.mp3") == SoundVolumeGroup::ScriptCue,
	"low-ammo clicks must use the ammo cue slider");
static_assert(ClassifySoundVolumeSample("weapons/spent_mags/handguns/generic_mag1.wav") == SoundVolumeGroup::ScriptCue,
	"magazine drops must use the ammo cue slider");
static_assert(ClassifySoundVolumeSample("custom/server/alert.wav") == SoundVolumeGroup::None,
	"unknown custom sounds must remain unchanged");

