import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { firmwareStorage } from './firmwareStorage'
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
describe('private immutable firmware storage', () => {
  it('recovers identical orphaned uploads, streams ranges, rejects replacement and traversal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'struct-storage-test-'))
    try {
      vi.stubEnv('STRUCT_FIRMWARE_LOCAL_TEST', 'true')
      vi.stubEnv('STRUCT_FIRMWARE_DIRECTORY', dir)
      const file = join(dir, 'incoming.bin'),
        bytes = Buffer.alloc(256, 5),
        sha256 = createHash('sha256').update(bytes).digest('hex'),
        object = randomUUID() + '/' + randomUUID() + '.bin',
        adapter = firmwareStorage({})
      await writeFile(file, bytes)
      await adapter.put(object, file, { size: 256, sha256 })
      await adapter.put(object, file, { size: 256, sha256 })
      const chunks = []
      for await (const b of await adapter.read(object, 100, 109)) chunks.push(b)
      expect(Buffer.concat(chunks)).toEqual(bytes.subarray(100, 110))
      await writeFile(file, Buffer.alloc(256, 9))
      await expect(
        adapter.put(object, file, { size: 256, sha256: '00'.repeat(32) }),
      ).rejects.toThrow('conflict')
      await writeFile(join(dir, object), Buffer.alloc(257, 5))
      await expect(
        adapter.put(object, file, { size: 256, sha256 }),
      ).rejects.toThrow('conflict')
      await expect(adapter.read('../outside', 0, 1)).rejects.toThrow('identity')
    } finally {
      if (!resolve(dir).startsWith(resolve(tmpdir()) + sep))
        throw Error('Unsafe cleanup')
      await rm(dir, { recursive: true, force: true })
    }
  })
  it('never follows a storage URL to another origin', async () => {
    vi.stubEnv('STRUCT_FIRMWARE_LOCAL_TEST', 'false')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const adapter = firmwareStorage({
      supabaseUrl: 'https://storage.example.invalid',
      storage: {
        from: () => ({
          createSignedUrl: async () => ({
            data: { signedUrl: 'https://attacker.example.invalid/file' },
          }),
        }),
      },
    })
    await expect(adapter.read('fixture', 0, 255)).rejects.toThrow('origin')
    expect(fetch).not.toHaveBeenCalled()
  })
})
