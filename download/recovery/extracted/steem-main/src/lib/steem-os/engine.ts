// ─────────────────────────────────────────────────────────────────────────────
// SAOS Engine — the in-process tick loop ("blocks").
// 1 tick = 1 block (BASE 1500ms). Per tick: RC regen, savings releases,
// inflation drip, feed-price walk, periodic SPS payouts, and each enabled
// module's onTick (scheduled by its interval). Started lazily by API routes.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '@/lib/db'
import { ALL_MODULES } from './apps/registry'
import { broadcast, ensureState, PROPOSAL_PAYOUT_EVERY } from './kernel'
import type { AppModule, Agent, OpRequest, OpResult, TickContext } from './types'

const BASE_MS = 1500

type EngineGlobal = {
  timer: ReturnType<typeof setInterval> | null
  ticking: boolean
  speed: number
  lastError: string | null
}

const g = globalThis as unknown as { __saosEngine?: EngineGlobal }
function eng(): EngineGlobal {
  if (!g.__saosEngine) g.__saosEngine = { timer: null, ticking: false, speed: 1, lastError: null }
  return g.__saosEngine
}

// ── module instance self-healing (new modules get rows + agents on boot) ───
export async function ensureInstances() {
  for (const m of ALL_MODULES) {
    const inst = await db.appInstance.findUnique({ where: { id: m.id } })
    if (!inst) {
      await db.appInstance.create({
        data: { id: m.id, enabled: true, interval: m.interval, state: '{}' },
      })
    }
    for (const spec of m.agents) {
      const existing = await db.agent.findUnique({ where: { name: spec.name } })
      if (!existing) {
        const sp = spec.sp ?? 1000
        await db.agent.create({
          data: {
            name: spec.name,
            role: spec.role,
            appId: m.id,
            sp,
            rcCap: 10000 + sp * 2,
            rc: 10000 + sp * 2,
            balance: spec.balance ?? 100,
            sbd: spec.sbd ?? 50,
          },
        })
      }
    }
  }
}

async function ensureSeed() {
  await ensureState()
  const agents = await db.agent.count()
  if (agents === 0) {
    const { seedAll } = await import('./seed')
    await seedAll()
  }
  await ensureInstances()
}

export async function bootChain() {
  await ensureSeed()
  const st = await db.simState.findUnique({ where: { id: 1 } })
  if (st?.running) startEngine()
  return st
}

// ── engine controls ─────────────────────────────────────────────────────────
export async function startEngine() {
  const e = eng()
  if (e.timer) {
    await db.simState.update({ where: { id: 1 }, data: { running: true } }).catch(() => undefined)
    return
  }
  e.timer = setInterval(() => void runTick(), Math.max(300, Math.floor(BASE_MS / e.speed)))
  await db.simState.update({ where: { id: 1 }, data: { running: true } }).catch(() => undefined)
}

export function stopEngine() {
  const e = eng()
  if (e.timer) {
    clearInterval(e.timer)
    e.timer = null
  }
  void db.simState.update({ where: { id: 1 }, data: { running: false } }).catch(() => undefined)
}

export function setSpeed(speed: number) {
  const e = eng()
  e.speed = Math.max(1, Math.min(4, Math.round(speed)))
  void db.simState.update({ where: { id: 1 }, data: { speed: e.speed } }).catch(() => undefined)
  if (e.timer) {
    clearInterval(e.timer)
    e.timer = setInterval(() => void runTick(), Math.max(300, Math.floor(BASE_MS / e.speed)))
  }
}

export async function stepOnce() {
  await ensureSeed()
  await runTick()
}

