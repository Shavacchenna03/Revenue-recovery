# Revenue Recovery Autopilot — HTTP API Reference

**Version**: Day 7 (Refined Execution Schema)  
**Base Path**: `/api`  
**Stack**: Node.js / TypeScript / Express / Zod  
**Principle**: *"AI proposes, Policy Engine disposes, API exposes."*

---

## 1. Overview & Architectural Principles

The Application API Layer provides an HTTP interface wrapping the Revenue Recovery Autopilot architecture. A future frontend dashboard (Day 8) will consume this API over HTTP rather than importing internal TypeScript modules directly.

### ⚠️ Critical Anti-Leakage Guarantee
HTTP response payloads **NEVER** expose hidden ground truth data. Fields such as `action_probabilities`, `noise_seed`, `true_failure_cause`, or raw `GroundTruthTransaction` objects are strictly stripped by DTO serialization functions ([`server/dto.ts`](file:///d:/revenue-recovery/server/dto.ts)).

### `executionMode` Contract & Opt-In Rules
- **Default Execution Mode**: `"simulator"` (for fixture transactions).
- **Razorpay Opt-In**: Requires an explicit request parameter `executionMode: "razorpay"`. Credential presence in `.env` **NEVER** automatically triggers Razorpay calls.

---

## 2. Refined Execution Result Schema

To prevent conflating "action attempted but failed" with "action not attempted because unsupported by provider", all recovery response DTOs use the refined `execution` schema:

```typescript
export interface ExecutionDTO {
  provider: 'simulator' | 'razorpay';
  attempted: boolean;          // false ONLY when the action has no provider operation
  success: boolean;            // true if attempted AND operation completed without error
  recovered?: boolean;         // present for simulator (synchronous outcome); undefined for razorpay
  revenue_recovered?: number;  // present when recovered is true
  message: string;
  reference_id?: string;
  unsupported_action?: boolean;
}
```

### Distinction Between Execution Modes
- **Razorpay Mode**: `success: true` means *"A Payment Link was created successfully without error,"* **NOT** *"the customer has paid."* Actual recovery happens asynchronously. If an action is unsupported (e.g. `escalate`), `attempted: false`, `success: false`, and `unsupported_action: true`.
- **Simulator Mode**: `success: true` means *"Simulated recovery succeeded synchronously."* Because the simulator samples synthetic outcomes, `success` equals `recovered`. `attempted` is `true` for all actions sampled by the synthetic environment.

---

## 3. Endpoint Specifications

### `GET /api/health`
Health check endpoint for monitoring API server status.

- **Request**: `GET /api/health`
- **Response**: `200 OK`
```json
{
  "status": "ok",
  "timestamp": "2026-09-01T10:00:00.000Z"
}
```

---

### `GET /api/transactions`
Retrieves a paginated list of failed/at-risk transactions for UI browsing (observable fields only).

- **Request**: `GET /api/transactions?limit=20&offset=0&failure_reason=card_expired`
- **Query Parameters**:
  - `limit` (number, 1-100, default 20)
  - `offset` (number, >=0, default 0)
  - `failure_reason` (string, optional)
  - `payment_method` (string, optional)
  - `subscription_status` (string, optional)
- **Response**: `200 OK`
```json
{
  "items": [
    {
      "transaction_id": "txn_000030",
      "customer_id": "cust_000030",
      "amount": 2525,
      "currency": "INR",
      "timestamp": "2026-08-01T10:00:00.000Z",
      "payment_method": "card",
      "payment_status": "failed",
      "failure_reason": "card_expired",
      "attempt_number": 1,
      "customer_tenure_months": 12,
      "previous_transactions_count": 8,
      "previous_success_rate": 0.88,
      "average_transaction_value": 2500,
      "days_since_last_payment": 15,
      "subscription_status": "active",
      "device_type": "desktop_chrome",
      "checkout_completed": true
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

---

### `GET /api/transactions/:id`
Retrieves observable details for a single transaction by ID.

- **Request**: `GET /api/transactions/txn_000006`
- **Response**: `200 OK` (Observable transaction DTO)
- **Error Response**: `404 Not Found` if ID does not exist.

---

### `POST /api/recovery/analyze`
Executes end-to-end recovery analysis (LLM Diagnosis → Deterministic Policy Engine Governance → Executor Dispatch).

---

## 4. Example Request & Response Scenarios

### Scenario 1: Normal Approved Recovery Case (Simulator Mode)
- **Request**: `POST /api/recovery/analyze`
```json
{
  "transaction_id": "txn_000006",
  "executionMode": "simulator"
}
```
- **Response**: `200 OK`
```json
{
  "transaction_id": "txn_000006",
  "observable_summary": {
    "amount": 748,
    "currency": "INR",
    "failure_reason": "network_timeout",
    "attempt_number": 1,
    "payment_method": "upi",
    "subscription_status": "active"
  },
  "llm_diagnosis": "The payment failed due to a transient network timeout on attempt 1.",
  "llm_confidence": 0.95,
  "proposed_action": "retry_now",
  "policy_engine": {
    "decision": "approved",
    "guardrail_id": "guardrail-default-approve",
    "reason": "Default approval: No restrictive guardrail condition was triggered."
  },
  "final_action": "retry_now",
  "execution": {
    "provider": "simulator",
    "attempted": true,
    "success": true,
    "recovered": true,
    "revenue_recovered": 748,
    "message": "Simulated recovery succeeded for transaction txn_000006."
  },
  "used_llm_fallback": false
}
```

---

### Scenario 2: Overridden Policy Case (Simulator Mode)
- **Request**: `POST /api/recovery/analyze`
```json
{
  "transaction_id": "txn_000026",
  "executionMode": "simulator"
}
```
- **Response**: `200 OK`
```json
{
  "transaction_id": "txn_000026",
  "observable_summary": {
    "amount": 920,
    "currency": "INR",
    "failure_reason": "network_timeout",
    "attempt_number": 4,
    "payment_method": "upi",
    "subscription_status": "active"
  },
  "llm_diagnosis": "Payment failed due to network timeout on attempt 4.",
  "llm_confidence": 0.85,
  "proposed_action": "retry_now",
  "policy_engine": {
    "decision": "overridden",
    "guardrail_id": "guardrail-max-retries",
    "reason": "Maximum retry attempt limit reached (attempt 4 >= 4). Retry action 'retry_now' blocked and escalated."
  },
  "final_action": "escalate",
  "execution": {
    "provider": "simulator",
    "attempted": true,
    "success": false,
    "recovered": false,
    "revenue_recovered": 0,
    "message": "Simulated recovery failed for transaction txn_000026."
  },
  "used_llm_fallback": false
}
```

---

### Scenario 3: Unsupported Action Case (Razorpay Mode)
- **Request**: `POST /api/recovery/analyze`
```json
{
  "transaction_id": "txn_000026",
  "executionMode": "razorpay"
}
```
- **Response**: `200 OK` *(Note: Domain outcome `attempted: false`, `success: false`, `unsupported_action: true`, NOT HTTP 4xx/5xx error)*
```json
{
  "transaction_id": "txn_000026",
  "observable_summary": {
    "amount": 920,
    "currency": "INR",
    "failure_reason": "network_timeout",
    "attempt_number": 4,
    "payment_method": "upi",
    "subscription_status": "active"
  },
  "llm_diagnosis": "Payment failed due to network timeout on attempt 4.",
  "llm_confidence": 0.85,
  "proposed_action": "retry_now",
  "policy_engine": {
    "decision": "overridden",
    "guardrail_id": "guardrail-max-retries",
    "reason": "Maximum retry attempt limit reached (attempt 4 >= 4). Retry action 'retry_now' blocked and escalated."
  },
  "final_action": "escalate",
  "execution": {
    "provider": "razorpay",
    "attempted": false,
    "success": false,
    "unsupported_action": true,
    "message": "Application-level action — no direct Razorpay API operation exists for escalate."
  },
  "used_llm_fallback": false
}
```

---

### Scenario 4: Transaction Not Found (`404`)
- **Request**: `GET /api/transactions/txn_unknown_999`
- **Response**: `404 Not Found`
```json
{
  "error": {
    "code": "TRANSACTION_NOT_FOUND",
    "message": "Transaction with ID 'txn_unknown_999' was not found."
  }
}
```

---

### Scenario 5: Validation Error (`400`)
- **Request**: `POST /api/recovery/analyze`
```json
{
  "invalid_key": "malformed_request"
}
```
- **Response**: `400 Bad Request`
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request payload format",
    "details": {
      "transaction_id": {
        "_errors": [
          "Must provide either transaction_id or transaction object."
        ]
      }
    }
  }
}
```

---

## 5. Rate Control & Security

- **Rate Limiter**: Default window of 60 seconds, max 60 requests per IP (`HTTP 429 RATE_LIMITED`).
- **Secret Sanitization**: All error messages and logs pass through `sanitizeSecrets()` to redact API keys (`RAZORPAY_KEY_SECRET`, `RAZORPAY_KEY_ID`).
- **Auth Out of Scope**: Authentication is omitted for this hackathon MVP.
