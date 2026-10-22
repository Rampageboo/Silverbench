cmake_minimum_required(VERSION 3.24)

project(AniMocapFusion VERSION 0.1.0 LANGUAGES CXX)

option(ANIMOCAP_BUILD_TESTS "Build AniMocap Fusion tests" ON)

add_library(animocap_core
    src/animation_curve.cpp
    src/character_profile.cpp
    src/contracts.cpp
    src/export_bvh.cpp
    src/export_vrma.cpp
    src/import_bvh.cpp
    src/import_vrma.cpp
    src/fixture.cpp
    src/hash.cpp
    src/math.cpp
    src/multiview.cpp
    src/npy.cpp
    src/pose_sequence.cpp
    src/package.cpp
    src/skeleton.cpp
    src/video_win.cpp
)

target_compile_features(animocap_core PUBLIC cxx_std_20)
target_include_directories(animocap_core
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/include
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/third_party
)
target_compile_definitions(animocap_core PUBLIC ANIMOCAP_VERSION="${PROJECT_VERSION}")

if(MSVC)
    target_compile_options(animocap_core PRIVATE /W4 /permissive- /EHsc /utf-8)
else()
    target_compile_options(animocap_core PRIVATE -Wall -Wextra -Wpedantic)
endif()

add_executable(animocap src/cli.cpp)
target_link_libraries(animocap PRIVATE animocap_core)
if(WIN32)
    target_link_libraries(animocap PRIVATE mf mfplat mfreadwrite mfuuid ole32)
    add_executable(animocap_studio WIN32 src/gui_main.cpp)
    target_link_libraries(animocap_studio PRIVATE
        animocap_core
        comctl32
        gdi32
        mf
        mfplat
        mfreadwrite
        mfuuid
        ole32
        shell32
        user32
    )
    target_include_directories(animocap_studio PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/third_party)
    target_compile_options(animocap_studio PRIVATE /W4 /permissive- /EHsc /utf-8)
    target_compile_definitions(animocap_studio PRIVATE UNICODE _UNICODE)
endif()
target_include_directories(animocap PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/third_party)

if(ANIMOCAP_BUILD_TESTS)
    enable_testing()
    add_executable(animocap_tests tests/test_main.cpp)
    target_link_libraries(animocap_tests PRIVATE animocap_core)
    target_include_directories(animocap_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/third_party)
    target_compile_definitions(animocap_tests PRIVATE
        ANIMOCAP_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}"
    )
    add_test(NAME animocap_core COMMAND animocap_tests)

    add_executable(animocap_animation_curve_tests tests/test_animation_curve.cpp)
    target_link_libraries(animocap_animation_curve_tests PRIVATE animocap_core)
    add_test(NAME animocap_animation_curve COMMAND animocap_animation_curve_tests)
endif()
