import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  ArtifactRef,
  ConsentRef,
  Message,
  Mission,
  MissionStatus,
  ProtocolConfig,
  ProtocolEvent,
  ProtocolStore,
  Role,
  Status,
} from './types.js'

const SCHEMA_VERSION = 1 as const

interface EnvelopeV1 {
  schemaVersion: typeof SCHEMA_VERSION
  missions: Record<string, Mission>
  messages: Record<string, Message[]>
  events: ProtocolEvent[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function cloneDeep<T>(value: T): T {
  return structuredClone(value)
}

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} must be non-empty`)
}

function assertRole(role: Role): void {
  if (role !== 'A' && role !== 'B') throw new Error(`invalid role: ${role}`)
}

function assertStatus(status: Status): void {
  const ok: Status[] = ['proposed', 'accepted', 'rejected', 'expired', 'revoked']
  if (!ok.includes(status)) throw new Error(`invalid status: ${status}`)
}

function assertMissionStatus(status: MissionStatus): void {
  const ok: MissionStatus[] = ['open', 'blocked', 'done', 'cancelled']
  if (!ok.includes(status)) throw new Error(`invalid mission_status: ${status}`)
}

function assertArtifact(a: ArtifactRef): void {
  assertNonEmpty(a.uri, 'artifact.uri')
  assertNonEmpty(a.media_type, 'artifact.media_type')
  assertNonEmpty(a.sha256, 'artifact.sha256')
  if (!/^[a-f0-9]{64}$/i.test(a.sha256)) throw new Error('artifact.sha256 must be 64 hex chars')
  if (!Number.isInteger(a.bytes) || a.bytes < 0) throw new Error('artifact.bytes must be >= 0')
}

function assertConsent(c: ConsentRef): void {
  assertNonEmpty(c.id, 'consent.id')
  assertStatus(c.status)
  assertNonEmpty(c.scope, 'consent.scope')
  assertNonEmpty(c.granted_by, 'consent.granted_by')
  assertNonEmpty(c.granted_at, 'consent.granted_at')
  if (Number.isNaN(Date.parse(c.granted_at))) throw new Error('consent.granted_at must be ISO datetime')
  if (c.expires_at !== undefined) {
    if (Number.isNaN(Date.parse(c.expires_at))) throw new Error('consent.expires_at must be ISO datetime')
  }
}

function emptyEnvelope(): EnvelopeV1 {
  return { schemaVersion: SCHEMA_VERSION, missions: {}, messages: {}, events: [] }
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await rename(tmp, filePath)
}

export class FileProtocolStore implements ProtocolStore {
  private readonly root: string
  private readonly filePath: string
  private readonly defaultArtifactsRoot: string
  private envelope: EnvelopeV1 = emptyEnvelope()
  private loaded = false
  private writeChain: Promise<void> = Promise.resolve()

  constructor(config: ProtocolConfig) {
    this.root = path.resolve(config.rootDir)
    this.filePath = path.join(this.root, 'protocol.json')
    this.defaultArtifactsRoot = path.resolve(config.artifactsDir ?? path.join(this.root, 'artifacts'))
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as EnvelopeV1
      if (parsed.schemaVersion !== SCHEMA_VERSION) {
        throw new Error(`unsupported schemaVersion: ${String(parsed.schemaVersion)}`)
      }
      this.envelope = {
        schemaVersion: SCHEMA_VERSION,
        missions: parsed.missions ?? {},
        messages: parsed.messages ?? {},
        events: parsed.events ?? [],
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        this.envelope = emptyEnvelope()
        await atomicWriteJson(this.filePath, this.envelope)
      } else {
        throw err
      }
    }
    this.loaded = true
  }

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn)
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async persist(): Promise<void> {
    await atomicWriteJson(this.filePath, this.envelope)
  }

  private pushEvent(type: ProtocolEvent['type'], missionId: string, detail?: Record<string, unknown>): void {
    this.envelope.events.push({
      type,
      at: nowIso(),
      mission_id: missionId,
      detail,
    })
  }

  async createMission(input: {
    title: string
    goal: string
    created_by: Role
    metadata?: Record<string, unknown>
  }): Promise<Mission> {
    return this.enqueueWrite(async () => {
      await this.ensureLoaded()
      assertNonEmpty(input.title, 'title')
      assertNonEmpty(input.goal, 'goal')
      assertRole(input.created_by)
      const id = randomUUID()
      const ts = nowIso()
      const mission: Mission = {
        id,
        title: input.title.trim(),
        goal: input.goal.trim(),
        status: 'open',
        created_by: input.created_by,
        created_at: ts,
        updated_at: ts,
        metadata: input.metadata ? cloneDeep(input.metadata) : undefined,
      }
      this.envelope.missions[id] = mission
      this.envelope.messages[id] = []
      this.pushEvent('mission_created', id, { title: mission.title, created_by: mission.created_by })
      await this.persist()
      return cloneDeep(mission)
    })
  }

  async getMission(id: string): Promise<Mission | undefined> {
    await this.ensureLoaded()
    const m = this.envelope.missions[id]
    return m ? cloneDeep(m) : undefined
  }

  async listMissions(): Promise<Mission[]> {
    await this.ensureLoaded()
    return Object.values(this.envelope.missions)
      .map(cloneDeep)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  async updateMissionStatus(id: string, status: MissionStatus): Promise<Mission> {
    return this.enqueueWrite(async () => {
      await this.ensureLoaded()
      assertMissionStatus(status)
      const mission = this.envelope.missions[id]
      if (!mission) throw new Error(`mission not found: ${id}`)
      mission.status = status
      mission.updated_at = nowIso()
      this.pushEvent('mission_status', id, { status })
      await this.persist()
      return cloneDeep(mission)
    })
  }

  async send(input: {
    mission_id: string
    from: Role
    to: Role
    body: string
    artifacts?: ArtifactRef[]
    consent_ref?: ConsentRef
  }): Promise<Message> {
    return this.enqueueWrite(async () => {
      await this.ensureLoaded()
      assertRole(input.from)
      assertRole(input.to)
      assertNonEmpty(input.body, 'body')
      if (input.from === input.to) throw new Error('from and to must differ')
      const mission = this.envelope.missions[input.mission_id]
      if (!mission) throw new Error(`mission not found: ${input.mission_id}`)
      if (mission.status === 'cancelled' || mission.status === 'done') {
        throw new Error(`mission is ${mission.status}; cannot send`)
      }
      const artifacts = (input.artifacts ?? []).map((a) => {
        assertArtifact(a)
        return cloneDeep(a)
      })
      let consent_ref: ConsentRef | undefined
      if (input.consent_ref) {
        assertConsent(input.consent_ref)
        consent_ref = cloneDeep(input.consent_ref)
      }
      const msg: Message = {
        id: randomUUID(),
        mission_id: input.mission_id,
        from: input.from,
        to: input.to,
        body: input.body,
        created_at: nowIso(),
        artifacts: artifacts.length ? artifacts : undefined,
        consent_ref,
      }
      const list = this.envelope.messages[input.mission_id] ?? []
      list.push(msg)
      this.envelope.messages[input.mission_id] = list
      mission.updated_at = msg.created_at
      this.pushEvent('message_sent', input.mission_id, {
        message_id: msg.id,
        from: msg.from,
        to: msg.to,
        artifact_count: artifacts.length,
        has_consent: Boolean(consent_ref),
      })
      await this.persist()
      return cloneDeep(msg)
    })
  }

  async listMessages(missionId: string): Promise<Message[]> {
    await this.ensureLoaded()
    const list = this.envelope.messages[missionId] ?? []
    return list.map(cloneDeep)
  }

  async addArtifactFile(input: {
    mission_id: string
    from: Role
    to: Role
    filePath: string
    media_type: string
    body?: string
    consent_ref?: ConsentRef
  }): Promise<{ message: Message; artifact: ArtifactRef }> {
    return this.enqueueWrite(async () => {
      await this.ensureLoaded()
      const mission = this.envelope.missions[input.mission_id]
      if (!mission) throw new Error(`mission not found: ${input.mission_id}`)
      const abs = path.resolve(input.filePath)
      const bytesBuf = await readFile(abs)
      const sha256 = createHash('sha256').update(bytesBuf).digest('hex')
      const destDir = path.join(this.defaultArtifactsRoot, input.mission_id)
      await mkdir(destDir, { recursive: true })
      const base = path.basename(abs)
      const dest = path.join(destDir, `${sha256.slice(0, 12)}-${base}`)
      await writeFile(dest, bytesBuf)
      const artifact: ArtifactRef = {
        uri: dest,
        media_type: input.media_type,
        sha256,
        bytes: bytesBuf.byteLength,
      }
      const msg = await this.sendUnlocked({
        mission_id: input.mission_id,
        from: input.from,
        to: input.to,
        body: input.body ?? `artifact:${base}`,
        artifacts: [artifact],
        consent_ref: input.consent_ref,
      })
      this.pushEvent('artifact_added', input.mission_id, {
        message_id: msg.id,
        uri: artifact.uri,
        sha256: artifact.sha256,
        bytes: artifact.bytes,
      })
      await this.persist()
      return { message: cloneDeep(msg), artifact: cloneDeep(artifact) }
    })
  }

  /** Internal send used while already holding the write lock. */
  private async sendUnlocked(input: {
    mission_id: string
    from: Role
    to: Role
    body: string
    artifacts?: ArtifactRef[]
    consent_ref?: ConsentRef
  }): Promise<Message> {
    assertRole(input.from)
    assertRole(input.to)
    assertNonEmpty(input.body, 'body')
    if (input.from === input.to) throw new Error('from and to must differ')
    const mission = this.envelope.missions[input.mission_id]
    if (!mission) throw new Error(`mission not found: ${input.mission_id}`)
    if (mission.status === 'cancelled' || mission.status === 'done') {
      throw new Error(`mission is ${mission.status}; cannot send`)
    }
    const artifacts = (input.artifacts ?? []).map((a) => {
      assertArtifact(a)
      return cloneDeep(a)
    })
    let consent_ref: ConsentRef | undefined
    if (input.consent_ref) {
      assertConsent(input.consent_ref)
      consent_ref = cloneDeep(input.consent_ref)
    }
    const msg: Message = {
      id: randomUUID(),
      mission_id: input.mission_id,
      from: input.from,
      to: input.to,
      body: input.body,
      created_at: nowIso(),
      artifacts: artifacts.length ? artifacts : undefined,
      consent_ref,
    }
    const list = this.envelope.messages[input.mission_id] ?? []
    list.push(msg)
    this.envelope.messages[input.mission_id] = list
    mission.updated_at = msg.created_at
    this.pushEvent('message_sent', input.mission_id, {
      message_id: msg.id,
      from: msg.from,
      to: msg.to,
      artifact_count: artifacts.length,
      has_consent: Boolean(consent_ref),
    })
    return msg
  }

  async listEvents(missionId?: string): Promise<ProtocolEvent[]> {
    await this.ensureLoaded()
    const events = missionId
      ? this.envelope.events.filter((e) => e.mission_id === missionId)
      : this.envelope.events
    return events.map(cloneDeep)
  }

  async exportMarkdown(missionId: string): Promise<string> {
    await this.ensureLoaded()
    const mission = this.envelope.missions[missionId]
    if (!mission) throw new Error(`mission not found: ${missionId}`)
    const messages = this.envelope.messages[missionId] ?? []
    const lines: string[] = [
      `# Mission: ${mission.title}`,
      '',
      `- id: \`${mission.id}\``,
      `- status: \`${mission.status}\``,
      `- goal: ${mission.goal}`,
      `- created_by: ${mission.created_by}`,
      `- created_at: ${mission.created_at}`,
      `- updated_at: ${mission.updated_at}`,
      '',
      '## Messages',
      '',
    ]
    for (const m of messages) {
      lines.push(`### ${m.created_at} — ${m.from} → ${m.to}`)
      lines.push('')
      lines.push(m.body)
      lines.push('')
      if (m.artifacts?.length) {
        lines.push('Artifacts:')
        for (const a of m.artifacts) {
          lines.push(`- \`${a.uri}\` (${a.media_type}, ${a.bytes} bytes, sha256=${a.sha256})`)
        }
        lines.push('')
      }
      if (m.consent_ref) {
        lines.push(
          `Consent: id=${m.consent_ref.id} status=${m.consent_ref.status} scope=${m.consent_ref.scope}`,
        )
        lines.push('')
      }
    }
    return `${lines.join('\n')}\n`
  }
}

export function createProtocolStore(config: ProtocolConfig): ProtocolStore {
  return new FileProtocolStore(config)
}
