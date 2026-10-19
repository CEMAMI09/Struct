import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { unzipSync, strToU8 } from 'fflate'
import { embedSecureV2Sdk } from './secureV2Project'
import { describe, it, expect } from 'vitest'
import { generateSecureV2Project } from './secureV2Project'
import { ENVIRONMENTAL_PACKED } from './secureV2Schema'
const input = {
  slot: {
    slot: 0,
    encoding: 'bitpacked-v1' as const,
    schema_definition: ENVIRONMENTAL_PACKED,
    record_bytes: 3,
  },
  credentials: {
    wireDeviceId: 123,
    rootSecret: '12'.repeat(32),
    bootstrapToken: '23'.repeat(32),
  },
  board: 'esp32dev' as const,
}
const management = {
  organizationId: '12345678-1234-4123-8123-123456789abc',
  publicKeyPem:
    '-----BEGIN PUBLIC KEY-----\nfixture-public-only\n-----END PUBLIC KEY-----',
  keyFingerprint: 'ab'.repeat(32),
  hardwareModel: 'sensor',
  hardwareRevision: 'A',
  bootloaderVersion: 1,
}
describe('explicit management starter', () => {
  it('preserves telemetry-only default and adds actual application settings only when selected', () => {
    expect(generateSecureV2Project(input)['src/main.cpp']).not.toContain(
      'StructManagementEsp32',
    )
    const p = generateSecureV2Project({ ...input, management }),
      main = p['src/main.cpp']!
    expect(main).toContain('management.begin')
    expect(main).toContain('client.freshlyBootstrapped()')
    expect(main).toContain('false,client.freshlyBootstrapped()')
    expect(main).toContain('settings.reportIntervalSeconds*1000u')
    expect(main).toContain('settings.sampleIntervalSeconds*1000u')
    expect(main).toContain('StructPacket packet = latest')
    expect(main).toContain('latest.f_temperature')
    expect(main).not.toContain('setInsecure')
    expect(p['README.md']).toContain('OTA is intentionally disabled')
    expect(p['platformio.ini']).toContain('STRUCT_FACTORY_PROVISIONING=0')
    expect(main).toContain('StructManagedIdentityEsp32::load')
    expect(p['include/struct_config.h']).toContain(
      '#if STRUCT_FACTORY_PROVISIONING',
    )
  })
  it('rejects insecure endpoints, private keys and unbounded hardware metadata', () => {
    for (const patch of [
      { origin: 'http://example.com' },
      { origin: 'https://example.com/path' },
      { publicKeyPem: '-----BEGIN PRIVATE KEY-----' },
      { hardwareModel: 'x'.repeat(65) },
      { keyFingerprint: '00' },
    ])
      expect(() =>
        generateSecureV2Project({
          ...input,
          management: { ...management, ...patch },
        }),
      ).toThrow()
  })
})

describe('optional ESP32 management source compilation', () => {
  it
    .skipIf(process.env.STRUCT_MANAGEMENT_EMBEDDED_TESTS !== 'true')
    .each(['esp32dev', 'esp32-c3-devkitm-1'] as const)(
    'compiles the real management agent for %s (not a firmware image or hardware test)',
    (board) => {
      const archive = unzipSync(
          new Uint8Array(
            readFileSync(
              new URL('../public/sdk/struct-sdk.zip', import.meta.url),
            ),
          ),
        ),
        files = generateSecureV2Project({ ...input, board, management }),
        project = embedSecureV2Sdk(
          Object.fromEntries(
            Object.entries(files).map(([k, v]) => [k, strToU8(v)]),
          ),
          archive,
        ),
        directory = resolve('../work/management/source-' + board)
      mkdirSync(directory, { recursive: true })
      for (const [name, bytes] of Object.entries(project)) {
        const file = resolve(directory, name)
        if (!file.startsWith(directory + requireSeparator()))
          throw Error('Invalid generated path')
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, bytes)
      }
      const pio =
        process.env.STRUCT_PLATFORMIO ||
        resolve(process.env.USERPROFILE!, '.platformio/penv/Scripts/pio.exe')
      execFileSync(
        pio,
        ['run', '-e', 'struct-ota', '-t', 'compiledb', '-d', directory],
        {
          stdio: 'pipe',
          timeout: 180000,
        },
      )
      const commands = JSON.parse(
          readFileSync(resolve(directory, 'compile_commands.json'), 'utf8'),
        ),
        main = commands.find(
          (c: any) =>
            c.file.replaceAll('\\', '/').endsWith('/src/main.cpp') ||
            c.file.replaceAll('\\', '/') === 'src/main.cpp',
        )
      expect(main).toBeTruthy()
      mkdirSync(resolve(directory, '.pio/build/struct/src'), {
        recursive: true,
      })
      const compiler = resolve(
        process.env.USERPROFILE!,
        board === 'esp32dev'
          ? '.platformio/packages/toolchain-xtensa-esp-elf/bin/xtensa-esp32-elf-g++.exe'
          : '.platformio/packages/toolchain-riscv32-esp/riscv32-esp-elf/bin/riscv32-esp-elf-g++.exe',
      )
      const args = windowsArgs(main.command).slice(1),
        outputFile = resolve(directory, args[args.indexOf('-o') + 1]!),
        responseFile = resolve(directory, 'management-compile.rsp')
      mkdirSync(dirname(outputFile), { recursive: true })
      writeFileSync(responseFile, args.map((a) => JSON.stringify(a)).join('\n'))
      try {
        execFileSync(compiler, ['@' + responseFile], {
          cwd: main.directory,
          stdio: 'pipe',
          timeout: 180000,
        })
      } catch (e: any) {
        throw Error(String(e.stderr || e.message).slice(-12000))
      }
      expect(readFileSync(outputFile).length).toBeGreaterThan(0)
    },
    240000,
  )
})
function requireSeparator() {
  return process.platform === 'win32' ? '\\' : '/'
}

function windowsArgs(command: string) {
  const result: string[] = []
  let value = '',
    quoted = false
  for (let i = 0; i < command.length; ) {
    let slashes = 0
    while (command[i] === '\\') {
      slashes++
      i++
    }
    if (command[i] === '"') {
      value += '\\'.repeat(Math.floor(slashes / 2))
      if (slashes % 2) value += '"'
      else quoted = !quoted
      i++
      continue
    }
    value += '\\'.repeat(slashes)
    if (i === command.length) break
    const c = command[i++]!
    if (/\s/.test(c) && !quoted) {
      if (value) {
        result.push(value)
        value = ''
      }
    } else value += c
  }
  if (value) result.push(value)
  return result
}
