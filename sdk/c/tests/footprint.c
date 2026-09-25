#include <stdio.h>
#include "struct_sdk.h"
#include "struct_queue.h"
int main(void){printf("client=%zu queue=%zu durable_snapshot=%u\n",sizeof(struct_client),sizeof(struct_queue),(unsigned)STRUCT_QUEUE_BYTES);return 0;}
