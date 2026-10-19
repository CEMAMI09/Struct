#ifndef STRUCT_MANAGED_IDENTITY_ESP32_H
#define STRUCT_MANAGED_IDENTITY_ESP32_H
#include <stdint.h>
#include <string.h>
#include <nvs.h>
// Same Secure V2 identity, stored once for common OTA firmware. No new wire ID,
// root derivation or replay namespace. Never clone this NVS record across devices.
class StructManagedIdentityEsp32 {
 struct Record {uint32_t magic,wire;uint8_t root[32];};
 static bool decode(const char *hex,uint8_t out[32]){if(!hex||strlen(hex)!=64)return false;for(size_t i=0;i<32;i++){unsigned x=0;for(int j=0;j<2;j++){char c=hex[2*i+j];if(c>='0'&&c<='9')x=x*16+c-'0';else if(c>='a'&&c<='f')x=x*16+c-'a'+10;else if(c>='A'&&c<='F')x=x*16+c-'A'+10;else return false;}out[i]=(uint8_t)x;}return true;}
public:
 // 0 present; 1 genuinely missing; -1 corrupt/unavailable. Missing is not a
 // license to reset counters or manufacture a fresh management epoch.
 static int load(uint32_t &wire,char root[65]){
  nvs_handle_t handle;esp_err_t opened=nvs_open("sv2_identity",NVS_READONLY,&handle);if(opened==ESP_ERR_NVS_NOT_FOUND)return 1;if(opened!=ESP_OK)return -1;
  Record value{};size_t size=sizeof(value);esp_err_t result=nvs_get_blob(handle,"identity",&value,&size);nvs_close(handle);
  if(result==ESP_ERR_NVS_NOT_FOUND)return 1;if(result!=ESP_OK||size!=sizeof(value)||value.magic!=0x53494431||!value.wire){memset(&value,0,sizeof(value));return -1;}
  bool nonzero=false;for(size_t i=0;i<32;i++)nonzero|=value.root[i]!=0;if(!nonzero){memset(&value,0,sizeof(value));return -1;}
  const char *h="0123456789abcdef";for(size_t i=0;i<32;i++){root[2*i]=h[value.root[i]>>4];root[2*i+1]=h[value.root[i]&15];}root[64]=0;wire=value.wire;memset(&value,0,sizeof(value));return 0;
 }
 static bool provision(uint32_t wire,const char *root,bool freshlyAuthenticatedBootstrap,bool explicitPhysicalReplacement=false){
  if(!wire||!freshlyAuthenticatedBootstrap)return false;uint32_t previous=0;char previousRoot[65]{};int loaded=load(previous,previousRoot);memset(previousRoot,0,sizeof(previousRoot));
  if(loaded<0||(loaded==0&&(!explicitPhysicalReplacement||previous==wire)))return false;
  Record value{};value.magic=0x53494431;value.wire=wire;if(!decode(root,value.root))return false;bool nonzero=false;for(size_t i=0;i<32;i++)nonzero|=value.root[i]!=0;if(!nonzero){memset(&value,0,sizeof(value));return false;}
  nvs_handle_t handle;if(nvs_open("sv2_identity",NVS_READWRITE,&handle)!=ESP_OK){memset(&value,0,sizeof(value));return false;}
  bool okay=nvs_set_blob(handle,"identity",&value,sizeof(value))==ESP_OK&&nvs_commit(handle)==ESP_OK;nvs_close(handle);memset(&value,0,sizeof(value));
  char verify[65]{};uint32_t readWire=0;okay=okay&&load(readWire,verify)==0&&readWire==wire&&!strcmp(root,verify);memset(verify,0,sizeof(verify));return okay;
 }
};
#endif
