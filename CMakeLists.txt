cmake_minimum_required(VERSION 3.24)

project(AniMocapFusion VERSION 0.1.0 LANGUAGES CXX)

option(ANIMOCAP_BUILD_TESTS "Build AniMocap Fusion M0 tests" ON)

add_library(animocap_core
    src/contracts.cpp
    src/fixture.cpp
    src/hash.cpp
    src/math.cpp
    src/npy.cpp
    src/package.cpp
    src/skeleton.cpp
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
    target_compile_options(animocap_core PRIVATE /W4 /permissive- /EHsc)
else()
    target_compile_options(animocap_core PRIVATE -Wall -Wextra -Wpedantic)
endif()

add_executable(animocap src/cli.cpp)
target_link_libraries(animocap PRIVATE animocap_core)
target_include_directories(animocap PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/third_party)

if(ANIMOCAP_BUILD_TESTS)
    enable_testing()
    add_executable(animocap_tests tests/test_main.cpp)
    target_link_libraries(animocap_tests PRIVATE animocap_core)
    target_include_directories(animocap_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/third_party)
    target_compile_definitions(animocap_tests PRIVATE
        ANIMOCAP_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}"
    )
    add_test(NAME animocap_m0 COMMAND animocap_tests)
endif()
