import { gunzipSync } from 'node:zlib'
import type { ResearchIndex } from '../../shared/protocol-lab/types'
let pending: Promise<ResearchIndex> | undefined
export function loadResearch(): Promise<ResearchIndex> {
  if (!pending)
    pending = (async () => {
      const asset = await useStorage('assets:protocol-lab').getItemRaw<Buffer>('index.json.gz')
      if (!asset) throw Error('Protocol Lab dataset unavailable. Run npm run lab:data.')
      return JSON.parse(gunzipSync(Buffer.from(asset)).toString('utf8')) as ResearchIndex
    })().catch((error) => {
      pending = undefined
      throw error
    })
  return pending
}
