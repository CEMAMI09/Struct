#ifndef STRUCT_MANAGEMENT_ESP32_H
#define STRUCT_MANAGEMENT_ESP32_H
/* Optional HTTPS control plane. Stock telemetry firmware has no OTA capability.
 * Requires an independently built/qualified rollback bootloader + two app slots.
 * Never enables secure boot, flash encryption or anti-rollback eFuses. */
#include <Arduino.h>
#include <ctype.h>
#include <time.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <nvs.h>
#include <esp_ota_ops.h>
#include <esp_app_desc.h>
#include <esp_partition.h>
#include <cJSON.h>
#include <mbedtls/base64.h>
#include "struct_management_crypto.h"
#include "struct_v2_tls_root.h"
struct StructManagedConfiguration {uint32_t reportIntervalSeconds,sampleIntervalSeconds;uint8_t diagnosticLevel;};
class StructManagementEsp32 {
 struct Journal {uint32_t magic,wire,security;uint64_t generation,pendingGeneration;uint8_t fingerprint[32];StructManagedConfiguration config;uint8_t pending;char operation[37],expectedHash[65];uint32_t size,candidateSecurity;uint8_t previousImage[32];};
 Journal state{};uint8_t key[32]{};nvs_handle_t handle=0;bool opened=false,ready=false,ota=false;uint32_t wire=0,bootloader=0,nextCheck=0,managementDeadline=0,lastMessageDuration=0;String origin,organization,model,revision,pem,pin;const char *ca=STRUCT_V2_TLS_ROOT;
 bool (*applySettings)(const StructManagedConfiguration&)=nullptr;bool (*healthCheck)()=nullptr;
 class Response : public Stream {public:String bytes;bool overflow=false;size_t write(uint8_t b) override {return write(&b,1);}size_t write(const uint8_t *b,size_t n) override{if(bytes.length()+n>8192){overflow=true;return 0;}return bytes.concat((const char*)b,n)?n:0;}int available()override{return 0;}int read()override{return -1;}int peek()override{return -1;}void flush()override{}};
 static void hex(const uint8_t *in,size_t n,char *out){const char *h="0123456789abcdef";for(size_t i=0;i<n;i++){out[2*i]=h[in[i]>>4];out[2*i+1]=h[in[i]&15];}out[2*n]=0;}
 static bool unhex(const char *in,uint8_t *out,size_t n){if(!in||strlen(in)!=n*2)return false;for(size_t i=0;i<n;i++){unsigned x=0;for(int j=0;j<2;j++){char c=in[i*2+j];if(c>='0'&&c<='9')x=x*16+c-'0';else if(c>='a'&&c<='f')x=x*16+c-'a'+10;else return false;}out[i]=(uint8_t)x;}return true;}
 static const char *text(cJSON *o,const char *k){cJSON *v=cJSON_GetObjectItemCaseSensitive(o,k);return cJSON_IsString(v)?v->valuestring:nullptr;}
 static bool number(cJSON *o,const char *k,uint64_t maximum,uint64_t &out){cJSON *v=cJSON_GetObjectItemCaseSensitive(o,k);if(!cJSON_IsNumber(v)||v->valuedouble<0||v->valuedouble>(double)maximum)return false;out=(uint64_t)v->valuedouble;return (double)out==v->valuedouble;}
 bool save(){return opened&&nvs_set_blob(handle,"state",&state,sizeof(state))==ESP_OK&&nvs_commit(handle)==ESP_OK;}
 cJSON *post(const char *route,cJSON *body){
  if(WiFi.status()!=WL_CONNECTED||time(nullptr)<1700000000)return nullptr;
  char *json=cJSON_PrintUnformatted(body);if(!json)return nullptr;size_t length=strlen(json);if(length>8192){cJSON_free(json);return nullptr;}
  WiFiClientSecure tls;tls.setCACert(ca);tls.setHandshakeTimeout(15);HTTPClient http;http.setConnectTimeout(10000);http.setTimeout(15000);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if(!http.begin(tls,origin+route)){cJSON_free(json);return nullptr;}http.addHeader("Content-Type","application/json");int code=http.POST((uint8_t*)json,length);cJSON_free(json);Response response;int received=code==200?http.writeToStream(&response):-1;http.end();
  if(received<0||response.overflow||!response.bytes.length())return nullptr;
  // Bound cJSON recursion independently of the platform library's larger default.
  int depth=0;bool quoted=false,escape=false;for(size_t i=0;i<response.bytes.length();i++){char ch=response.bytes[i];if(quoted){if(escape)escape=false;else if(ch=='\\')escape=true;else if(ch=='"')quoted=false;}else if(ch=='"')quoted=true;else if(ch=='{'||ch=='['){if(++depth>16)return nullptr;}else if(ch=='}'||ch==']'){if(--depth<0)return nullptr;}}
  if(depth||quoted)return nullptr;return cJSON_Parse(response.bytes.c_str());
 }
 cJSON *message(const char *action,cJSON *data){
  uint32_t requestedAt=millis();
  cJSON *body=cJSON_CreateObject();cJSON_AddStringToObject(body,"action",action);cJSON_AddItemToObject(body,"data",data?data:cJSON_CreateObject());char *json=cJSON_PrintUnformatted(body);cJSON_Delete(body);if(!json)return nullptr;
  size_t n=strlen(json);if(n>4096){cJSON_free(json);return nullptr;}uint8_t hash[32],mac[32];char hashHex[65];if(struct_management_sha256(json,n,hash)){cJSON_free(json);return nullptr;}hex(hash,32,hashHex);
  cJSON *query=cJSON_CreateObject();cJSON_AddNumberToObject(query,"wireDeviceId",wire);cJSON_AddStringToObject(query,"bodyHash",hashHex);cJSON *challenge=post("/api/device-management/challenge",query);cJSON_Delete(query);
  const char *id=challenge?text(challenge,"id"):nullptr,*nonce=challenge?text(challenge,"nonce"):nullptr;
  if(!id||!nonce||struct_management_uuid(id)||strlen(nonce)!=64||struct_management_mac(key,wire,id,nonce,hashHex,mac)){if(challenge)cJSON_Delete(challenge);cJSON_free(json);return nullptr;}
  char encoded[5500],macHex[65];size_t encodedSize=0;if(mbedtls_base64_encode((uint8_t*)encoded,sizeof(encoded)-1,&encodedSize,(uint8_t*)json,n)){cJSON_Delete(challenge);cJSON_free(json);return nullptr;}encoded[encodedSize]=0;cJSON_free(json);hex(mac,32,macHex);
  query=cJSON_CreateObject();cJSON_AddNumberToObject(query,"wireDeviceId",wire);cJSON_AddStringToObject(query,"challengeId",id);cJSON_AddStringToObject(query,"nonce",nonce);cJSON_AddStringToObject(query,"payload",encoded);cJSON_AddStringToObject(query,"mac",macHex);cJSON_Delete(challenge);cJSON *result=post("/api/device-management/message",query);cJSON_Delete(query);lastMessageDuration=millis()-requestedAt;return result;
 }
 cJSON *configJSON(){cJSON *cfg=cJSON_CreateObject();cJSON_AddNumberToObject(cfg,"reportIntervalSeconds",state.config.reportIntervalSeconds);cJSON_AddNumberToObject(cfg,"sampleIntervalSeconds",state.config.sampleIntervalSeconds);cJSON_AddStringToObject(cfg,"diagnosticLevel",state.config.diagnosticLevel==0?"none":state.config.diagnosticLevel==1?"error":"info");return cfg;}
 bool report(const char *stage,const char *category=nullptr){
  cJSON *d=cJSON_CreateObject();cJSON_AddStringToObject(d,"id",state.operation);cJSON_AddNumberToObject(d,"generation",(double)state.pendingGeneration);cJSON_AddStringToObject(d,"stage",stage);if(category)cJSON_AddStringToObject(d,"category",category);
  if(!strcmp(stage,"healthy")){cJSON_AddStringToObject(d,"sha256",state.expectedHash);cJSON_AddNumberToObject(d,"securityVersion",state.candidateSecurity);cJSON_AddBoolToObject(d,"healthValidated",true);}if(!strcmp(stage,"applied"))cJSON_AddItemToObject(d,"configuration",configJSON());
  cJSON *reply=message("report",d);if(!reply)return false;bool okay=cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(reply,"recorded"));cJSON_Delete(reply);return okay;
 }
 bool runningHash(uint32_t size,char out[65]){const esp_partition_t *running=esp_ota_get_running_partition();if(!running||size>running->size)return false;mbedtls_md_context_t hash;mbedtls_md_init(&hash);if(mbedtls_md_setup(&hash,mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),0)){mbedtls_md_free(&hash);return false;}mbedtls_md_starts(&hash);uint8_t block[4096],digest[32];bool okay=true;for(uint32_t offset=0;offset<size;){size_t n=(size-offset)>sizeof(block)?sizeof(block):(size-offset);if(esp_partition_read(running,offset,block,n)!=ESP_OK||mbedtls_md_update(&hash,block,n)){okay=false;break;}offset+=n;}if(okay)okay=mbedtls_md_finish(&hash,digest)==0;if(okay)hex(digest,32,out);mbedtls_md_free(&hash);return okay;}
 void recoverBoot(){
  // pending 2 = prepared; 7 = boot partition selected; 8 = failed health,
  // rollback requested. Never report rollback until the previous image is seen.
  if(state.pending==2||state.pending==7||state.pending==8){
   char current[65];uint8_t image[32];const esp_partition_t *running=esp_ota_get_running_partition();esp_ota_img_states_t status;
   bool candidate=runningHash(state.size,current)&&!strcmp(current,state.expectedHash);
   if(candidate&&ota&&esp_ota_get_state_partition(running,&status)==ESP_OK&&(status==ESP_OTA_IMG_PENDING_VERIFY||status==ESP_OTA_IMG_VALID)){
    if(state.pending==8||!healthCheck||!healthCheck()){
     state.pending=8;if(!save()){ready=false;return;}
     // The next boot supplies rollback evidence; this call itself proves none.
     if(esp_ota_mark_app_invalid_rollback_and_reboot()!=ESP_OK){ready=false;return;}
     return;
    }
    report("booting");
    // A VALID image can reconcile a crash after mark-valid but before NVS commit.
    if(status==ESP_OTA_IMG_PENDING_VERIFY&&esp_ota_mark_app_valid_cancel_rollback()!=ESP_OK){ready=false;return;}
    state.security=state.candidateSecurity;state.pending=3;if(!save()){ready=false;return;}
   }else if(running&&esp_partition_get_sha256(running,image)==ESP_OK&&!memcmp(image,state.previousImage,32)){
    state.pending=state.pending==2?6:5;if(!save()){ready=false;return;}
   }else{ready=false;return;} // Unknown running image: require local recovery.
  }else if(state.pending==1){state.pending=6;if(!save()){ready=false;return;}}
  const char *stage=state.pending==3?"healthy":state.pending==4?"applied":state.pending==5?"rolled_back":state.pending==6?"failed":nullptr;
  if(stage&&report(stage,state.pending==6?"interrupted_before_activation":nullptr)){state.pending=0;if(!save())ready=false;}
 }
 void configuration(cJSON *operation){
  cJSON *cfg=cJSON_GetObjectItemCaseSensitive(operation,"configuration");uint64_t interval,sample;const char *level=cfg?text(cfg,"diagnosticLevel"):nullptr;
  if(!cfg||cJSON_GetArraySize(cfg)!=3||!number(cfg,"reportIntervalSeconds",86400,interval)||interval<10||!number(cfg,"sampleIntervalSeconds",interval,sample)||sample<1||!level||(strcmp(level,"none")&&strcmp(level,"error")&&strcmp(level,"info"))){report("rejected","configuration_validation");return;}
  StructManagedConfiguration next{(uint32_t)interval,(uint32_t)sample,(uint8_t)(!strcmp(level,"none")?0:!strcmp(level,"error")?1:2)},previous=state.config;
  if(!applySettings||!applySettings(next)){report("rejected","application_rejected_settings");return;}state.config=next;state.generation=state.pendingGeneration;state.pending=4;
  if(!save()){applySettings(previous);state.config=previous;ready=false;return;}if(report("applied")){state.pending=0;save();}
 }
 void firmware(cJSON *operation){
  const char *canonical=text(operation,"canonical"),*signature=text(operation,"signature"),*fingerprint=text(operation,"keyFingerprint"),*token=text(operation,"downloadToken");uint8_t sig[80];size_t sigSize=0;struct_management_manifest m{};
  const esp_partition_t *candidate=esp_ota_get_next_update_partition(nullptr),*running=esp_ota_get_running_partition();
  if(!ota||!canonical||!signature||!fingerprint||strcmp(fingerprint,pin.c_str())||!token||strlen(token)!=105||struct_management_parse(canonical,strlen(canonical),&m)||mbedtls_base64_decode(sig,sizeof(sig),&sigSize,(const uint8_t*)signature,strlen(signature))||struct_management_verify(pem.c_str(),(const uint8_t*)canonical,strlen(canonical),sig,sigSize)||strcmp(m.organization_id,organization.c_str())||strcmp(m.model,model.c_str())||strcmp(m.revision,revision.c_str())||m.security_version<state.security||m.min_bootloader>bootloader||!candidate||!running||candidate->address==running->address||m.size>candidate->size){report("rejected","signature_compatibility_or_downgrade");return;}
#if CONFIG_IDF_TARGET_ESP32C3
  if(strcmp(m.platform,"esp32c3")){report("rejected","hardware_mismatch");return;}
#else
  if(strcmp(m.platform,"esp32")){report("rejected","hardware_mismatch");return;}
#endif
  for(size_t i=0;i<105;i++)if(!isalnum(token[i])&&token[i]!='_'&&token[i]!='-'&&token[i]!='.'){report("rejected","download_authorization");return;}
  state.generation=state.pendingGeneration;state.pending=1;state.size=m.size;state.candidateSecurity=m.security_version;strcpy(state.expectedHash,m.sha256);if(esp_partition_get_sha256(running,state.previousImage)!=ESP_OK||!save()){ready=false;return;}
  if(!report("downloading"))return;
  WiFiClientSecure tls;tls.setCACert(ca);tls.setHandshakeTimeout(15);HTTPClient http;http.setConnectTimeout(10000);http.setTimeout(15000);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if(!http.begin(tls,origin+"/api/device-management/download/"+state.operation)){state.pending=6;save();return;}http.addHeader("Authorization",String("Bearer ")+token);int response=http.GET();
  if(response!=200||http.getSize()!=(int)m.size){http.end();state.pending=6;save();return;}
  esp_ota_handle_t update;mbedtls_md_context_t hash;mbedtls_md_init(&hash);if(mbedtls_md_setup(&hash,mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),0)||esp_ota_begin(candidate,m.size,&update)!=ESP_OK){http.end();mbedtls_md_free(&hash);state.pending=6;save();return;}
  mbedtls_md_starts(&hash);uint8_t block[4096],digest[32];uint32_t received=0,last=millis();bool okay=true;size_t markerMatched=0;static volatile const uint8_t forbiddenImage[]={246,241,247,240,230,241,250,227,228,230,241,234,247,252,250,230,247,224,225,224,235,241,236,228,233,250,236,232,228,226,224,250,243,148};WiFiClient *stream=http.getStreamPtr();
  // Bytes are written only to the inactive partition. It is not selected until
  // both the signed full-file digest and Espressif image validation succeed.
  while(received<m.size){int available=stream->available();if(available){size_t n=(m.size-received)>sizeof(block)?sizeof(block):(m.size-received);if((size_t)available<n)n=available;int got=stream->readBytes(block,n);if(got<=0||mbedtls_md_update(&hash,block,got)||esp_ota_write(update,block,got)!=ESP_OK){okay=false;break;}for(int i=0;i<got;i++){if(block[i]==(uint8_t)(forbiddenImage[markerMatched]^0xa5))markerMatched++;else markerMatched=block[i]==(uint8_t)(forbiddenImage[0]^0xa5)?1:0;if(markerMatched==sizeof(forbiddenImage)){okay=false;break;}}if(!okay)break;received+=got;last=millis();}else if(!http.connected()||millis()-last>15000){okay=false;break;}delay(1);}
  char actual[65];if(mbedtls_md_finish(&hash,digest))okay=false;hex(digest,32,actual);mbedtls_md_free(&hash);http.end();
  if(!okay||received!=m.size||strcmp(actual,m.sha256)){esp_ota_abort(update);state.pending=6;save();return;}
  if(esp_ota_end(update)!=ESP_OK){state.pending=6;save();return;}
  if(!report("verified")||!report("installing"))return;
  state.pending=2;if(!save()){ready=false;return;}if(!report("awaiting_reboot"))return;
  if((int32_t)(millis()-managementDeadline)>=0){state.pending=6;save();return;}
  if(esp_ota_set_boot_partition(candidate)!=ESP_OK){state.pending=6;save();return;}state.pending=7;if(!save()){ready=false;return;}ESP.restart();
 }
