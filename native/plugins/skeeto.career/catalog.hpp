// GPL-3.0. Stat identifiers and weapon order from Skeeto 2.2.19 skeeto_career.cpp.
#pragma once
#include <cstddef>
#include <iterator>
namespace career {
struct Stat { const char* key; const char* label; };
inline constexpr Stat general[] = {
    {"Stat.TotalPlayTime.Total", "游玩时间"},
    {"Stat.InfectedKilled.Total", "感染者击杀"},
    {"Stat.GamesPlayed.Total", "参与战役"},
    {"Stat.FinaleFinished.Total", "完成终局"},
    {"Stat.TeamRevived.Total", "扶起队友"},
    {"Stat.TeamProtected.Total", "保护队友"},
    {"Stat.KitsShared.Total", "分享急救包"},
    {"Stat.KitsUsed.Total", "使用急救包"},
    {"Stat.PillsShared.Total", "分享止痛药"},
    {"Stat.PillsUsed.Total", "使用止痛药"},
    {"Stat.AdrenalineShared.Total", "分享肾上腺素"},
    {"Stat.AdrenalineUsed.Total", "使用肾上腺素"},
    {"Stat.DefibrillatorsUsed.Total", "使用电击器"},
    {"Stat.Defibrillated.Total", "被电击器救活"},
    {"Stat.PlayedNick.Total", "Nick"},
    {"Stat.PlayedCoach.Total", "Coach"},
    {"Stat.PlayedEllis.Total", "Ellis"},
    {"Stat.PlayedRochelle.Total", "Rochelle"},
    {"Stat.RealismGamesPlayed.Total", "写实模式"},
    {"Stat.GamesPlayed.Versus", "对抗参与"},
    {"Stat.GamesWon.Versus", "对抗获胜"},
    {"Stat.SurvivalGamesPlayed.Total", "生存模式"},
    {"Stat.ScavengeGamesPlayed.Total", "清道夫模式"}
};
inline constexpr Stat weapons[] = {
    {"Stat.pistol.Kills.Total", "手枪"},
    {"Stat.pistol_magnum.Kills.Total", "马格南"},
    {"Stat.smg.Kills.Total", "UZI"},
    {"Stat.smg_silenced.Kills.Total", "消音冲锋枪"},
    {"Stat.smg_mp5.Kills.Total", "MP5"},
    {"Stat.pumpshotgun.Kills.Total", "木喷"},
    {"Stat.shotgun_chrome.Kills.Total", "铁喷"},
    {"Stat.autoshotgun.Kills.Total", "一代连喷"},
    {"Stat.shotgun_spas.Kills.Total", "SPAS-12"},
    {"Stat.rifle.Kills.Total", "M16"},
    {"Stat.rifle_desert.Kills.Total", "SCAR"},
    {"Stat.rifle_ak47.Kills.Total", "AK-47"},
    {"Stat.rifle_sg552.Kills.Total", "SG552"},
    {"Stat.hunting_rifle.Kills.Total", "木狙"},
    {"Stat.sniper_military.Kills.Total", "军用狙击枪"},
    {"Stat.sniper_awp.Kills.Total", "AWP"},
    {"Stat.sniper_scout.Kills.Total", "Scout"},
    {"Stat.grenade_launcher.Kills.Total", "榴弹发射器"},
    {"Stat.rifle_m60.Kills.Total", "M60"},
    {"Stat.machinegun.Kills.Total", "固定机枪"},
    {"Stat.baseball_bat.Kills.Total", "棒球棍"},
    {"Stat.chainsaw.Kills.Total", "电锯"},
    {"Stat.cricket_bat.Kills.Total", "板球拍"},
    {"Stat.crowbar.Kills.Total", "撬棍"},
    {"Stat.electric_guitar.Kills.Total", "电吉他"},
    {"Stat.fireaxe.Kills.Total", "消防斧"},
    {"Stat.frying_pan.Kills.Total", "平底锅"},
    {"Stat.katana.Kills.Total", "武士刀"},
    {"Stat.machete.Kills.Total", "砍刀"},
    {"Stat.tonfa.Kills.Total", "警棍"},
    {"Stat.golfclub.Kills.Total", "高尔夫球杆"},
    {"Stat.pitchfork.Kills.Total", "草叉"},
    {"Stat.shovel.Kills.Total", "铁铲"},
    {"Stat.knife.Kills.Total", "小刀"},
    {"Stat.molotov.Kills.Total", "燃烧瓶"},
    {"Stat.pipe_bomb.Kills.Total", "土制炸弹"},
    {"Stat.vomitjar.Kills.Total", "胆汁瓶"}
};
static_assert(std::size(general) == 23 && std::size(weapons) == 37);
}
