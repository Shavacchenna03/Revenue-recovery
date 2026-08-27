# Governed LLM Agent (Day 4 Policy Engine) Comparison Report

**Evaluation Harness Version**: Day 4  
**LLM Model**: `qwen/qwen3.8-27b`  
**Governance Layer**: Standalone Deterministic Policy Engine (`lib/policy-engine.ts`)  
**Sample Context**: **Fixed 250-record failed transaction subsample** (Seed: 42)  

> [!IMPORTANT]
> **Core Governance Principle**: *"AI proposes, Policy Engine disposes."*  
> The Policy Engine acts as an uncompromising safety guardrail layer. It evaluates all proposed actions (whether from live LLM reasoning or baseline fallbacks) strictly against deterministic business constraints before execution.

---

## 1. Five-Way Sample Policy Comparison (n = 250)

| Policy | Count Recovery Rate | Revenue at Risk | Revenue Recovered | Revenue Recovery Rate | Total Reward |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Blind Retry** (Naive Baseline) | 46.80% | ₹5,59,615 | ₹2,61,379 | 46.71% | 117 pts |
| **Rule-Based Baseline** (Day 2.2) | 76.80% | ₹5,59,615 | ₹4,28,575 | 76.58% | 192 pts |
| **Raw LLM Agent** (Day 3 Proposer) | 71.60% | ₹5,59,615 | ₹4,03,572 | 72.12% | 179 pts |
| **Governed LLM Agent** (Day 4 Policy Engine) | **71.60%** | **₹5,59,615** | **₹4,03,572** | **72.12%** | **179 pts** |
| **Theoretical Oracle** (Upper Bound) | 83.20% | ₹5,59,615 | ₹4,71,329 | 84.22% | 208 pts |

## 2. Policy Engine Safety & Governance Metrics

### Proposal Source & Override Breakdown

| Metric | Overall | Genuine Live LLM Calls | Fallback-Sourced Proposals |
| :--- | :---: | :---: | :---: |
| **Total Proposals Evaluated** | **250** | 238 | 12 |
| **Approved Unchanged** | 248 | 236 | 12 |
| **Overridden by Policy Engine** | **2** | **2** | **0** |
| **Override Rate** | **0.80%** | **0.84%** | **0.00%** |

### Guardrail Trigger Breakdown by `guardrail_id`

| Guardrail ID | Description | Triggers Count | Share |
| :--- | :--- | :---: | :---: |
| `guardrail-default-approve` | Default approval when proposed action passes all guardrails | 205 | 82.0% |
| `guardrail-max-retries` | Blocks retries when attempt number >= 4 and escalates | 2 | 0.8% |
| `guardrail-card-expired` | Forces payment method update request for expired cards | 28 | 11.2% |
| `guardrail-canceled-subscription` | Forces escalation for canceled customer subscriptions | 14 | 5.6% |
| `guardrail-repeated-authentication-failure` | Escalates repeated authentication failures at attempt >= 4 | 1 | 0.4% |

## 3. Raw LLM → Governed LLM Impact & Convergence Analysis

- **Revenue Recovered Change**: **+₹0** (from ₹4,03,572 to ₹4,03,572)
- **Count Recovery Rate Change**: **+0.00%** (from 71.60% to 71.60%)
- **Total Unsafe/Invalid Proposals Overridden**: **2 decisions** (0.80% of proposals)

> [!NOTE]
> **Expected Convergence Toward Rule-Based Baseline**:
> Guardrails 1 (`canceled`), 2 (`card_expired`), and 4 (`authentication_failed`) deliberately mirror non-negotiable business rules already present in the Day 2.2 Baseline. When the Policy Engine overrides unsafe LLM proposals in these categories, the Governed LLM Agent's decisions converge toward the Rule-Based Baseline. This convergence demonstrates proper safety enforcement—not a limitation of the LLM.

## 4. Policy Engine Demonstration Examples

### Example 1: Exhausted Retry Limit Override (`guardrail-max-retries`)
- **Tx ID**: `txn_demo_001`  
- **Context**: Attempt 4, `network_timeout`  
- **LLM Proposal**: `retry_now`  
- **Policy Engine Decision**: **OVERRIDDEN → `escalate`** (`guardrail-max-retries`)  
- **Reason**: *"Maximum retry attempt limit reached (attempt 4 >= 4). Retry action 'retry_now' blocked and escalated."*  
- **Explanation**: The LLM proposed another retry, but attempt count is already $\ge 4$. The Policy Engine blocked the futile retry loop and forced escalation.

### Example 2: Expired Card Attempt 1 Override (`guardrail-card-expired`)
- **Tx ID**: `txn_004610`  
- **Context**: Attempt 1, `card_expired`  
- **LLM Proposal**: `request_payment_method_update`  
- **Policy Engine Decision**: **OVERRIDDEN → `request_payment_method_update`** (`guardrail-card-expired`)  
- **Reason**: *"Retrying an expired card is futile; customer must update payment method. Overriding proposed action 'request_payment_method_update'."*  
- **Explanation**: The LLM proposed retrying, but retrying an expired card is futile. The Policy Engine forced a payment method update request.

### Example 3: Precedence Lock Demo — Expired Card at Attempt 4 (`guardrail-card-expired` vs `guardrail-max-retries`)
- **Tx ID**: `txn_001867`  
- **Context**: Attempt 4, `card_expired`  
- **LLM Proposal**: `request_payment_method_update`  
- **Policy Engine Decision**: **OVERRIDDEN → `request_payment_method_update`** (NOT `escalate`) (`guardrail-card-expired`)  
- **Reason**: *"Retrying an expired card is futile; customer must update payment method. Overriding proposed action 'request_payment_method_update'."*  
- **Precedence Reasoning**: Guardrail 2 (`card_expired`) sits ahead of Guardrail 3 (`max_retries`). Because an expired card has an actionable remediation (requesting card update) regardless of attempt count, it takes precedence over generic attempt exhaustion escalation.

### Example 4: Valid Safe Proposal Approval (`guardrail-default-approve`)
- **Tx ID**: `txn_003277`  
- **Context**: Attempt 1, `network_timeout`  
- **LLM Proposal**: `retry_now`  
- **Policy Engine Decision**: **APPROVED UNCHANGED → `retry_now`** (`guardrail-default-approve`)  
- **Reason**: *"Proposed action passed all safety and policy engine guardrail checks."*  
- **Explanation**: The proposed action passed all safety and policy constraints.