public:
 bool begin(uint32_t id,const char *rootHex,const char *org,const char *base,const char *publicPem,const char *keyFingerprint,const char *hardware,const char *hardwareRevision,uint32_t bootloaderVersion,bool qualifiedRollbackBootloader,bool freshAuthenticatedEpoch,bool(*apply)(const StructManagedConfiguration&),bool(*health)(),const char *trustedCa=STRUCT_V2_TLS_ROOT){
  if(opened)return false;if(!id||!rootHex||!org||struct_management_uuid(org)||!base||strncmp(base,"https://",8)||strchr(base,'@')||strchr(base,'?')||strchr(base,'#')||strchr(base+8,'/')||!publicPem||!keyFingerprint||strlen(keyFingerprint)!=64||!hardware||struct_management_token(hardware,64)||!hardwareRevision||struct_management_token(hardwareRevision,64)||!trustedCa||!apply)return false;
  uint8_t declaredPin[32],actualPin[32];if(!unhex(keyFingerprint,declaredPin,32)||struct_management_fingerprint(publicPem,actualPin)||memcmp(declaredPin,actualPin,32))return false;
  uint8_t root[32],fp[32];if(!unhex(rootHex,root,32)||struct_management_derive(root,id,key)){memset(root,0,sizeof(root));return false;}memset(root,0,sizeof(root));if(struct_management_sha256(key,32,fp)){memset(key,0,sizeof(key));return false;}
  wire=id;organization=org;origin=base;if(origin.endsWith("/"))origin.remove(origin.length()-1);pem=publicPem;pin=keyFingerprint;model=hardware;revision=hardwareRevision;bootloader=bootloaderVersion;applySettings=apply;healthCheck=health;ca=trustedCa;
  char space[16];snprintf(space,sizeof(space),"sm%08lx",(unsigned long)id);if(nvs_open(space,NVS_READWRITE,&handle)!=ESP_OK)return false;opened=true;size_t size=sizeof(state);esp_err_t read=nvs_get_blob(handle,"state",&state,&size);
  if(read==ESP_ERR_NVS_NOT_FOUND&&freshAuthenticatedEpoch){state={};state.magic=0x534d4131;state.wire=wire;memcpy(state.fingerprint,fp,32);state.config={60,60,1};if(!save())return false;}
  else if(read!=ESP_OK||size!=sizeof(state)||state.magic!=0x534d4131||state.wire!=wire||memcmp(fp,state.fingerprint,32))return false;
  if(state.config.reportIntervalSeconds<10||state.config.reportIntervalSeconds>86400||!state.config.sampleIntervalSeconds||state.config.sampleIntervalSeconds>state.config.reportIntervalSeconds||state.config.diagnosticLevel>2||state.security>2147483647u||state.generation>9007199254740991ULL||state.pendingGeneration>9007199254740991ULL||state.pending>8)return false;
  if(state.pending&&(struct_management_uuid(state.operation)||state.pendingGeneration!=state.generation))return false;
  if(!applySettings(state.config))return false;
#if CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE && !CONFIG_BOOTLOADER_APP_ANTI_ROLLBACK
  const esp_partition_t *next=esp_ota_get_next_update_partition(nullptr);ota=qualifiedRollbackBootloader&&next&&next->size>=262144&&healthCheck;
#else
  ota=false; // A sketch compiler define alone cannot qualify a prebuilt bootloader.
#endif
  ready=true;recoverBoot();return ready;
 }
 bool registerCapabilities(){if(!ready)return false;cJSON *d=cJSON_CreateObject();
#if CONFIG_IDF_TARGET_ESP32C3
  cJSON_AddStringToObject(d,"platform","esp32c3");
#else
  cJSON_AddStringToObject(d,"platform","esp32");
#endif
  cJSON_AddStringToObject(d,"hardwareModel",model.c_str());cJSON_AddStringToObject(d,"hardwareRevision",revision.c_str());cJSON_AddStringToObject(d,"firmwareVersion",esp_app_get_description()->version);cJSON_AddNumberToObject(d,"agentVersion",1);cJSON_AddNumberToObject(d,"bootloaderVersion",bootloader);const esp_partition_t *next=esp_ota_get_next_update_partition(nullptr);cJSON_AddNumberToObject(d,"partitionBytes",next?next->size:0);cJSON_AddNumberToObject(d,"securityVersion",state.security);cJSON *pins=cJSON_AddArrayToObject(d,"keyFingerprints");cJSON_AddItemToArray(pins,cJSON_CreateString(pin.c_str()));cJSON_AddBoolToObject(d,"rollback",ota);cJSON_AddBoolToObject(d,"ota",ota);cJSON_AddBoolToObject(d,"configuration",applySettings!=nullptr);cJSON *r=message("capabilities",d);if(!r)return false;bool result=cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(r,"registered"));cJSON_Delete(r);return result;}
 void poll(){if(!ready||WiFi.status()!=WL_CONNECTED||(int32_t)(millis()-nextCheck)<0)return;nextCheck=millis()+60000;recoverBoot();if(state.pending)return;cJSON *r=message("poll",nullptr);if(!r)return;cJSON *op=cJSON_GetObjectItemCaseSensitive(r,"operation");uint64_t generation=0;const char *id=op?text(op,"id"):nullptr,*kind=op?text(op,"kind"):nullptr;if(!id||!kind||struct_management_uuid(id)||!number(op,"generation",9007199254740991ULL,generation)||generation<=state.generation){cJSON_Delete(r);return;}strcpy(state.operation,id);state.pendingGeneration=generation;uint64_t remaining=0;if(!number(op,"remainingSeconds",604800,remaining)||remaining<1||remaining*1000<=lastMessageDuration){report("rejected","execution_window_closed");cJSON_Delete(r);return;}managementDeadline=millis()+(uint32_t)(remaining*1000-lastMessageDuration);if(!strcmp(kind,"configuration"))configuration(op);else if(!strcmp(kind,"firmware"))firmware(op);cJSON_Delete(r);}
 StructManagedConfiguration configuration()const{return state.config;}
 bool otaSupported()const{return ota;}
 void end(){if(opened)nvs_close(handle);opened=false;ready=false;memset(key,0,sizeof(key));}
 ~StructManagementEsp32(){end();}
};
#endif
