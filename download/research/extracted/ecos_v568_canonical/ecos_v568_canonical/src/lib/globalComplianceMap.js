'use strict';

/**
 * ECOS Global Compliance Map — V127
 * 
 * ECOS operates globally. This module maps regulatory frameworks
 * across ALL major jurisdictions — not just EU.
 * 
 * Coverage:
 *   - North America (US federal + state, Canada)
 *   - Europe (EU, UK post-Brexit)
 *   - Asia-Pacific (Singapore, Japan, Australia, India, Israel)
 *   - Latin America (Brazil, Mexico)
 *   - Middle East / Africa (UAE, South Africa)
 * 
 * Used by:
 *   GET /api/v1/compliance/global-map  — returns full matrix
 *   GET /api/v1/compliance/region/:id  — returns single region
 *   GET /api/v1/compliance/applicable  — returns frameworks for customer's jurisdiction
 */

const GLOBAL_COMPLIANCE_FRAMEWORKS = {

  // ─── NORTH AMERICA ────────────────────────────────────────────────────────

  'us-federal': {
    region: 'North America',
    jurisdiction: 'United States (Federal)',
    frameworks: [
      {
        id: 'nist-ai-rmf',
        name: 'NIST AI Risk Management Framework 1.0',
        type: 'voluntary',
        authority: 'NIST',
        enforcementDate: '2023-01-26',
        penalty: 'No direct penalty (voluntary framework)',
        ecosMapping: {
          GOVERN:  'SHA-256 audit chain as governance artifact; confidence gate policy documented',
          MAP:     'Task routing documented by risk level; high-risk domains → HITL',
          MEASURE: 'Platt-scaling calibration; validator reputation; auto-settle rate',
          MANAGE:  'Human override at any confidence level; replay engine for recovery',
        },
        ecosArtifact: 'GET /api/v1/compliance/nist-report',
        status: 'MAPPED',
      },
      {
        id: 'executive-order-14110',
        name: 'Executive Order on AI Safety and Security (14110)',
        type: 'regulatory',
        authority: 'White House',
        enforcementDate: '2023-10-30',
        penalty: 'Agency-dependent',
        ecosMapping: {
          safetyTesting:  'Confidence gate + BLOCK verdict prevents unsafe outputs',
          humanOversight: 'HITL gate for all confidence 0.30–0.70 range',
          auditability:   'SHA-256 append-only chain; GET /api/v1/audit/export',
        },
        status: 'MAPPED',
      },
      {
        id: 'sec-ai-guidance',
        name: 'SEC AI/ML Model Risk Guidance',
        type: 'regulatory',
        authority: 'SEC',
        enforcementDate: '2024-01-01',
        penalty: 'Civil enforcement; disgorgement',
        relevantVerticals: ['finance', 'investment', 'credit'],
        ecosMapping: {
          modelRisk:    'Confidence calibrator with Platt scaling; validator-reviewed decisions',
          explainability: 'Rationale attached to every HITL decision; GET /api/v1/audit/dag',
          auditTrail:   'SHA-256 chain; 6-month retention default; configurable',
        },
        status: 'MAPPED',
      },
    ],
  },

  'us-state': {
    region: 'North America',
    jurisdiction: 'United States (State Level)',
    frameworks: [
      {
        id: 'ccpa-cpra',
        name: 'California Consumer Privacy Act / CPRA',
        type: 'regulatory',
        authority: 'California Privacy Protection Agency',
        enforcementDate: '2020-01-01',
        penalty: '$2,500–$7,500 per intentional violation',
        relevantVerticals: ['all'],
        ecosMapping: {
          dataMinimization: 'Task inputs not retained beyond audit chain requirements',
          rightToKnow:      'Audit chain exports per-account on request',
          dataRetention:    'Configurable retention policy (default: comply with Article 26 analog)',
        },
        ecosArtifact: 'GET /api/v1/compliance/privacy-report?jurisdiction=california',
        status: 'PARTIAL — data inventory pending',
      },
      {
        id: 'hipaa',
        name: 'Health Insurance Portability and Accountability Act',
        type: 'regulatory',
        authority: 'HHS Office for Civil Rights',
        enforcementDate: '1996-08-21',
        penalty: '$100–$50,000 per violation; up to $1.9M/year per category',
        relevantVerticals: ['healthcare', 'medical'],
        ecosMapping: {
          minimumNecessary: 'Task routing with domain-scope enforcement',
          auditControls:    'SHA-256 chain; access logs; GET /api/v1/audit/access',
          accessControls:   'JWT auth; validator role-based access; apiKeyAuth middleware',
          businessAssociate: 'BAA template available; audit chain as BAA evidence',
        },
        ecosArtifact: 'GET /api/v1/compliance/hipaa-report',
        status: 'MAPPED — BAA template needed for production',
      },
      {
        id: 'ca-ab3030',
        name: 'California AB 3030 — AI Disclosure in Healthcare',
        type: 'regulatory',
        authority: 'California Legislature',
        enforcementDate: '2025-01-01',
        penalty: 'Civil liability',
        relevantVerticals: ['healthcare', 'medical'],
        ecosMapping: {
          disclosure: 'ECOS attaches AI-generated flag + confidence score to every output',
          humanReview: 'HITL gate routes low-confidence healthcare decisions to human validator',
        },
        status: 'MAPPED',
      },
    ],
  },

  'canada': {
    region: 'North America',
    jurisdiction: 'Canada',
    frameworks: [
      {
        id: 'aida',
        name: 'Artificial Intelligence and Data Act (AIDA)',
        type: 'proposed',
        authority: 'Government of Canada',
        enforcementDate: 'TBD (Bill C-27)',
        penalty: 'Up to 3% global revenue or CAD $10M',
        ecosMapping: {
          humanOversight: 'HITL gate; human can override any AI decision',
          riskAssessment: 'Confidence gate with per-domain risk classification',
          auditability:   'SHA-256 chain; immutable; replayable',
        },
        status: 'MAPPED (pre-emptive)',
      },
      {
        id: 'pipeda',
        name: 'Personal Information Protection and Electronic Documents Act',
        type: 'regulatory',
        authority: 'Office of the Privacy Commissioner of Canada',
        enforcementDate: '2001-01-01',
        ecosMapping: {
          consentPurpose: 'Task scope documented per request',
          accessRequest:  'Per-account audit exports',
        },
        status: 'PARTIAL',
      },
    ],
  },

  // ─── EUROPE ───────────────────────────────────────────────────────────────

  'eu': {
    region: 'Europe',
    jurisdiction: 'European Union',
    frameworks: [
      {
        id: 'eu-ai-act',
        name: 'EU AI Act — High-Risk Obligations (Articles 12 & 14)',
        type: 'regulatory',
        authority: 'European AI Office',
        enforcementDate: '2026-08-02',
        penalty: '€15M or 3% of global annual turnover (high-risk); €35M or 7% (prohibited)',
        relevantVerticals: ['insurance', 'legal', 'employment', 'finance', 'healthcare', 'education'],
        ecosMapping: {
          'Article 12 — Record-Keeping': 'SHA-256 chained audit log; immutable; append-only; replayable; GET /api/v1/audit/export',
          'Article 14 — Human Oversight': 'HITL gate; human can override; BLOCK verdict for unsafe outputs',
          'Article 26 — Deployer Obligations': 'Log retention ≥6 months; dashboard monitoring; incident webhooks',
        },
        ecosArtifact: 'GET /api/v1/audit/eu-ai-act-report',
        status: 'FULLY MAPPED — production deployment needed by Aug 2, 2026',
      },
      {
        id: 'gdpr',
        name: 'General Data Protection Regulation',
        type: 'regulatory',
        authority: 'National Data Protection Authorities',
        enforcementDate: '2018-05-25',
        penalty: '€20M or 4% of global annual turnover',
        ecosMapping: {
          dataMinimization: 'Task inputs not stored beyond legal requirement',
          auditLog:         'Per-account audit export on request',
          rightToErasure:   'NOTE: audit chain is append-only — discuss with legal counsel for GDPR Art. 17',
        },
        status: 'PARTIAL — Art. 17 tension with immutable audit chain; legal review needed',
      },
    ],
  },

  'uk': {
    region: 'Europe',
    jurisdiction: 'United Kingdom (Post-Brexit)',
    frameworks: [
      {
        id: 'uk-ai-white-paper',
        name: 'UK AI Regulation White Paper (Pro-Innovation)',
        type: 'voluntary',
        authority: 'DSIT / sector regulators (FCA, ICO, CQC)',
        enforcementDate: '2023-03-29',
        penalty: 'Sector-specific (FCA up to unlimited fines)',
        ecosMapping: {
          transparency:   'Confidence score + rationale on every output',
          accountability: 'Validator identity + SHA-256 chain; GET /api/v1/chain/proof',
          fairness:       'Golden task QC; validator reputation engine',
          safety:         'BLOCK verdict; pressure detector; semantic drift monitor',
        },
        status: 'MAPPED',
      },
      {
        id: 'uk-gdpr',
        name: 'UK GDPR (post-Brexit equivalent)',
        type: 'regulatory',
        authority: 'Information Commissioner\'s Office (ICO)',
        enforcementDate: '2021-01-01',
        penalty: '£17.5M or 4% of global annual turnover',
        status: 'PARTIAL — same tension as EU GDPR Art. 17',
      },
    ],
  },

  // ─── ASIA-PACIFIC ─────────────────────────────────────────────────────────

  'singapore': {
    region: 'Asia-Pacific',
    jurisdiction: 'Singapore',
    frameworks: [
      {
        id: 'mas-fair',
        name: 'MAS Fairness, Ethics, Accountability, Transparency (FEAT) Principles',
        type: 'voluntary',
        authority: 'Monetary Authority of Singapore',
        enforcementDate: '2019-11-12',
        penalty: 'No direct penalty (principles-based)',
        relevantVerticals: ['finance', 'insurance', 'credit'],
        ecosMapping: {
          Fairness:       'Validator reputation engine; golden task QC prevents biased routing',
          Ethics:         'Confidence gate + BLOCK verdict; pressure detector',
          Accountability: 'SHA-256 chain; X-Agent-Id on every response',
          Transparency:   'Confidence score + rationale; GET /api/v1/audit/dag',
        },
        status: 'MAPPED',
      },
      {
        id: 'pdpa-sg',
        name: 'Personal Data Protection Act (PDPA)',
        type: 'regulatory',
        authority: 'Personal Data Protection Commission',
        enforcementDate: '2013-01-02',
        penalty: 'Up to SGD $1M',
        status: 'PARTIAL',
      },
    ],
  },

  'japan': {
    region: 'Asia-Pacific',
    jurisdiction: 'Japan',
    frameworks: [
      {
        id: 'meti-ai-principles',
        name: 'METI AI Governance Guidelines 2.0',
        type: 'voluntary',
        authority: 'Ministry of Economy, Trade and Industry',
        enforcementDate: '2023-01-01',
        ecosMapping: {
          humanCentric:   'HITL gate ensures human oversight on all borderline decisions',
          accountability: 'SHA-256 chain with validator identity (GET /api/v1/chain/proof)',
          innovation:     'Auto-settle for high-confidence tasks enables speed',
        },
        status: 'MAPPED',
      },
      {
        id: 'act-on-protection-personal-info',
        name: 'Act on the Protection of Personal Information (APPI)',
        type: 'regulatory',
        authority: 'Personal Information Protection Commission Japan',
        enforcementDate: '2022-04-01',
        penalty: 'Up to JPY 100M (corporate)',
        status: 'PARTIAL',
      },
    ],
  },

  'australia': {
    region: 'Asia-Pacific',
    jurisdiction: 'Australia',
    frameworks: [
      {
        id: 'au-ai-framework',
        name: 'Australia AI Ethics Framework',
        type: 'voluntary',
        authority: 'Department of Industry, Science and Resources',
        enforcementDate: '2019-11-07',
        ecosMapping: {
          humanCentric:    'HITL gate; human override always available',
          fairness:        'Validator reputation + golden task QC',
          transparency:    'Confidence score + rationale; audit chain export',
          contestability:  'replay engine enables post-hoc decision review',
        },
        status: 'MAPPED',
      },
      {
        id: 'privacy-act-au',
        name: 'Privacy Act 1988 (with 2024 amendments)',
        type: 'regulatory',
        authority: 'Office of the Australian Information Commissioner',
        enforcementDate: '1988-12-21',
        penalty: 'Up to AUD $50M (2024 amendment)',
        status: 'PARTIAL',
      },
    ],
  },

  'india': {
    region: 'Asia-Pacific',
    jurisdiction: 'India',
    frameworks: [
      {
        id: 'dpdp',
        name: 'Digital Personal Data Protection Act 2023',
        type: 'regulatory',
        authority: 'Data Protection Board of India',
        enforcementDate: '2025-01-01',
        penalty: 'Up to ₹250 Crore (~$30M USD)',
        ecosMapping: {
          purposeLimitation: 'Task scope documented per request',
          dataMinimization:  'Inputs not retained beyond chain requirements',
          grievanceRedressal: 'Validator escalation path provides human review',
        },
        status: 'PARTIAL',
      },
      {
        id: 'meity-ai-advisory',
        name: 'MeitY AI Advisory (March 2024)',
        type: 'advisory',
        authority: 'Ministry of Electronics and Information Technology',
        enforcementDate: '2024-03-01',
        ecosMapping: {
          labelling:    'AI-generated flag + confidence score on every output',
          transparency: 'Audit chain export; GET /api/v1/audit/dag',
        },
        status: 'MAPPED',
      },
    ],
  },

  'israel': {
    region: 'Middle East',
    jurisdiction: 'Israel',
    frameworks: [
      {
        id: 'pppa-il',
        name: 'Protection of Privacy Law 5741-1981 + AI guidelines',
        type: 'regulatory',
        authority: 'Privacy Protection Authority',
        enforcementDate: '1981-01-01',
        ecosMapping: {
          dataSubjectRights: 'Per-account audit exports on request',
          auditability:      'SHA-256 chain; immutable record',
        },
        status: 'PARTIAL',
      },
      {
        id: 'innovation-authority',
        name: 'Israel Innovation Authority AI Incentives',
        type: 'incentive',
        authority: 'Israel Innovation Authority',
        note: 'R&D grants available for qualifying AI companies; ECOS architecture is eligible',
        status: 'OPPORTUNITY',
      },
    ],
  },

  // ─── LATIN AMERICA ────────────────────────────────────────────────────────

  'brazil': {
    region: 'Latin America',
    jurisdiction: 'Brazil',
    frameworks: [
      {
        id: 'lgpd',
        name: 'Lei Geral de Proteção de Dados (LGPD)',
        type: 'regulatory',
        authority: 'ANPD (National Data Protection Authority)',
        enforcementDate: '2021-08-01',
        penalty: 'Up to 2% of Brazil revenue; max R$50M per infraction',
        ecosMapping: {
          legalBasis:        'Task consent documented per request',
          dataSubjectRights: 'Per-account audit exports',
          auditLog:          'SHA-256 chain satisfies Art. 37 (record-keeping)',
        },
        status: 'MAPPED',
      },
      {
        id: 'brazil-ai-bill',
        name: 'Brazilian AI Bill (PL 2338/2023)',
        type: 'proposed',
        authority: 'Brazilian Senate',
        enforcementDate: 'TBD',
        penalty: 'TBD',
        note: 'Strongly EU AI Act-inspired; ECOS\'s HITL + audit chain would map directly',
        status: 'MAPPED (pre-emptive)',
      },
    ],
  },

  'uae': {
    region: 'Middle East',
    jurisdiction: 'United Arab Emirates',
    frameworks: [
      {
        id: 'uae-ai-strategy',
        name: 'UAE National AI Strategy 2031',
        type: 'strategic',
        authority: 'UAE Office of AI',
        ecosMapping: {
          governance:     'Audit chain; confidence gate; HITL routing',
          accountability: 'SHA-256 proof; validator identity',
        },
        status: 'MAPPED',
      },
      {
        id: 'uae-pdpl',
        name: 'UAE Personal Data Protection Law',
        type: 'regulatory',
        authority: 'UAE Data Office',
        enforcementDate: '2022-01-02',
        status: 'PARTIAL',
      },
    ],
  },
};

