# MinHook 1.3.4

Source: https://github.com/TsudaKageyu/minhook/tree/v1.3.4

Tag commit: `c3fcafdc10146beb5919319d0683e44e3c30d537`.
`include/` and `src/` are unchanged upstream files. `build.cmake` selects the
existing Windows x86 C toolchain and links a private static copy into Beacon.
The complete upstream BSD-style licenses are retained in `LICENSE.txt`.

Beacon uses the library to relocate complete x86 instructions and suspend /
adjust other threads during entry installation and restoration. Its trampoline
is retained until process exit, protecting delayed callers across toggles.
