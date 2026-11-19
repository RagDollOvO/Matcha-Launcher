/* The outer game-style catcher is independent of Source's finally boundary. */
typedef void(__cdecl* NativeCall)(void*);
__declspec(noinline) int __cdecl FixtureCatchNative(NativeCall call,void* context){
    __try {call(context);return 0;} __except(1) {return 1;}
}
