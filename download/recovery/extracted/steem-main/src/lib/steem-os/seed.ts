// ─────────────────────────────────────────────────────────────────────────────
// SAOS seed — creates the simulated world: treasury, citizens, module agents,
// app instances and a small organic content history so the dashboard is alive
// from the first second.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '@/lib/db'
import { ALL_MODULES } from './apps/registry'
import { ensureState } from './kernel'

const CITIZENS = [
  { name: 'crypto-orli', sp: 1800 },
  { name: 'dev-yoav', sp: 950 },
  { name: 'maya.writes', sp: 2400 },
  { name: 'shai-photography', sp: 620 },
  { name: 'noa-travels', sp: 1300 },
  { name: 'itamar.dev', sp: 400 },
  { name: 'gal-tech', sp: 760 },
  { name: 'talia.art', sp: 520 },
]

const SEED_POSTS = [
  { author: 'maya.writes', title: 'למה DPoS הוא הדמוקרטיה הכי מעשית בבלוקצ׳יין', body: 'מנגנון ההוכחה של הימור מופקד (DPoS) הוא הפשרה הכי מעשית בין ביזור לביצועים...\n\nבפוסט הזה אסביר למה 21 מפיקי בלוקים זה לא "קטן מדי", אלא בדיוק מספיק.', tags: ['dpos', 'governance'] },
  { author: 'crypto-orli', title: 'RC — המצאת העלות-אפס שכולם פספסו', body: 'לא gas. לא עמלות. Resource Credits נגזרים מ-SP ומתאוששים עם הזמן — זה מה שמאפשר סוכני AI שמריצים אלפי פעולות ביום...', tags: ['rc', 'economics'] },
  { author: 'dev-yoav', title: 'custom_json: החוזה החכם הכי לא מוערך ברשת', body: 'כל פעולה שרוצה state חופשי יכולה לרכב על custom_json. ככה בנויות קהילות, טוקנים ו-NFT ב-layer-2...', tags: ['custom-json', 'dev'] },
  { author: 'gal-tech', title: 'escrow מובנה בפרוטוקול — שוק P2P בלי מתווך', body: 'escrow_transfer, escrow_dispute, escrow_release — שלוש פעולות שהופכות את השרשרת לנוטריון...', tags: ['escrow', 'marketplace'] },
]

export async function seedAll() {
  await ensureState()

  // treasury / system account
  await db.agent.upsert({
    where: { name: 'treasury' },
    create: { name: 'treasury', role: 'system · אוצר הרשת', sp: 1_000_000, rcCap: 100_000, rc: 100_000, balance: 120_000, sbd: 60_000 },
    update: {},
  })

  // citizens (organic users, no owning module)
  for (const c of CITIZENS) {
    await db.agent.upsert({
      where: { name: c.name },
      create: {
        name: c.name,
        role: 'אזרח/ית הרשת',
        sp: c.sp,
        rcCap: 10000 + c.sp * 2,
        rc: 10000 + c.sp * 2,
        balance: 80 + Math.random() * 200,
        sbd: 40 + Math.random() * 120,
      },
      update: {},
    })
  }

  // module agents + instances
  for (const m of ALL_MODULES) {
    await db.appInstance.upsert({
      where: { id: m.id },
      create: { id: m.id, enabled: true, interval: m.interval, state: '{}' },
      update: {},
    })
    for (const spec of m.agents) {
      const sp = spec.sp ?? 1000
      await db.agent.upsert({
        where: { name: spec.name },
        create: {
          name: spec.name,
          role: spec.role,
          appId: m.id,
          sp,
          rcCap: 10000 + sp * 2,
          rc: 10000 + sp * 2,
          balance: spec.balance ?? 100,
          sbd: spec.sbd ?? 50,
        },
        update: {},
      })
    }
  }

  // a little organic content so curation/tipping/translation have something to read
  const count = await db.simPost.count()
  if (count === 0) {
    for (const p of SEED_POSTS) {
      const permlink = p.title.toLowerCase().replace(/[^a-z0-9\u0590-\u05FF]+/g, '-').slice(0, 48)
      const created = await db.simPost.create({
        data: {
          author: p.author,
          permlink,
          title: p.title,
          body: p.body,
          tags: JSON.stringify(p.tags),
          tick: 0,
        },
      })
      // one organic vote each
      const voter = CITIZENS[Math.floor(Math.random() * CITIZENS.length)]
      await db.simPost.update({ where: { id: created.id }, data: { votes: JSON.stringify([{ voter: voter.name, weight: 6000, value: 0.6, tick: 0 }]) } })
    }
  }
}

export async function resetAll() {
  await db.opLog.deleteMany()
  await db.simPost.deleteMany()
  await db.simEscrow.deleteMany()
  await db.simOrder.deleteMany()
  await db.simProposal.deleteMany()
  await db.simCustom.deleteMany()
  await db.tokenBalance.deleteMany()
  await db.nftItem.deleteMany()
  await db.appInstance.deleteMany()
  await db.agent.deleteMany()
  await db.simState.deleteMany()
  await seedAll()
}
