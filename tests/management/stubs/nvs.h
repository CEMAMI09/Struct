// Test-only in-memory NVS contract, never linked into a device.
#ifndef TEST_NVS_H
#define TEST_NVS_H
#include <stddef.h>
typedef int esp_err_t;typedef int nvs_handle_t;
#define ESP_OK 0
#define ESP_ERR_NVS_NOT_FOUND 1
#define NVS_READONLY 0
#define NVS_READWRITE 1
int nvs_open(const char*,int,nvs_handle_t*);void nvs_close(nvs_handle_t);
int nvs_get_blob(nvs_handle_t,const char*,void*,size_t*);
int nvs_set_blob(nvs_handle_t,const char*,const void*,size_t);int nvs_commit(nvs_handle_t);
#endif
