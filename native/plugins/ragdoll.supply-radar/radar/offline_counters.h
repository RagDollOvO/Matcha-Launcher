#pragma once
// Verification counters exist only in offline check executables. The game DLL
// has no diagnostic counters or per-frame instrumentation from these statements.
#ifdef L4N_SUPPLY_OFFLINE_CHECKS
#define L4N_OBSERVE(...) do { __VA_ARGS__; } while(false)
#define L4N_COUNTERS(...) __VA_ARGS__
#else
#define L4N_OBSERVE(...) do {} while(false)
#define L4N_COUNTERS(...)
#endif
