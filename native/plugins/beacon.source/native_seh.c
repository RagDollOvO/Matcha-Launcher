/* Native Windows SEH cleanup boundary. No CRT headers, allocation or C++ ABI.
 * Compile the tiny C bridge for the MSVC x86 target, even in a MinGW build:
 * the GNU x86 target does not emit usable __try tables for indirect calls.
 * The original exception continues unwinding after cleanup. */
typedef void (__cdecl *L4P_NativeCall)(void*);
__declspec(noinline) void __cdecl L4P_NativeFinally(L4P_NativeCall call,void* context,L4P_NativeCall cleanup){
    __try {call(context);} __finally {cleanup(context);}
}
/* Bounded metadata probes use the upstream fault-to-unavailable contract. */
__declspec(noinline) int __cdecl L4P_NativeTry(L4P_NativeCall call,void* context){
    __try {call(context);return 1;} __except(1) {return 0;}
}