/**
 * Get all frameworks for a jurisdiction/region filter.
 * @param {object} [opts]
 * @param {'North America'|'Europe'|'Asia-Pacific'|'Latin America'|'Middle East'|string} [opts.region]
 * @param {string} [opts.vertical] — filter to frameworks relevant to this vertical
 * @param {boolean} [opts.enforcedOnly] — only return regulatory (not voluntary/proposed)
 * @returns {object[]}
 */
function getFrameworks({ region, vertical, enforcedOnly = false } = {}) {
  const results = [];
  for (const [jurisdictionId, jurisdiction] of Object.entries(GLOBAL_COMPLIANCE_FRAMEWORKS)) {
    if (region && jurisdiction.region !== region) continue;
    for (const fw of jurisdiction.frameworks) {
      if (enforcedOnly && !['regulatory'].includes(fw.type)) continue;
      if (vertical && fw.relevantVerticals && !fw.relevantVerticals.includes('all') && !fw.relevantVerticals.includes(vertical)) continue;
      results.push({
        jurisdictionId,
        jurisdiction: jurisdiction.jurisdiction,
        region: jurisdiction.region,
        ...fw,
      });
    }
  }
  return results;
}

/**
 * Get compliance summary for a specific jurisdiction.
 */
function getJurisdiction(id) {
  return GLOBAL_COMPLIANCE_FRAMEWORKS[id] || null;
}

