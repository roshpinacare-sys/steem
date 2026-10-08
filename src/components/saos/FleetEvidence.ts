/**
 * R269 · fleet-evidence — the shared type contract between the cockpit and
 * /api/saos/fleet-evidence. Every field here is MEASURED (probe JSON, engine
 * custody state, git receipts) — the UI renders truth, never prose.
 */
export type PublishVerdict = 'LIVE-PROVEN' | 'READY' | 'RC-LOW' | 'NO-CUSTODY' | 'NOT-EXISTS' | string

export interface MatrixAccount {
  exists?: boolean
  created?: string
  last_post?: string | null
  last_post_age_h?: number | null
  posting_fp?: string | null
  active_fp?: string | null
  owner_fp?: string | null
  custody?: 'VERIFIED' | 'UNKNOWN' | string
  rc?: { max_g?: number; available_g?: number; pct?: number | null; delegated_rc_g?: number } | null
  delegations_out?: { to: string; vests: number; hp: number }[]
  delegations_in?: { from: string; vests: number; hp: number }[]
  delegations_out_vests?: number
  delegations_in_vests?: number
  publish?: { verdict: PublishVerdict; reason?: string }
  deleg_err?: string
}

export interface MatrixChain {
  accounts?: Record<string, MatrixAccount>
  summary?: {
    bodies?: number
    exists?: number
    custodyVerified?: number
    liveProven?: number
    ready?: number
    rcLow?: number
    noCustody?: number
    delegations_out_vests?: number
    delegations_in_vests?: number
  }
  rcDirect?: { from?: string; to?: string; delegated_rc?: number; error?: string }[]
  rcDirectNote?: string
  rc_error?: string
  vestsToHp?: number
}

export interface FleetEvidence {
  ok?: boolean
  at?: string
  connection?: {
    verdict?: string
    who?: string
    keys?: string
    receiptCommits?: string[]
    probes?: string[]
    whaleBoundary?: string
  }
  custody?: {
    steem?: { at?: string | null; verdict?: string | null; verified?: number | null; total?: number | null }
    hive?: { at?: string | null; verdict?: string | null; verified?: number | null; total?: number | null }
  }
  timeline?: { day: string; count: number; authors: string[]; sample: string }[]
  matrix?: { at?: string; probe?: string; law?: string; chains?: { steem?: MatrixChain; hive?: MatrixChain } }
}
