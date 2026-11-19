// Observe the local test player; the selected map/mods own all equipment.
// Root state survives killing the readiness timer and deduplicates script execs.
if (!("FlareQuickTest" in getroottable())) {
    ::FlareQuickTest <- { ready = false, quitting = false, userId = -1 };
    local state = ::FlareQuickTest;

    state.Quit <- function() {
        if (!state.ready || state.quitting) return;
        state.quitting = true;
        printl("FLARE_TEST_EXIT___TOKEN__");
        SendToConsole("quit");
    };
    state.OnGameEvent_player_disconnect <- function(params) {
        if (("userid" in params) && params.userid == state.userId) state.Quit();
    };
    state.OnGameEvent_server_shutdown <- function(params) { state.Quit(); };
    __CollectGameEventCallbacks(state);

    local timer = SpawnEntityFromTable("info_target", { targetname = "flare_test_wait" });
    timer.ValidateScriptScope();
    timer.GetScriptScope()["FlareTestThink"] <- function() {
        if (state.ready) return 1.0;
        local player = null;
        while ((player = Entities.FindByClassname(player, "player")) != null) {
            if (player.IsSurvivor() && !IsPlayerABot(player) && player.GetHealth() > 0) {
                state.userId = player.GetPlayerUserId();
                state.ready = true;
                printl("FLARE_TEST_READY___TOKEN__");
                // Mark completion before removing our timer: the engine can
                // reschedule a callback that tries to detach its own think.
                EntFireByHandle(timer, "Kill", "", 0.0, null, null);
                return 1.0;
            }
        }
        return 0.25;
    };
    AddThinkToEnt(timer, "FlareTestThink");
}
