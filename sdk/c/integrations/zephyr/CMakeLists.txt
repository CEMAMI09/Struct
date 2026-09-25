zephyr_library_named(struct_device)
zephyr_library_sources(../../src/struct_sdk.c ../../src/struct_queue.c ../../src/struct_commands.c ../../ports/struct_socket.c)
zephyr_include_directories(../../src ../../ports)
zephyr_library_compile_definitions(STRUCT_PORT_ZEPHYR=1)