/**
 * Return applicable frameworks for a customer's stated jurisdictions + vertical.
 * @param {string[]} jurisdictions — e.g. ['us-federal', 'us-state', 'eu']
 * @param {string} vertical — e.g. 'insurance'
 */
function getApplicable(jurisdictions = [], vertical = '') {
  const result = {
    jurisdictions,
    vertical,
    frameworks: [],
    highPriority: [],  // regulatory + enforcement date within 12 months or passed
    opportunities: [],
  };

  const now = Date.now();
  for (const jId of jurisdictions) {
    const j = GLOBAL_COMPLIANCE_FRAMEWORKS[jId];
    if (!j) continue;
    for (const fw of j.frameworks) {
      if (vertical && fw.relevantVerticals && !fw.relevantVerticals.includes('all') && !fw.relevantVerticals.includes(vertical)) continue;
      const item = { jurisdictionId: jId, jurisdiction: j.jurisdiction, region: j.region, ...fw };
      result.frameworks.push(item);

      if (fw.type === 'regulatory') {
        const enforced = fw.enforcementDate ? new Date(fw.enforcementDate).getTime() : 0;
        const monthsUntil = (enforced - now) / (30 * 24 * 60 * 60 * 1000);
        if (enforced < now || monthsUntil < 12) result.highPriority.push(item);
      }
      if (fw.type === 'incentive') result.opportunities.push(item);
    }
  }

  return result;
}

/**
 * Summary stats for the /api/v1/compliance/global-map endpoint.
 */
function getSummaryStats() {
  let total = 0, regulatory = 0, voluntary = 0, proposed = 0, fullyMapped = 0;
  for (const j of Object.values(GLOBAL_COMPLIANCE_FRAMEWORKS)) {
    for (const fw of j.frameworks) {
      total++;
      if (fw.type === 'regulatory') regulatory++;
      if (fw.type === 'voluntary') voluntary++;
      if (fw.type === 'proposed') proposed++;
      if (fw.status && fw.status.startsWith('MAPPED')) fullyMapped++;
    }
  }
  return {
    jurisdictionsCovered: Object.keys(GLOBAL_COMPLIANCE_FRAMEWORKS).length,
    totalFrameworks: total,
    regulatory,
    voluntary,
    proposed,
    fullyMapped,
    regions: [...new Set(Object.values(GLOBAL_COMPLIANCE_FRAMEWORKS).map(j => j.region))],
  };
}

module.exports = {
  GLOBAL_COMPLIANCE_FRAMEWORKS,
  getFrameworks,
  getJurisdiction,
  getApplicable,
  getSummaryStats,
};
