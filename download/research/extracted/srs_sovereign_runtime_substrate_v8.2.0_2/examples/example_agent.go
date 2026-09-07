// example_agent.go — Go example AI agent using the SRS SDK.
//
// Usage:
//   go run examples/example_agent.go
package main

import (
	"fmt"
	"os"

	srs "srs/api"
)

func main() {
	fmt.Println(strings.Repeat("=", 78))
	fmt.Println("SRS Example Agent (Go) — Full lifecycle")
	fmt.Println(strings.Repeat("=", 78))

	baseURL := os.Getenv("SRS_API_URL")
	if baseURL == "" {
		baseURL = "http://localhost:8000"
	}
	apiKey := os.Getenv("SRS_API_KEY")
	if apiKey == "" {
		fmt.Println("\nError: SRS_API_KEY environment variable not set")
		fmt.Println("Set it to your SRS API key, e.g.:")
		fmt.Println("  export SRS_API_KEY='your-api-key-here'")
		os.Exit(1)
	}

	client := srs.NewSRSCClient(baseURL, apiKey)

	// 1. Health check
	health, err := client.Health()
	if err != nil {
		fmt.Printf("\n1. Health check failed: %v\n", err)
		fmt.Println("   Make sure the SRS API server is running.")
		os.Exit(1)
	}
	fmt.Printf("\n1. Health: %s v%s\n", health.Status, health.Version)

	// 2. Submit a mutation
	fmt.Println("\n2. Submitting mutation...")
	result, err := client.SubmitMutation(&srs.MutationRequest{
		MutationID:    "go-example-mut-001",
		Description:   "Go agent: FPGA rebalance",
		RiskClass:     "low",
		Z3WitnessHash: "sha256:go-example",
		EvidenceChain: map[string]interface{}{
			"admissible":            true,
			"seq":                   1,
			"sqa_certificate_ref":   "quorum:self#bls_evidence_binding",
			"z3_witness_hash":       "sha256:go-example",
		},
		Validators: []map[string]interface{}{
			{"validator_id": "v1", "validator_type": "FORMAL", "admit": true, "assurance": 0.95},
			{"validator_id": "v2", "validator_type": "EMPIRICAL", "admit": true, "assurance": 0.88},
			{"validator_id": "v3", "validator_type": "HEURISTIC", "admit": true, "assurance": 0.81},
		},
		Seq: 1,
	})
	if err != nil {
		fmt.Printf("   Error: %v\n", err)
	} else {
		fmt.Printf("   Admissible: %v\n", result.Admissible)
		fmt.Printf("   Reason: %s\n", result.Reason)
	}

	// 3. Verify audit
	fmt.Println("\n3. Audit verification:")
	verify, err := client.VerifyAudit()
	if err != nil {
		fmt.Printf("   Error: %v\n", err)
	} else {
		fmt.Printf("   Valid: %v, Events: %d\n", verify.Valid, verify.EventCount)
	}

	fmt.Printf("\n%s\n", strings.Repeat("=", 78))
	fmt.Println("Go example agent completed!")
	fmt.Printf("%s\n", strings.Repeat("=", 78))
}

// Need strings import
import "strings"
