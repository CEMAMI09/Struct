# Include after the CubeMX project's FreeRTOS, lwIP and mbedTLS targets exist.
# Keep Cube-generated network/HAL sources in the application.
add_library(struct_stm32 STATIC ../../src/struct_sdk.c ../../src/struct_queue.c ../../src/struct_commands.c ../../ports/struct_socket.c)
target_include_directories(struct_stm32 PUBLIC ../../src ../../ports ../freertos)
target_compile_definitions(struct_stm32 PRIVATE STRUCT_PORT_LWIP=1)
target_compile_features(struct_stm32 PUBLIC c_std_99)
