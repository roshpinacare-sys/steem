// SRS Go SDK — Auto-generated from OpenAPI 3.0 spec.
//
// Usage:
//   client := srs_sdk.NewSRSCClient("http://localhost:8000", "api-key")
//   result, err := client.SubmitMutation(req)
//   fmt.Println(result.Admissible)

package srs_sdk

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

// SRSCClient is the SRS REST API client.
type SRSCClient struct {
	BaseURL string
	APIKey  string
	Client  *http.Client
}

// NewSRSCClient creates a new SRS API client.
func NewSRSCClient(baseURL, apiKey string) *SRSCClient {
	return &SRSCClient{
		BaseURL: baseURL,
		APIKey:  apiKey,
		Client:  &http.Client{},
	}
}

// HealthResponse is the response from /v1/health.
type HealthResponse struct {
	Status        string `json:"status"`
	Version       string `json:"version"`
	TestsPassing  int    `json:"tests_passing"`
	Coverage      string `json:"coverage"`
}

// MutationResponse is the response from /v1/mutations.
type MutationResponse struct {
	MutationID   string  `json:"mutation_id"`
	Admissible   bool    `json:"admissible"`
	Reason       string  `json:"reason"`
	CertifiedAt  float64 `json:"certified_at"`
}

// MutationRequest is the request body for /v1/mutations.
type MutationRequest struct {
	MutationID      string                 `json:"mutation_id"`
	Description     string                 `json:"description"`
	RiskClass       string                 `json:"risk_class"`
	Z3WitnessHash   string                 `json:"z3_witness_hash"`
	EvidenceChain   map[string]interface{} `json:"evidence_chain"`
	Validators      []map[string]interface{} `json:"validators"`
	Seq             int                    `json:"seq"`
}

// AuditVerifyResponse is the response from /v1/audit/verify.
type AuditVerifyResponse struct {
	Valid      bool `json:"valid"`
	EventCount int  `json:"event_count"`
}

// Health checks the server health (no auth required).
func (c *SRSCClient) Health() (*HealthResponse, error) {
	var resp HealthResponse
	err := c.do("GET", "/v1/health", nil, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

// SubmitMutation submits a mutation for SEG evaluation.
func (c *SRSCClient) SubmitMutation(req *MutationRequest) (*MutationResponse, error) {
	var resp MutationResponse
	err := c.do("POST", "/v1/mutations", req, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

// VerifyAudit verifies the audit chain integrity.
func (c *SRSCClient) VerifyAudit() (*AuditVerifyResponse, error) {
	var resp AuditVerifyResponse
	err := c.do("GET", "/v1/audit/verify", nil, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

// do executes an HTTP request with JSON body.
func (c *SRSCClient) do(method, path string, body interface{}, out interface{}) error {
	var bodyReader io.Reader
	if body != nil {
		jsonBytes, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal error: %w", err)
		}
		bodyReader = bytes.NewReader(jsonBytes)
	}

	reqURL := c.BaseURL + path
	req, err := http.NewRequest(method, reqURL, bodyReader)
	if err != nil {
		return fmt.Errorf("request error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}

	resp, err := c.Client.Do(req)
	if err != nil {
		return fmt.Errorf("HTTP error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}

	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

// urlencode encodes query parameters.
func urlencode(params map[string]string) string {
	values := url.Values{}
	for k, v := range params {
		values.Set(k, v)
	}
	return values.Encode()
}
