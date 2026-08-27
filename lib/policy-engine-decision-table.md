# Policy Engine Guardrail Decision Table

**Version**: Day 4  
**Scope**: Deterministic Safety & Guardrail Layer  
**Principle**: *"AI proposes, Policy Engine disposes."*

The Policy Engine evaluates proposed `RecoveryAction` decisions against strict safety constraints before execution in the environment.

## Precedence Table

First matching guardrail wins.

| Priority | Guardrail ID | Condition | Proposed Action | Approved Action | Guardrail Purpose |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **1** | `guardrail-canceled-subscription` | `subscription_status === 'canceled'` | Any | `escalate` | Prevents automated recovery attempts on canceled customer accounts. |
| **2** | `guardrail-card-expired` | `failure_reason === 'card_expired'` | Any | `request_payment_method_update` | Retrying an expired card is deterministically futile; requires updated card details. Takes precedence over retry limits. |
| **3** | `guardrail-max-retries` | `attempt_number >= 4` AND (`proposedAction === 'retry_now'` \| `proposedAction === 'retry_later'`) | `retry_now`<br>`retry_later` | `escalate` | Prevents infinite retry loops after 4 failed attempts. |
| **4** | `guardrail-repeated-authentication-failure` | `failure_reason === 'authentication_failed'` AND `attempt_number >= 4` | Any | `escalate` | Escalates deep authentication failures regardless of proposed intervention. |
| **5** | `guardrail-default-approve` | No preceding guardrail matches | Any | Proposed action | Approves safe proposed interventions without modification (`overridden: false`). |
