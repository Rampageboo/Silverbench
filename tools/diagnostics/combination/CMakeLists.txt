cmake_minimum_required(VERSION 3.24)

project(AniMocapMultiviewDiagnosticHarness LANGUAGES CXX)

if(NOT DEFINED ANIMOCAP_ROOT)
    get_filename_component(
        ANIMOCAP_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../.." ABSOLUTE)
endif()
get_filename_component(ANIMOCAP_ROOT "${ANIMOCAP_ROOT}" ABSOLUTE)

add_library(animocap_core_prebuilt STATIC IMPORTED)
if(NOT DEFINED ANIMOCAP_CORE_LIBRARY)
    set(ANIMOCAP_CORE_LIBRARY
        "${ANIMOCAP_ROOT}/build/windows-ninja/animocap_core.lib")
endif()
set_target_properties(animocap_core_prebuilt PROPERTIES
    IMPORTED_LOCATION "${ANIMOCAP_CORE_LIBRARY}"
)

add_executable(multiview_ablation_harness multiview_ablation_harness.cpp)
target_compile_features(multiview_ablation_harness PRIVATE cxx_std_20)
target_include_directories(multiview_ablation_harness PRIVATE
    "${ANIMOCAP_ROOT}/include"
    "${ANIMOCAP_ROOT}/third_party"
)
target_link_libraries(multiview_ablation_harness PRIVATE
    animocap_core_prebuilt
    mf
    mfplat
    mfreadwrite
    mfuuid
    ole32
)

if(MSVC)
    target_compile_options(multiview_ablation_harness PRIVATE
        /W4 /permissive- /EHsc /utf-8
    )
endif()
