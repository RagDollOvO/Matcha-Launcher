# Vendored MinHook v1.3.4; reuse the selected x86 toolchain for its C sources.
if(NOT CMAKE_C_COMPILER_LOADED)
  if(MINGW AND NOT CMAKE_C_COMPILER)
    string(REPLACE "clang++" "clang" c_compiler "${CMAKE_CXX_COMPILER}")
    string(REPLACE "g++" "gcc" c_compiler "${c_compiler}")
    set(CMAKE_C_COMPILER "${c_compiler}" CACHE FILEPATH "C compiler for the selected toolchain")
  endif()
  enable_language(C)
endif()
add_library(beacon_minhook STATIC
  "${CMAKE_CURRENT_LIST_DIR}/src/buffer.c"
  "${CMAKE_CURRENT_LIST_DIR}/src/hook.c"
  "${CMAKE_CURRENT_LIST_DIR}/src/trampoline.c"
  "${CMAKE_CURRENT_LIST_DIR}/src/hde/hde32.c")
target_include_directories(beacon_minhook PUBLIC "${CMAKE_CURRENT_LIST_DIR}/include")