// ── the tick itself ─────────────────────────────────────────────────────────
export async function runTick() {
  const e = eng()
  if (e.ticking) return
  e.ticking = true
  try {
    await ensureSeed()
    const st = await db.simState.findUnique({ where: { id: 1 } })
    if (!st) return
    const tick = st.tick + 1
    await db.simState.update({ where: { id: 1 }, data: { tick } })

    // 1. RC regen (5% of cap per block, capped)
    const agents = await db.agent.findMany()
    for (const a of agents) {
      const target = Math.min(a.rcCap, a.rc + Math.max(250, a.rcCap * 0.05))
      if (target !== a.rc) await db.agent.update({ where: { id: a.id }, data: { rc: target } })
    }

    // 2. savings releases due (amount parked in agent.meta by the kernel)
    const releasing = await db.agent.findMany({ where: { savingsReleaseTick: { not: null, lte: tick } } })
    for (const a of releasing) {
      try {
        const meta = a.meta ? (JSON.parse(a.meta) as Record<string, unknown>) : {}
        const amt = typeof meta.pendingSavings === 'number' ? meta.pendingSavings : 0
        const asset = meta.pendingSavingsAsset === 'SBD' ? 'SBD' : 'STEEM'
        if (amt > 0) {
          await db.agent.update({
            where: { id: a.id },
            data: {
              [asset === 'SBD' ? 'sbd' : 'balance']: { increment: amt },
              savingsReleaseTick: null,
              meta: JSON.stringify({ ...meta, pendingSavings: 0 }),
            },
          })
        } else {
          await db.agent.update({ where: { id: a.id }, data: { savingsReleaseTick: null } })
        }
      } catch {
        await db.agent.update({ where: { id: a.id }, data: { savingsReleaseTick: null } })
      }
    }

    // 2.5 recurring transfers due (recurring_transfer HF24 schedules)
    const withRecurrences = agents.filter((a) => {
      try {
        const m = a.meta ? (JSON.parse(a.meta) as Record<string, unknown>) : {}
        const recs = m.recurrences as { remaining?: number; nextTick?: number }[] | undefined
        return Array.isArray(recs) && recs.some((r) => r && (r.remaining ?? 0) > 0 && (r.nextTick ?? 0) <= tick)
      } catch {
        return false
      }
    })
    for (const a of withRecurrences) {
      let meta: Record<string, any> = {}
      try {
        meta = a.meta ? JSON.parse(a.meta) : {}
      } catch {
        continue
      }
      const recs: any[] = Array.isArray(meta.recurrences) ? meta.recurrences : []
      for (const r of recs) {
        if (!r || (r.remaining ?? 0) <= 0 || (r.nextTick ?? 0) > tick) continue
        // broadcast re-reads the agent fresh, so balance is never stale here
        const res = await broadcast(
          {
            op: 'transfer',
            agent: a.name,
            data: { to: r.to, amount: r.amount, asset: r.asset },
            note: `העברה חוזרת → @${r.to} (נותרו ${r.remaining - 1})`,
          },
          { tick }
        )
        if (res.ok) {
          r.remaining = (r.remaining ?? 1) - 1
          r.nextTick = tick + (r.intervalTicks ?? 24)
        } else {
          r.nextTick = tick + 6 // retry shortly (e.g. insufficient balance)
        }
      }
      meta.recurrences = recs.filter((r) => r && (r.remaining ?? 0) > 0)
      await db.agent
        .update({ where: { id: a.id }, data: { meta: JSON.stringify(meta) } })
        .catch(() => undefined)
    }

    // 3. inflation drip + market walk
    const drift = (Math.random() - 0.5) * 0.02
    const feedPrice = Math.min(0.8, Math.max(0.12, st.feedPrice * (1 + drift)))
    await db.simState.update({
      where: { id: 1 },
      data: { rewardPool: { increment: 15 }, spsPool: { increment: 4 }, feedPrice },
    })

    // 4. periodic SPS payout (SP-weighted)
    if (tick % PROPOSAL_PAYOUT_EVERY === 0) await payoutProposals()

    // 5. run due app modules
    const instances = await db.appInstance.findMany({ where: { enabled: true } })
    for (const inst of instances) {
      const mod = ALL_MODULES.find((m) => m.id === inst.id)
      if (!mod) continue
      if (tick % Math.max(1, inst.interval) !== 0) continue
      try {
        await runModule(mod, tick, inst.state, inst.config)
      } catch (err) {
        await db.appInstance
          .update({
            where: { id: mod.id },
            data: { lastNote: `שגיאה: ${err instanceof Error ? err.message.slice(0, 120) : 'unknown'}` },
          })
          .catch(() => undefined)
      }
      await db.appInstance
        .update({ where: { id: mod.id }, data: { runs: { increment: 1 }, lastTickAt: new Date() } })
        .catch(() => undefined)
    }
  } catch (err) {
    eng().lastError = err instanceof Error ? err.message : String(err)
  } finally {
    e.ticking = false
  }
}

