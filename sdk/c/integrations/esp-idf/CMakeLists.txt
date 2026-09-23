idf_component_register(SRCS "../../src/struct_sdk.c" "../../src/struct_queue.c" "../../src/struct_commands.c" "../../ports/struct_socket.c"
 INCLUDE_DIRS "../../src" "../../ports" REQUIRES lwip mbedtls esp_hw_support)
target_compile_definitions(${COMPONENT_LIB} PRIVATE STRUCT_PORT_ESP_IDF=1)
