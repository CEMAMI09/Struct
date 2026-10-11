import type { LabResult, LabSettings } from '../../shared/protocol-lab/types'
// An inspectable model, never a packet capture. Each application flight is flushed
// into one TLS record (16 KiB maximum), TCP segmentation follows MSS, and every
// data segment receives one immediate, standalone ACK. No TCP options/extensions.
export function modelTcp(r: LabResult, s: LabSettings, up: number, down: number, upFlights = 1, downFlights = down ? 1 : 0, uplinkParts?: number[], downlinkParts?: number[]) {
  const ip = s.network === 'IPv4' ? 20 : 40, tcp = 20, mss = s.mtu - ip - tcp
  const tlsOverhead = s.security ? (s.tls === 'TLSv1.3' ? 22 : 29) : 0
  const flights = (bytes: number, count: number) => bytes ? [bytes-(count-1)*4,...Array.from({length:count-1},()=>4)] : []
  const encode = (parts: number[]) => parts.filter(n=>n>0).flatMap(n=>Array.from({length:Math.ceil(n/16384)},(_,i)=>Math.min(16384,n-i*16384)+tlsOverhead))
  const upRecords=encode(uplinkParts??flights(up,upFlights)), downRecords=encode(downlinkParts??flights(down,downFlights))
  const streamUp=upRecords.reduce((sum,n)=>sum+n,0),streamDown=downRecords.reduce((sum,n)=>sum+n,0)
  const upSegments=upRecords.reduce((sum,n)=>sum+Math.ceil(n/mss),0),downSegments=downRecords.reduce((sum,n)=>sum+Math.ceil(n/mss),0)
  const estimate = (value: number, note: string) => ({ value, evidence: 'estimated' as const, note })
  const note = `TCP model: MSS ${mss}, ${tcp}-byte TCP/${ip}-byte IP headers, no options, one standalone ACK per data segment, no piggyback/delayed ACK, ${s.security ? s.tls + ' record overhead ' + tlsOverhead + ' B' : 'plaintext'}, no loss. Captured traffic can differ.`
  const netUp = streamUp + (upSegments + downSegments) * (tcp + ip)
  const netDown = streamDown + (downSegments + upSegments) * (tcp + ip)
  r.metrics.stream = (r.metrics.stream?.value === null || r.metrics.stream === undefined) && !(s.includeSetup && s.connection !== 'persistent')
    ? estimate(streamUp + (s.traffic === 'exchange' ? streamDown : 0), note)
    : r.metrics.stream ?? { value:null, evidence:'not_tested',note:'Complete session stream unavailable.' }
  // Prefer actual matching measured stream lengths when available, while keeping
  // segmentation/ACKs explicitly modeled. QoS2 has two flights each way.
  if (r.metrics.stream.evidence === 'measured') {
    const modeledStream = streamUp + (s.traffic === 'exchange' ? streamDown : 0)
    const delta = r.metrics.stream.value! - modeledStream
    // For full exchange, direction allocation is unavailable: don't redistribute
    // a combined captured count into invented directional values.
    if (delta) r.notes.push('Network model uses explicit TLS flight assumptions rather than redistributing a combined measured stream.')
  }
  if (s.includeSetup && s.connection !== 'persistent') {
    const reuse = s.connection === 'fresh' ? 1 : s.messagesPerConnection
    // TCP three-way open plus two-way FIN/ACK termination = seven empty packets.
    // TLS/MQTT setup only when a matching measured reference exists; otherwise
    // withhold full lifecycle totals rather than assume an arbitrary handshake.
    if (r.metrics.setup?.value === null || r.metrics.setup === undefined) {
      for (const key of ['networkUp', 'networkDown', 'exchange'])
        r.metrics[key] = { value: null, evidence: 'not_tested', note: 'No matching TLS/MQTT setup reference. Disable setup accounting for an explicit steady-state model.' }
      return
    }
    const setup = r.metrics.setup.value!
    const segments = Math.ceil(setup / mss)
    const lifecycle = (setup + (7 + segments * 2) * (ip + tcp)) / reuse
    // Only combined setup lengths exist in archive. Full exchange can be modeled;
    // a directional split cannot be inferred from that combined length.
    r.metrics.networkUp = { value: null, evidence: 'not_tested', note: 'Directional setup bytes unavailable; select full exchange.' }
    r.metrics.networkDown = { value: null, evidence: 'not_tested', note: 'Directional setup bytes unavailable.' }
    r.metrics.exchange = estimate(netUp + netDown + lifecycle, note + ` Combined setup model amortized over ${reuse} transmissions; termination/ACK packet assumptions included. Keepalives excluded.`)
    r.parts.connection = lifecycle
    return
  }
  r.metrics.networkUp = estimate(netUp, note)
  r.metrics.networkDown = estimate(netDown, note)
  r.metrics.exchange = estimate(netUp + netDown, note)
  r.metrics.transport = estimate((upSegments + downSegments) * tcp, 'Modeled uplink data and reverse-direction ACK TCP headers.')
  r.metrics.network = estimate((upSegments + downSegments) * ip, 'Modeled uplink data and reverse-direction ACK IP headers.')
  r.parts.security = streamUp - up
  r.parts.transport = (upSegments + downSegments) * tcp
  r.parts.network = (upSegments + downSegments) * ip
  r.parts.response = s.traffic === 'exchange' ? netDown : 0
  r.notes.push(note, 'Steady-state network model excludes DNS, TCP options, keepalives, retries, registration and radio framing. Suitable for scenario estimates, not captured carrier traffic.')
}