async function payoutProposals() {
  const st = await db.simState.findUnique({ where: { id: 1 } })
  if (!st) return
  const active = await db.simProposal.findMany({ where: { status: 'active' } })
  if (active.length === 0) return
  const withWeights = active.map((p) => {
    let w = 0
    try {
      const votes = p.votes ? (JSON.parse(p.votes) as Record<string, number>) : {}
      w = Object.values(votes).reduce((s, v) => s + Math.max(0, v), 0)
    } catch {
      w = 0
    }
    return { p, w }
  })
  const totalW = withWeights.reduce((s, x) => s + x.w, 0)
  if (totalW <= 0) return
  const budget = Math.min(st.spsPool, withWeights.reduce((s, x) => s + x.p.dailyPay * 10, 0))
  if (budget <= 0) return
  for (const { p, w } of withWeights) {
    if (w <= 0) continue
    const share = (w / totalW) * budget
    if (share < 0.01) continue
    const creator = await db.agent.findUnique({ where: { name: p.creator } })
    if (creator) {
      await db.agent.update({ where: { name: p.creator }, data: { pendingSbd: { increment: share } } })
      await db.simProposal.update({ where: { id: p.id }, data: { paid: { increment: share } } })
    }
  }
  await db.simState.update({ where: { id: 1 }, data: { spsPool: { decrement: budget } } })
}

// ── run one module invocation with a real context (tick or manual action) ──
export async function runModule(
  mod: AppModule,
  tick: number,
  stateJson: string | null,
  configJson: string | null,
  manualAction?: (ctx: TickContext) => Promise<void>
): Promise<{ state: Record<string, unknown>; notes: string[]; ops: number; okOps: number }> {
  await ensureState()
  const notes: string[] = []
  let ops = 0
  let okOps = 0
   
  let state: Record<string, any> = {}
  try {
    state = stateJson ? (JSON.parse(stateJson) as Record<string, unknown>) : {}
  } catch {
    state = {}
  }
   
  let config: Record<string, any> = {}
  try {
    config = configJson ? (JSON.parse(configJson) as Record<string, unknown>) : {}
  } catch {
    config = {}
  }

  const emit = async (op: OpRequest): Promise<OpResult> => {
    ops++
    const res = await broadcast(op, { appId: mod.id, tick })
    if (res.ok) okOps++
    return res
  }

  const ctx: TickContext = {
    tick,
    appId: mod.id,
    config,
    state,
    rng: Math.random,
    pick: <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)],
    emit,
    agent: async (name: string): Promise<Agent | null> => db.agent.findUnique({ where: { name } }),
    appAgents: async (): Promise<Agent[]> => db.agent.findMany({ where: { appId: mod.id } }),
    log: (n: string) => {
      notes.push(n)
      if (notes.length > 12) notes.shift()
    },
  }

  if (manualAction) await manualAction(ctx)
  else await mod.onTick(ctx)

  await db.appInstance.update({
    where: { id: mod.id },
    data: {
      state: JSON.stringify(state),
      lastNote: notes[notes.length - 1] ?? null,
      opsEmitted: { increment: ops },
    },
  })
  return { state, notes, ops, okOps }
}
