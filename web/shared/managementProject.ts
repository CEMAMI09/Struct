export interface ManagementProjectOptions {
  organizationId: string
  publicKeyPem: string
  keyFingerprint: string
  hardwareModel: string
  hardwareRevision: string
  bootloaderVersion: number
  origin?: string
}
/** Explicit configuration-capable example. OTA stays disabled until a qualified
 * rollback bootloader and application health check are supplied by the integrator. */
export function attachManagementProject(
  project: Record<string, string>,
  options: ManagementProjectOptions,
) {
  const origin = options.origin || 'https://www.usestruct.com',
    u = new URL(origin)
  if (
    !/^[a-f0-9-]{36}$/.test(options.organizationId) ||
    !options.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----') ||
    options.publicKeyPem.includes('PRIVATE') ||
    options.publicKeyPem.length > 2048 ||
    !/^[a-f0-9]{64}$/.test(options.keyFingerprint) ||
    ![options.hardwareModel, options.hardwareRevision].every((v) =>
      /^[A-Za-z0-9._-]{1,64}$/.test(v),
    ) ||
    !Number.isInteger(options.bootloaderVersion) ||
    options.bootloaderVersion < 0 ||
    options.bootloaderVersion > 65535 ||
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.pathname !== '/' ||
    u.search ||
    u.hash
  )
    throw Error('Invalid management project configuration')
  let main = project['src/main.cpp']!
  const sample = main.match(
    /    StructPacket packet = \{\};\n    \/\/ Replace these example assignments with sensor readings.\n([\s\S]*?)    uint8_t encoded/,
  )
  if (!sample) throw Error('Unsupported starter structure')
  const assignments = sample[1]!.replaceAll('packet.', 'latest.')
  main = main.replace(
    '#include <StructSecureV2Esp32.h>',
    '#include <StructSecureV2Esp32.h>\n#include <StructManagementEsp32.h>\n#include <StructManagedIdentityEsp32.h>',
  )
  main = main.replace(
    'StructSecureV2Esp32 client;',
    `StructSecureV2Esp32 client;
StructManagementEsp32 management;
uint32_t runtimeDeviceId=0;
char runtimeDeviceRoot[65]{};
StructManagedConfiguration settings{60,60,1};
StructPacket latest{};
uint32_t nextAcquisition=0;
bool managementReady=false;
bool applyConfiguration(const StructManagedConfiguration &next){settings=next;return true;}
// Replace with real application/peripheral tests before enabling OTA.
bool applicationHealthy(){return false;}`,
  )
  const initialization = `
  if(ready) managementReady=management.begin(runtimeDeviceId,runtimeDeviceRoot,${JSON.stringify(options.organizationId)},${JSON.stringify(origin)},${JSON.stringify(options.publicKeyPem)},${JSON.stringify(options.keyFingerprint)},${JSON.stringify(options.hardwareModel)},${JSON.stringify(options.hardwareRevision)},${options.bootloaderVersion},false,client.freshlyBootstrapped(),applyConfiguration,applicationHealthy);
  memset(runtimeDeviceRoot,0,sizeof(runtimeDeviceRoot));
  if(managementReady) management.registerCapabilities();
  else Serial.println("Management unavailable: preserve NVS; fresh credentials are required after lost management state.");`
  const begin = main.match(
    /  ready = client.begin\(STRUCT_DEVICE_ID, STRUCT_DEVICE_SECRET, STRUCT_BOOTSTRAP_TOKEN([^\n]*?)\);/,
  )
  if (!begin) throw Error('Unsupported credential initialization')
  main = main.replace(
    begin[0],
    `  int identity=StructManagedIdentityEsp32::load(runtimeDeviceId,runtimeDeviceRoot);
  if(identity<0){Serial.println("Corrupt identity; stop and physically reprovision fresh credentials.");return;}
#if STRUCT_FACTORY_PROVISIONING
  if(identity==1 || STRUCT_FACTORY_REPROVISION){
    Serial.println("STRUCT_FACTORY_CREDENTIAL_IMAGE_V1"); // This image must never enter OTA distribution.
    ready=client.begin(STRUCT_DEVICE_ID,STRUCT_DEVICE_SECRET,STRUCT_BOOTSTRAP_TOKEN${begin[1]});
    if(ready)ready=StructManagedIdentityEsp32::provision(STRUCT_DEVICE_ID,STRUCT_DEVICE_SECRET,client.freshlyBootstrapped(),STRUCT_FACTORY_REPROVISION);
    if(ready)ready=StructManagedIdentityEsp32::load(runtimeDeviceId,runtimeDeviceRoot)==0;
  }else
#endif
  {ready=identity==0 && client.begin(runtimeDeviceId,runtimeDeviceRoot,""${begin[1]});}`,
  )
  project['include/struct_config.h'] = project[
    'include/struct_config.h'
  ]!.replace(
    '#define STRUCT_DEVICE_ID',
    '#ifndef STRUCT_FACTORY_PROVISIONING\n#define STRUCT_FACTORY_PROVISIONING 1\n#endif\n#ifndef STRUCT_FACTORY_REPROVISION\n#define STRUCT_FACTORY_REPROVISION 0\n#endif\n#if STRUCT_FACTORY_PROVISIONING\n#define STRUCT_DEVICE_ID',
  ).replace(
    '#define STRUCT_CONFIRMED',
    '#endif // Factory credentials are absent from the common OTA image.\n#define STRUCT_CONFIRMED',
  )
  const boardFlags = (
    project['platformio.ini']!.match(/    -DARDUINO_[^\n]+/g) || []
  ).join('\n')
  project['platformio.ini'] =
    '[platformio]\ndefault_envs = struct\n\n' + project['platformio.ini']
  project['platformio.ini'] +=
    '\n[env:struct-ota]\nextends = env:struct\nbuild_flags =\n    -DSTRUCT_FACTORY_PROVISIONING=0\n' +
    boardFlags +
    '\n'
  main = main.replace(
    '  if (!ready) Serial.println(',
    initialization + '\n  if (!ready) Serial.println(',
  )
  main = main.replace(
    '  if (waiting) {',
    `  if(managementReady && !waiting) management.poll();
  if((int32_t)(millis()-nextAcquisition)>=0){
${assignments}    nextAcquisition=millis()+settings.sampleIntervalSeconds*1000u;
  }
  if (waiting) {`,
  )
  main = main
    .replace(
      sample[0],
      '    StructPacket packet = latest;\n    uint8_t encoded',
    )
    .replaceAll(
      'millis() + 60000',
      'millis() + settings.reportIntervalSeconds*1000u',
    )
  // "none/error/info" governs example diagnostic output; never prints secrets.
  main = main
    .replaceAll(
      'Serial.printf("Struct delivery: %d\\n", (int)result);',
      'if(settings.diagnosticLevel) Serial.printf("Struct delivery: %d\\n", (int)result);',
    )
    .replaceAll(
      'if(result==STRUCT_COMMITTED) Serial.println(',
      'if(settings.diagnosticLevel==2 && result==STRUCT_COMMITTED) Serial.println(',
    )
  project['src/main.cpp'] = main
  project['README.md'] +=
    '\n## Optional device management\nThis explicitly generated example applies sampling/reporting intervals and diagnostic level through an application callback. Management requires the server feature flag, database activation and administrator approval for this credential epoch. It polls verified HTTPS once/minute outside pending UDP delivery. Blocking TLS/download work can delay reporting; use an application-owned task when timing is critical.\n\nOTA is intentionally disabled in this starter. A qualified rollback bootloader, A/B partition table and real health callback are required before enabling it. Merely adding a sketch define does not rebuild the bootloader. Preserve both NVS journals during firmware updates. Lost management state cannot be reset with an old root; reprovision fresh credentials. The public signing key is pinned separately; changing a server key does not change firmware trust. See /docs/device-operations and sdk/management/README.md.\n'
  project['README.md'] +=
    '\n## Identity-preserving OTA build\nThe `struct` environment is an initial PRIVATE factory provisioning build and contains one device credential. Never distribute it through OTA. Once the device has genuinely bootstrapped, its same Secure V2 identity is persisted in NVS. Build common firmware with `pio run -e struct-ota`; this environment excludes compiled device IDs, roots and bootstrap tokens and loads each device’s own persisted identity. Only `struct-ota/firmware.bin` is eligible for signing/upload. The offline signer and upload route reject the factory-image marker. Preserve NVS; never clone the identity record. Physical credential replacement requires a new server-issued wire/root/token and explicit `STRUCT_FACTORY_REPROVISION=1` in a private factory build. A common OTA image cannot rotate credentials. Device flash/NVS secrecy requires separately provisioned platform protection; this code never programs eFuses.\n'
  project['README.md'] = project['README.md']!.replace(
    '`pio run -t upload',
    '`pio run -e struct -t upload',
  ).replace('`pio run`', '`pio run -e struct`')
  return project
}
