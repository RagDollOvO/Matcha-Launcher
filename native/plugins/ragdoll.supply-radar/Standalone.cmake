cmake_minimum_required(VERSION 3.22)
project(ragdoll_supply_radar LANGUAGES CXX)
include(build.cmake)
flare_build_radar(ragdoll_supply_radar "${CMAKE_CURRENT_SOURCE_DIR}/radar" "${CMAKE_CURRENT_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/plugin.dll")
