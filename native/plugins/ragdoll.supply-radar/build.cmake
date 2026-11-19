# The radar's Source ABI uses MSVC x86, including its virtual TraceFilter.
# Build the existing freestanding C++ with Clang in that mode and no CRT.
function(flare_build_radar target source sdk output)
  get_filename_component(tool_bin "${CMAKE_CXX_COMPILER}" DIRECTORY)
  find_program(RADAR_CLANG NAMES clang.exe HINTS "${tool_bin}" REQUIRED NO_CACHE)
  find_program(RADAR_LLD NAMES ld.lld.exe HINTS "${tool_bin}" REQUIRED NO_CACHE)
  get_filename_component(tool_bin "${RADAR_CLANG}" DIRECTORY)
  set(lib "${tool_bin}/../i686-w64-mingw32/lib")
  if(NOT EXISTS "${lib}/libkernel32.a" OR NOT EXISTS "${lib}/libuser32.a")
    message(FATAL_ERROR "Supply Radar requires the x86 LLVM-MinGW toolchain (with i686 import libraries).")
  endif()
  get_filename_component(out_dir "${output}" DIRECTORY)
  set(object "${CMAKE_CURRENT_BINARY_DIR}/${target}.obj")
  file(GLOB_RECURSE radar_inputs CONFIGURE_DEPENDS "${source}/*.h" "${source}/compat/*")
  add_custom_command(OUTPUT "${output}" BYPRODUCTS "${object}"
    COMMAND "${CMAKE_COMMAND}" -E make_directory "${out_dir}"
    COMMAND "${RADAR_CLANG}" --target=i686-pc-windows-msvc -std=c++17 -O2 -msse2 -fno-rtti
      -fno-exceptions -fno-builtin -fno-stack-protector -fno-threadsafe-statics -fno-sized-deallocation
      -nostdinc++ -Werror=global-constructors -I "${source}/compat" -I "${sdk}"
      -c "${source}/plugin.cpp" -o "${object}"
    COMMAND "${RADAR_LLD}" -flavor link /dll /timestamp:0 /machine:x86 /entry:DllMain@12
      /nodefaultlib /dynamicbase /nxcompat /opt:ref /opt:icf "/out:${output}" "${object}"
      "${lib}/libkernel32.a" "${lib}/libuser32.a"
    DEPENDS "${source}/plugin.cpp" ${radar_inputs} "${sdk}/l4p_game_ui.h" "${sdk}/l4p_plugin.h"
    VERBATIM)
  add_custom_target(${target} ALL DEPENDS "${output}")
endfunction()
