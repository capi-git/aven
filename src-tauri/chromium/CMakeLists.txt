cmake_minimum_required(VERSION 3.21)
project(SupermonoChromium LANGUAGES C CXX OBJCXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET "13.0")
set(PROJECT_ARCH "arm64" CACHE STRING "CEF architecture")
set(USE_SANDBOX ON CACHE BOOL "CEF sandbox" FORCE)
if(NOT CEF_ROOT)
  message(FATAL_ERROR "Set CEF_ROOT to the verified CEF binary distribution")
endif()
set(CMAKE_MODULE_PATH ${CMAKE_MODULE_PATH} "${CEF_ROOT}/cmake")
find_package(CEF REQUIRED)
add_subdirectory("${CEF_LIBCEF_DLL_WRAPPER_PATH}" "${CMAKE_BINARY_DIR}/wrapper")
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../src/browser_agent_dom.js" AGENT_DOM_SOURCE)
file(WRITE "${CMAKE_BINARY_DIR}/agent_dom_source.h"
  "#pragma once\nstatic constexpr const char kAgentDomSource[] = R\"SM_AGENT_DOM(${AGENT_DOM_SOURCE})SM_AGENT_DOM\";\n")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS browser_edit_selection.js)
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/browser_edit_selection.js" EDIT_SELECTION_SOURCE)
file(WRITE "${CMAKE_BINARY_DIR}/browser_edit_source.h"
  "#pragma once\nstatic constexpr const char kBrowserEditSelection[] = R\"SM_EDIT(${EDIT_SELECTION_SOURCE})SM_EDIT\";\n")
add_library(supermono_chromium_impl STATIC supermono_chromium.mm browser_actions_menu.mm browser_drop_indicator.mm)
target_include_directories(supermono_chromium_impl PRIVATE "${CEF_ROOT}" "${CMAKE_BINARY_DIR}")
target_compile_options(supermono_chromium_impl PRIVATE -fobjc-arc -fno-rtti -Wall -Wextra -Wno-unused-parameter)
target_compile_definitions(supermono_chromium_impl PRIVATE CEF_USE_SANDBOX)
add_executable(supermono_chromium_helper helper.mm)
target_include_directories(supermono_chromium_helper PRIVATE "${CEF_ROOT}")
target_compile_definitions(supermono_chromium_helper PRIVATE CEF_USE_SANDBOX)
target_link_libraries(supermono_chromium_helper PRIVATE libcef_dll_wrapper ${CEF_STANDARD_LIBS})
set_target_properties(supermono_chromium_helper PROPERTIES OUTPUT_NAME "Supermono Chromium Helper")
# Rust links one archive. libtool preserves every archive member without linking
# the CEF framework; the framework is loaded lazily through cef_load_library.
add_custom_command(OUTPUT "${CMAKE_BINARY_DIR}/libsupermono_chromium.a"
  COMMAND /usr/bin/libtool -static -o "${CMAKE_BINARY_DIR}/libsupermono_chromium.a"
    "$<TARGET_FILE:supermono_chromium_impl>" "$<TARGET_FILE:libcef_dll_wrapper>"
  DEPENDS supermono_chromium_impl libcef_dll_wrapper)
add_custom_target(supermono_chromium ALL DEPENDS "${CMAKE_BINARY_DIR}/libsupermono_chromium.a" supermono_chromium_helper)

# Exercises real CEF dictionary ownership without opening a browser or app.
add_executable(supermono_chromium_request_lifetime_test EXCLUDE_FROM_ALL request_lifetime_test.mm)
target_include_directories(supermono_chromium_request_lifetime_test PRIVATE "${CEF_ROOT}")
target_compile_options(supermono_chromium_request_lifetime_test PRIVATE -fobjc-arc)
target_link_libraries(supermono_chromium_request_lifetime_test PRIVATE libcef_dll_wrapper ${CEF_STANDARD_LIBS})
enable_testing()
add_test(NAME agent_dom_request_lifetime
  COMMAND supermono_chromium_request_lifetime_test
    "${CEF_ROOT}/Release/Chromium Embedded Framework.framework/Chromium Embedded Framework")

# Pure viewport math, including the measured decorated/overlay macOS frames.
add_executable(supermono_chromium_browser_viewport_test EXCLUDE_FROM_ALL browser_viewport_test.cc)
add_test(NAME browser_viewport_geometry COMMAND supermono_chromium_browser_viewport_test)

add_executable(supermono_chromium_browser_edit_capture_test EXCLUDE_FROM_ALL browser_edit_capture_test.cc)
add_test(NAME browser_edit_capture_geometry COMMAND supermono_chromium_browser_edit_capture_test)

# Real AppKit hierarchy/lifetime checks; hidden windows and no CEF initialization.
add_executable(supermono_chromium_browser_host_view_test EXCLUDE_FROM_ALL browser_host_view_test.mm)
target_compile_options(supermono_chromium_browser_host_view_test PRIVATE -fobjc-arc)
target_link_libraries(supermono_chromium_browser_host_view_test PRIVATE "-framework Cocoa")
add_test(NAME browser_host_view_reparent COMMAND supermono_chromium_browser_host_view_test)

# Per-tab command ordering, coalescing, navigation reapply and failure recovery.
add_executable(supermono_chromium_browser_tab_zoom_test EXCLUDE_FROM_ALL browser_tab_zoom_test.cc)
add_test(NAME browser_tab_zoom_isolation COMMAND supermono_chromium_browser_tab_zoom_test)

# Real menu controls, scoped callbacks, enablement, and selection without UI.
add_executable(supermono_chromium_browser_actions_menu_test EXCLUDE_FROM_ALL
  browser_actions_menu_test.mm browser_actions_menu.mm)
target_compile_options(supermono_chromium_browser_actions_menu_test PRIVATE -fobjc-arc)
target_link_libraries(supermono_chromium_browser_actions_menu_test PRIVATE "-framework Cocoa")
add_test(NAME browser_actions_menu_controls COMMAND supermono_chromium_browser_actions_menu_test)

# Visual drop target above live CEF: hit testing, clipping, geometry and lifecycle.
add_executable(supermono_chromium_browser_drop_indicator_test EXCLUDE_FROM_ALL
  browser_drop_indicator_test.mm browser_drop_indicator.mm)
target_compile_options(supermono_chromium_browser_drop_indicator_test PRIVATE -fobjc-arc)
target_link_libraries(supermono_chromium_browser_drop_indicator_test PRIVATE "-framework Cocoa")
add_test(NAME browser_drop_indicator COMMAND supermono_chromium_browser_drop_indicator_test)
