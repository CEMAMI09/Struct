#include "struct_queue.h"
#include "struct_commands.h"
#include "struct_mbedtls.h"
#include <assert.h>
#include <string.h>
#include <stdio.h>
static uint8_t slots[2][STRUCT_QUEUE_BYTES],sent[1400];static size_t sizes[2],sent_n;static int torn,seq,receipt_on,executions,journal,save_fail;
static int rd(void*u,unsigned s,uint8_t*b,size_t n){(void)u;assert(n==STRUCT_QUEUE_BYTES);memcpy(b,slots[s],sizes[s]);return (int)sizes[s];}
static int wr(void*u,unsigned s,const uint8_t*b,size_t n){(void)u;if(torn){memcpy(slots[s],b,n/8);sizes[s]=n;return -1;}memcpy(slots[s],b,n);sizes[s]=n;return 0;}
static int rng(void*u,uint8_t*b,size_t n){(void)u;memset(b,++seq,n);return 0;}
static int tx(void*u,const uint8_t*b,size_t n){(void)u;memcpy(sent,b,n);sent_n=n;return 0;}
static int rx(void*u,uint8_t*b,size_t n){(void)u;assert(n>=69);if(!receipt_on)return 0;memcpy(b,"STRA",4);memcpy(b+4,sent+sent_n-32,32);b[36]=1;return struct_mbedtls_hmac(NULL,(const uint8_t*)"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",64,b,37,b+37)?-1:69;}
static int load(void*u,const uint8_t id[16],const uint8_t mac[32]){(void)u;(void)id;(void)mac;return journal;}
static int save(void*u,const uint8_t id[16],const uint8_t mac[32],uint32_t exp,int state){(void)u;(void)id;(void)mac;(void)exp;if(save_fail&&state==17)return -1;journal=state;return 0;}
static int execute(void*u,const uint8_t id[16],const uint8_t*p,size_t n){(void)u;(void)id;assert(n==1&&p[0]==2);executions++;return 17;}
int main(void){
 static struct_queue q,reopened;struct_client c;uint8_t payload=42,command[77]={0},ack[67];
 struct_port port={0};struct_queue_port storage={0};struct_command_port cp={0};struct_delivery d=struct_delivery_default(1);
 port.random=rng;port.hmac=struct_mbedtls_hmac;port.send=tx;port.receive=rx;storage.read=rd;storage.write=wr;
 assert(struct_init(&c,&port,"0123456789abcdef","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")==STRUCT_IDLE);
 assert(struct_queue_open(&q,&storage,c.key_id)==0);
 assert(struct_queue_enqueue(&q,&c,1,&payload,1,2000)==0);
 torn=1;assert(struct_queue_enqueue(&q,&c,1,&payload,1,2000)==STRUCT_IO_ERROR);torn=0;
 assert(struct_queue_open(&reopened,&storage,c.key_id)==0);assert(reopened.bytes[8]==1);
 assert(struct_queue_step(&reopened,&c,1000,0,d)==STRUCT_PENDING);assert(sent[0]==4);
 assert(struct_queue_step(&reopened,&c,1000,8000,d)==STRUCT_UNKNOWN);assert(reopened.bytes[8]==1);
 assert(struct_queue_step(&reopened,&c,1001,9000,d)==STRUCT_PENDING);receipt_on=1;
 assert(struct_queue_step(&reopened,&c,1001,9001,d)==STRUCT_COMMITTED);assert(reopened.bytes[8]==0);
 assert(struct_queue_open(&q,&storage,c.key_id)==0);assert(q.bytes[8]==0);
 assert(struct_queue_enqueue(&q,&c,1,&payload,1,1000)==0);assert(struct_queue_step(&q,&c,1001,10000,d)==STRUCT_QUEUE_EXPIRED);
 assert(struct_queue_discard_head(&q)==0);
 for(int i=0;i<4;i++)assert(struct_queue_enqueue(&q,&c,1,&payload,1,2000)==0);
 assert(struct_queue_enqueue(&q,&c,1,&payload,1,2000)==STRUCT_QUEUE_FULL);
 cp.load=load;cp.save=save;cp.execute=execute;
 memcpy(command,"STRC",4);memcpy(command+4,c.key_id,16);memset(command+20,7,16);struct_put_u32(command+36,1000);struct_put_u32(command+40,2000);command[44]=2;
 assert(!struct_mbedtls_hmac(NULL,c.secret,64,command,45,command+45));
 assert(struct_command_handle(&c,command,77,1001,&cp)==17);assert(executions==1);
 assert(struct_command_handle(&c,command,77,1001,&cp)==17);assert(executions==1);
 journal=0;save_fail=1;assert(struct_command_handle(&c,command,77,1001,&cp)==20);assert(executions==2);
 assert(struct_command_handle(&c,command,77,1001,&cp)==20);assert(executions==2);
 command[44]^=1;assert(struct_command_handle(&c,command,77,1001,&cp)==STRUCT_CRYPTO_ERROR);command[44]^=1;
 assert(struct_command_handle(&c,command,77,2000,&cp)==19);
 assert(struct_command_ack(&c,command+20,17,ack)==0);assert(ack[34]==17);
 puts("C durable queue: torn write/reboot/lost receipt/full/expiry; commands: authentication/dedup/crash uncertainty passed");return 0;
}
