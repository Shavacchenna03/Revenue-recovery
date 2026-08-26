# Heuristic Baseline Policy Decision Table

**Evaluation Precedence**: First-Match-Wins (Evaluated from top to bottom, Rule 1 to Rule 16)

| Precedence | Rule ID | Rule Name | Resulting Action | Description |
| :---: | :--- | :--- | :--- | :--- |
| **1** | `rule-1-canceled-subscription` | **Canceled Subscription** | `escalate` | Canceled subscription indicates a contract/churn issue requiring immediate manual escalation. |
| **2** | `rule-2-card-expired` | **Card Expired** | `request_payment_method_update` | Expired payment card cannot succeed on retry; requires customer to update payment details. |
| **3** | `rule-3a-auth-failed-repeated` | **Repeated Authentication Failure** | `escalate` | Repeated 3DS/OTP authentication failures (attempt >= 4) suggest account issue requiring escalation. |
| **4** | `rule-3b-auth-failed` | **Authentication Failed** | `request_payment_method_update` | Initial authentication failure warrants requesting updated payment method or re-authentication. |
| **5** | `rule-4-delinquent-payment-struggle` | **Delinquent Subscription Payment Instrument Failure** | `request_payment_method_update` | Insufficient funds or auth failure on past_due/unpaid subscription requires new payment method. |
| **6** | `rule-5-delinquent-subscription-reminder` | **Delinquent Subscription Reminder** | `send_reminder` | Past due or unpaid subscription with other failure reasons requires a payment reminder. |
| **7** | `rule-6a-insufficient-funds-early` | **Insufficient Funds (Early Attempts)** | `retry_later` | Insufficient funds on attempt 1 or 2 warrants delayed retry for account replenishment. |
| **8** | `rule-6b-insufficient-funds-exhausted` | **Insufficient Funds (Exhausted Attempts)** | `escalate` | Persistent insufficient funds after attempt 2 requires human escalation. |
| **9** | `rule-7a-network-timeout-early` | **Network Timeout (Early Attempts)** | `retry_now` | Transient network timeout on attempt 1 or 2 warrants immediate retry. |
| **10** | `rule-7b-network-timeout-late` | **Network Timeout (Late Attempts)** | `retry_later` | Repeated network timeout (attempt 3 or 4) warrants delayed retry before escalation. |
| **11** | `rule-8a-bank-server-down-early` | **Bank Server Down (Early Attempts)** | `retry_later` | Bank server downtime on attempt 1-3 warrants delayed retry for server recovery. |
| **12** | `rule-8b-bank-server-down-exhausted` | **Bank Server Down (Exhausted Attempts)** | `escalate` | Persistent bank server failure after attempt 3 requires escalation. |
| **13** | `rule-9a-technical-error-early` | **Technical Error (Early Attempts)** | `retry_now` | Technical gateway error on attempt 1 or 2 warrants immediate retry. |
| **14** | `rule-9b-technical-error-exhausted` | **Technical Error (Exhausted Attempts)** | `escalate` | Persistent technical error after attempt 2 requires escalation. |
| **15** | `rule-10-high-value-tiebreaker` | **High-Value Ambiguous Tie-Breaker** | `escalate` | Ambiguous failure on high-value transaction (amount >= ₹5,000) warrants manual escalation. |
| **16** | `rule-11-default-fallback` | **Default Fallback** | `retry_later` | Default baseline action for ambiguous failed transactions. |
