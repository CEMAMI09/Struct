#ifndef STRUCT_FREERTOS_H
#define STRUCT_FREERTOS_H
#include "FreeRTOS.h"
#include "task.h"
#include "struct_sdk.h"
/* Call in the sole client owner task. Other tasks enqueue measurements to it.
 * Notification can wake earlier for network readiness; polling otherwise caps
 * idle sleep at 10 ms. FreeRTOS itself does not provide a network/crypto stack. */
static inline struct_result struct_freertos_poll(struct_client *client,uint32_t now_ms){
 struct_result result=struct_poll(client,now_ms);
 if(result==STRUCT_PENDING){uint32_t ms=struct_poll_delay(client,now_ms,10);if(ms){TickType_t ticks=pdMS_TO_TICKS(ms);ulTaskNotifyTake(pdTRUE,ticks?ticks:1);}}
 return result;
}
#endif
