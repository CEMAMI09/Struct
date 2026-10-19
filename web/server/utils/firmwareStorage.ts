import { createReadStream, createWriteStream, constants } from 'node:fs'
import { mkdir, copyFile, stat } from 'node:fs/promises'
import { resolve, dirname, sep } from 'node:path'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
const bucket = 'struct-firmware'
function localPath(object: string) {
  if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.bin$/.test(object))
    throw Error('Invalid firmware object identity')
  const root = resolve(process.env.STRUCT_FIRMWARE_DIRECTORY!),
    file = resolve(root, object)
  if (!file.startsWith(root + sep)) throw Error('Invalid firmware path')
  return file
}
export function firmwareStorage(service: any) {
  const local =
    process.env.STRUCT_FIRMWARE_LOCAL_TEST === 'true' &&
    !!process.env.STRUCT_FIRMWARE_DIRECTORY
  const adapter = {
    async put(
      object: string,
      file: string,
      expected: { size: number; sha256: string },
    ) {
      let existing = false
      if (local) {
        const dest = localPath(object)
        await mkdir(dirname(dest), { recursive: true, mode: 0o700 })
        try {
          await copyFile(file, dest, constants.COPYFILE_EXCL)
        } catch (e: any) {
          if (e.code !== 'EEXIST') throw e
          existing = true
        }
      } else {
        const r = await service.storage
          .from(bucket)
          .upload(object, createReadStream(file), {
            contentType: 'application/octet-stream',
            upsert: false,
            duplex: 'half',
          })
        if (r.error) {
          if (String(r.error.statusCode) !== '409')
            throw Error('Private firmware upload unavailable')
          existing = true
        }
      }
      // A crash between immutable object creation and SQL finalization is recoverable.
      // Never overwrite: compare every stored byte against the signed declaration.
      if (existing) {
        const info = local
          ? {
              data: { size: (await stat(localPath(object))).size },
              error: null,
            }
          : await service.storage.from(bucket).info(object)
        if (info.error || info.data?.size !== expected.size)
          throw Error('Stored firmware conflict')
        let length = 0
        const hash = createHash('sha256'),
          stream = await adapter.read(object, 0, expected.size - 1)
        for await (const bytes of stream) {
          length += bytes.length
          if (length > expected.size) throw Error('Stored firmware conflict')
          hash.update(bytes)
        }
        if (length !== expected.size || hash.digest('hex') !== expected.sha256)
          throw Error('Stored firmware conflict')
      }
    },
    async read(object: string, start: number, end: number) {
      if (local) {
        const file = localPath(object),
          size = (await stat(file)).size
        if (start < 0 || end >= size)
          throw Error('Invalid stored firmware range')
        return createReadStream(file, { start, end, highWaterMark: 16384 })
      }
      // Public SDK creates a short-lived URL internally; it is never exposed to the device/logs.
      const signed = await service.storage
        .from(bucket)
        .createSignedUrl(object, 60)
      if (signed.error || !signed.data?.signedUrl)
        throw Error('Private firmware unavailable')
      const url = new URL(signed.data.signedUrl),
        origin = new URL(service.supabaseUrl).origin
      if (url.origin !== origin)
        throw Error('Untrusted firmware storage origin')
      const response = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}` },
        redirect: 'error',
        signal: AbortSignal.timeout(120000),
      })
      if (
        ![200, 206].includes(response.status) ||
        !response.body ||
        (start > 0 && response.status !== 206)
      )
        throw Error('Firmware storage range unavailable')
      return Readable.fromWeb(response.body as any)
    },
  }
  return adapter
}
