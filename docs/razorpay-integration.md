# Razorpay Payment Provider Execution Integration Architecture

**Version**: Day 6  
**Scope**: Payment Provider Adapter, Capability Mapping, & Executor Abstraction  
**Principle**: *"AI proposes, Policy Engine disposes, Payment Provider executes."*

---

## 1. Executive Summary & Honest Capability Framing

Razorpay is a **Gateway Payment Rail**, NOT an automated recovery or policy engine.

- **AI Policy Agent (LLM)**: Analyzes failure context and proposes an optimal recovery intervention (`retry_now`, `retry_later`, `send_reminder`, `request_payment_method_update`, `escalate`).
- **Deterministic Policy Engine**: Enforces non-negotiable safety guardrails (canceling canceled subscriptions, blocking retries at attempt depth $\ge 4$, forcing payment method update for expired cards).
- **Razorpay Execution Adapter**: Accepts ONLY the final governed action and translates it into valid HTTP requests against Razorpay's API.

### Honest Provider Capability Assessment

Razorpay exposes **ONE single relevant capability** for one-time payment recovery: **Payment Links (`POST /v1/payment_links`)**.

Our adapter reuses this single Payment Link capability to realize three of our five `RecoveryAction` values (`retry_now`, `send_reminder`, `request_payment_method_update`) by varying application parameters (such as `notify` flags). Razorpay does **NOT** have three distinct, native recovery features built into its API.

```
                    Recovery Orchestrator (lib/recovery-orchestrator.ts)
                             ↓
                    RecoveryExecutor (Interface)
                        ↙          ↘
         SimulatorRecoveryExecutor   RazorpayRecoveryExecutor
       (Benchmark / Offline Tests)    (Test-Mode API / Demo)
```

---

## 2. RecoveryAction → Razorpay Capability Mapping Matrix

| RecoveryAction | Execution Reality | Razorpay API Endpoint & Method | Exact Documentation Citation & Live Verification |
| :--- | :--- | :--- | :--- |
| `retry_now` | **Payment Link Creation (Immediate Notify)** | `POST /v1/payment_links` | Generates a Payment Link with `notify: { sms: true, email: true }` for immediate customer dispatch.<br>*Source*: [Razorpay Payment Links API](https://razorpay.com/docs/api/payments/payment-links/)<br>*Quote*: *"include the notify object in your JSON payload, setting sms and email to true"* |
| `retry_later` | **100% Application-Level Scheduling** | `POST /v1/payment_links` | **Razorpay has ZERO native awareness of "later" for one-time payments.** Scheduled timing is 100% managed by the application's queue/cron layer. When triggered, generates a Payment Link with `notify: { sms: false, email: false }`. |
| `send_reminder` | **Payment Link Notification Resend** | `POST /v1/payment_links/{id}/notify_by/{medium}` | Resends notification for an existing Payment Link, or creates a new link with notification flags enabled.<br>*Source*: [Razorpay Payment Links Resend API](https://razorpay.com/docs/api/payments/payment-links/)<br>*Quote*: *"use the POST endpoint: /v1/payment_links/{id}/notify_by/{medium}"* |
| `request_payment_method_update` | **Payment Link Creation (Instrument Selection)** | `POST /v1/payment_links` | Generates a Payment Link. The customer chooses their new payment method (UPI, card, netbanking) on checkout.<br>*Source*: [Razorpay Payment Links API](https://razorpay.com/docs/api/payments/payment-links/) |
| `escalate` | **Unsupported (100% Application-Level)** | *N/A (None)* | **Razorpay API has no endpoint for customer escalation or manual agent intervention.** Handled 100% internally by the application layer. |

---

## 3. Test-Mode Credentials & Environment Configuration

Razorpay does **NOT** use a separate sandbox domain. Test mode uses the **SAME** base URL (`https://api.razorpay.com/v1`) with test-mode credentials (`key_id` starting with `rzp_test_`).

### Environment Variables (`.env.example`)

```env
# Razorpay Test-Mode Credentials
RAZORPAY_KEY_ID=rzp_test_your_key_id_here
RAZORPAY_KEY_SECRET=your_test_secret_here
```

### Safety & Opt-In Rules

1. **Credential Presence != Execution Opt-In**: The presence of `RAZORPAY_KEY_ID` in `.env` will **NEVER** automatically route execution to Razorpay.
2. **Explicit Opt-In Required**: To use the Razorpay executor, callers must explicitly pass `{ executionMode: 'razorpay' }` or inject a `RazorpayRecoveryExecutor` instance.
3. **Secret Leak Guard**: `sanitizeSecrets()` automatically redacts `RAZORPAY_KEY_SECRET` and `RAZORPAY_KEY_ID` from all status messages, error logs, and stack traces.

---

## 4. Why the Simulator Remains the Benchmark Source of Truth

Razorpay's Test-Mode API returns a `created` status for Payment Links. It does not provide stochastic, reproducible probability distributions for offline RL and policy evaluation.

Therefore:
- **Offline Benchmarks (Days 1–5)**: Driven exclusively by `SimulatorRecoveryExecutor` and `RecoveryEnvironment`.
- **Live Demo / MVP Integration (Day 6)**: Plugs in `RazorpayRecoveryExecutor` without altering benchmark evaluation logic.

---

## 5. Known Limitations & Idempotency Note

- **Idempotency / Duplicate Call Gap**: For this MVP, rapid repeated calls for the same `transaction_id` against the Razorpay adapter will create distinct Payment Links. Production deployments should attach an `X-Razorpay-Idempotency-Key` or store generated `payment_link_id`s in a local database.
