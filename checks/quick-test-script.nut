// Run from the repository root with the official Squirrel interpreter.
// Engine calls are stubs; exercise our actual .nut, including repeated thinks.
local commands = [], messages = [], timers = [], callbacks = [];
local present = false;
local player = {
    IsSurvivor = function() { return true; },
    GetHealth = function() { return 100; },
    GetPlayerUserId = function() { return 7; }
};
::printl <- function(message) { messages.append(message); };
::SendToConsole <- function(command) { commands.append(command); };
::IsPlayerABot <- function(p) { return false; };
::Entities <- { FindByClassname = function(previous, name) { return present && previous == null ? player : null; } };
::SpawnEntityFromTable <- function(name, params) {
    local timer = { scope = {}, removed = false, ValidateScriptScope = function() {}, GetScriptScope = function() { return scope; } };
    timers.append(timer); return timer;
};
::AddThinkToEnt <- function(timer, name) { timer.think <- timer.scope[name]; };
::EntFireByHandle <- function(timer, input, value, delay, activator, caller) { assert(input == "Kill"); timer.removed = true; };
::__CollectGameEventCallbacks <- function(scope) { callbacks.append(scope); };
local helper = "backend/quick-test/assets/flare_quicktest.nut";

dofile(helper);
assert(timers.len() == 1 && callbacks.len() == 1);
callbacks[0].OnGameEvent_server_shutdown({});
assert(commands.len() == 0);
for (local i = 0; i < 5; i++) timers[0].think();
assert(messages.len() == 0);
present = true;
for (local i = 0; i < 100; i++) timers[0].think();
assert(messages.len() == 1 && timers[0].removed);
assert(commands.len() == 0); // No equipment or other gameplay commands.
dofile(helper);
assert(timers.len() == 1 && callbacks.len() == 1);
callbacks[0].OnGameEvent_player_disconnect({userid = 8});
assert(commands.len() == 0);
callbacks[0].OnGameEvent_player_disconnect({userid = 7});
callbacks[0].OnGameEvent_server_shutdown({});
assert(commands.len() == 1 && commands[0] == "quit");

// Server shutdown can be the first notification when returning to the menu.
delete ::FlareQuickTest;
dofile(helper);
timers[1].think();
callbacks[1].OnGameEvent_server_shutdown({});
assert(commands.len() == 2 && commands[1] == "quit");
print("PASS: no equipment commands; readiness once; local exit quits once.\n");
