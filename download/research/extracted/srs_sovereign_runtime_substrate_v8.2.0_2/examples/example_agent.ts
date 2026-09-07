/**
 * example_agent.ts — TypeScript example AI agent using the SRS SDK.
 *
 * Demonstrates: authenticate → submit mutation → query audit → verify.
 *
 * Usage:
 *   // Start SRS API server first, then:
 *   npx ts-node examples/example_agent.ts
 *   // Or compile + run:
 *   tsc api/srs_sdk.ts examples/example_agent.ts && node examples/example_agent.js
 */

import { SRSCClient } from '../api/srs_sdk';

async function main(): Promise<void> {
    console.log('='.repeat(78));
    console.log('SRS Example Agent (TypeScript) — Full lifecycle');
    console.log('='.repeat(78));

    const baseUrl = process.env.SRS_API_URL || 'http://localhost:8000';
    // In production, the API key would be from your identity provider
    const apiKey = process.env.SRS_API_KEY || 'your-api-key-here';

    const client = new SRSCClient(baseUrl, apiKey);

    // 1. Health check
    try {
        const health = await client.health();
        console.log(`\n1. Health: ${health.status} v${health.version}`);
        console.log(`   Tests: ${health.tests_passing}, Coverage: ${health.coverage}`);
    } catch (e) {
        console.log(`\n1. Health check failed: ${e}`);
        console.log('   Make sure the SRS API server is running.');
        return;
    }

    // 2. Submit a mutation
    console.log('\n2. Submitting mutation...');
    try {
        const result = await client.submitMutation({
            mutation_id: 'ts-example-mut-001',
            description: 'TypeScript agent: FPGA rebalance',
            risk_class: 'low',
            z3_witness_hash: 'sha256:ts-example',
            evidence_chain: {
                admissible: true,
                seq: 1,
                sqa_certificate_ref: 'quorum:self#bls_evidence_binding',
                z3_witness_hash: 'sha256:ts-example',
            },
            validators: [
                { validator_id: 'v1', validator_type: 'FORMAL', admit: true, assurance: 0.95 },
                { validator_id: 'v2', validator_type: 'EMPIRICAL', admit: true, assurance: 0.88 },
                { validator_id: 'v3', validator_type: 'HEURISTIC', admit: true, assurance: 0.81 },
            ],
            seq: 1,
        });
        console.log(`   Admissible: ${result.admissible}`);
        console.log(`   Reason: ${result.reason}`);
    } catch (e) {
        console.log(`   Error: ${e}`);
    }

    // 3. Query audit trail
    console.log('\n3. Audit trail:');
    try {
        const audit = await client.queryAudit({});
        console.log(`   Events: ${audit.count}`);
        for (const e of audit.events.slice(-3)) {
            console.log(`   - ${e.action} → ${e.resource} (${e.outcome})`);
        }
    } catch (e) {
        console.log(`   Error: ${e}`);
    }

    // 4. Verify audit chain
    console.log('\n4. Audit verification:');
    try {
        const verify = await client.verifyAudit();
        console.log(`   Valid: ${verify.valid}, Events: ${verify.event_count}`);
    } catch (e) {
        console.log(`   Error: ${e}`);
    }

    console.log(`\n${'='.repeat(78)}`);
    console.log('TypeScript example agent completed!');
    console.log('='.repeat(78));
}

main().catch(console.error);
