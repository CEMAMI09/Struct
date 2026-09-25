#include <time.h>
#include "nvs_flash.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "protocol_examples_common.h"
#include "struct_socket.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
static struct_socket transport;
static struct_client client;
void app_main(void){
 struct_port port;struct_result result;const uint8_t payload[]={42};
 ESP_ERROR_CHECK(nvs_flash_init());ESP_ERROR_CHECK(esp_netif_init());ESP_ERROR_CHECK(esp_event_loop_create_default());ESP_ERROR_CHECK(example_connect());
 esp_sntp_config_t clock_config=ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
 ESP_ERROR_CHECK(esp_netif_sntp_init(&clock_config));
 if(esp_netif_sntp_sync_wait(pdMS_TO_TICKS(10000))!=ESP_OK){ESP_LOGE("struct","Clock unavailable");return;}
 if(struct_socket_open(&transport,&port,CONFIG_STRUCT_GATEWAY,8081))return;
 if(struct_init(&client,&port,CONFIG_STRUCT_KEY_ID,CONFIG_STRUCT_API_SECRET)!=STRUCT_IDLE)goto done;
 if(CONFIG_STRUCT_ENCRYPTION_KEY[0]&&struct_set_encryption_hex(&client,CONFIG_STRUCT_ENCRYPTION_KEY)!=STRUCT_IDLE)goto done;
 /* Replace one uint8 value with the generated saved-schema encoder. */
 result=struct_send(&client,1,payload,sizeof(payload),(uint32_t)time(NULL),(uint32_t)(esp_timer_get_time()/1000),struct_delivery_default(1));
 while(result==STRUCT_PENDING){vTaskDelay(pdMS_TO_TICKS(10)?pdMS_TO_TICKS(10):1);result=struct_poll(&client,(uint32_t)(esp_timer_get_time()/1000));}
 ESP_LOGI("struct","Delivery outcome=%d",result);
done:struct_clear(&client);struct_socket_close(&transport);
}
