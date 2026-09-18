#ifndef STRUCT_NVS_QUEUE_H
#define STRUCT_NVS_QUEUE_H
#include <Preferences.h>
#include <string.h>
#include "struct_queue.h"
/* ESP32 NVS adapter: one namespace per queue, exclusively owned by this object.
 * Two NVS blobs preserve the previous valid snapshot. Requires a wear-leveled
 * NVS partition sized for both snapshots and NVS garbage collection. */
class StructNvsQueue {
  Preferences prefs;
  struct_queue queue{};
  bool ready=false;
  static int read(void *u,unsigned slot,uint8_t *out,size_t cap) {
    auto *self=static_cast<StructNvsQueue*>(u);const char *key=slot?"slot1":"slot0";
    size_t n=self->prefs.getBytesLength(key);
    if(!n)return 0;if(n>cap)return -1;
    return self->prefs.getBytes(key,out,n)==n?(int)n:-1;
  }
  static int write(void *u,unsigned slot,const uint8_t *data,size_t n) {
    auto *self=static_cast<StructNvsQueue*>(u);
    return self->prefs.putBytes(slot?"slot1":"slot0",data,n)==n?0:-1;
  }
public:
  StructNvsQueue()=default;
  StructNvsQueue(const StructNvsQueue&)=delete;
  StructNvsQueue& operator=(const StructNvsQueue&)=delete;
  ~StructNvsQueue(){prefs.end();}
  bool begin(const char *name,const char *keyId) {
    ready=false;prefs.end();if(!name||!keyId||strlen(keyId)!=16||!prefs.begin(name,false))return false;
    struct_queue_port p{};p.user=this;p.read=read;p.write=write;
    ready=struct_queue_open(&queue,&p,keyId)==0;return ready;
  }
  int enqueue(struct_client &client,uint8_t version,const uint8_t *payload,size_t n,uint32_t expires) {
    return ready?struct_queue_enqueue(&queue,&client,version,payload,n,expires):STRUCT_INVALID;
  }
  int step(struct_client &client,uint32_t unixSec,uint32_t millisNow,struct_delivery d=struct_delivery_default(1)) {
    return ready?struct_queue_step(&queue,&client,unixSec,millisNow,d):STRUCT_INVALID;
  }
  int discardHead(){return ready?struct_queue_discard_head(&queue):STRUCT_INVALID;}
};
#endif
