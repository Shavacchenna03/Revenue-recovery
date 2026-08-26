# Synthetic Payment Dataset Validation Report

**Dataset Size**: 5,000 transactions  
**Generated At**: 2026-08-26T07:23:12.267Z  
**Seed**: 42  

---

## 1. Executive Summary & Transaction Mix

| Metric | Count | Percentage | Target Band | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Total Transactions** | 5,000 | 100.0% | 5,000 | ✅ Pass |
| **Successful Transactions** | 3,132 | 62.64% | ~64% (61%–67%) | ✅ Pass |
| **Failed / At-Risk Transactions** | 1,868 | 37.36% | ~36% (33%–39%) | ✅ Pass |

---

## 2. Conditional Learnability Analysis (Observable Factors vs Action Probabilities)

This section demonstrates that the recovery environment is **multi-feature conditionally structured**.

### A. Attempt Number Impact
- **Attempt 1**: `retry_now` = 0.5888, `retry_later` = 0.7553, `escalate` = 0.2444
- **Attempt 4**: `retry_now` = 0.2242, `retry_later` = 0.5404, `escalate` = 0.4999
- *Insight*: Attempt 4 shows sharp diminishing returns for retries (-0.35 logit drop) and a clear boost for escalation (+0.30 logit increase).

### B. Payment Method Impact
- **Card**: `request_payment_method_update` = 0.7646, `retry_now` = 0.4955
- **UPI**: `request_payment_method_update` = 0.4545, `retry_now` = 0.6145
- *Insight*: `request_payment_method_update` is significantly more effective for `card` than `upi`.

### C. Subscription Status Impact
- **Active**: `send_reminder` = 0.5485, `request_payment_method_update` = 0.5426
- **Past Due**: `send_reminder` = 0.6455, `request_payment_method_update` = 0.6124
- **Unpaid**: `send_reminder` = 0.6909, `request_payment_method_update` = 0.6966
- *Insight*: Reminders and payment method update requests become progressively more effective for delinquent subscriptions.

### D. Failure Reason Impact
- **`insufficient_funds`**: `retry_later` = 0.8746, `retry_now` = 0.2805
- **`card_expired`**: `request_payment_method_update` = 0.8915, `retry_now` = 0.1468
- **`network_timeout`**: `retry_now` = 0.794, `retry_later` = 0.8331

---

## 3. Failure Reason Distribution (Failed Transactions Only)

| Failure Reason | Count | Percentage | Target Weight |
| :--- | :--- | :--- | :--- |
| `network_timeout` | 361 | 19.33% | Target ~ weight |
| `insufficient_funds` | 452 | 24.2% | Target ~ weight |
| `authentication_failed` | 390 | 20.88% | Target ~ weight |
| `card_expired` | 302 | 16.17% | Target ~ weight |
| `technical_error` | 177 | 9.48% | Target ~ weight |
| `bank_server_down` | 186 | 9.96% | Target ~ weight |

---

## 4. Payment Method & Device Distributions

### Payment Methods
- **`upi`**: 2,282 (45.64%)
- **`wallet`**: 217 (4.34%)
- **`netbanking`**: 750 (15%)
- **`card`**: 1,751 (35.02%)

### Device Types
- **`mobile_ios`**: 1,210 (24.2%)
- **`mobile_android`**: 1,956 (39.12%)
- **`desktop_web`**: 1,017 (20.34%)
- **`mobile_web`**: 817 (16.34%)

### Attempt Numbers
- **Attempt 1**: 4,198 (83.96%)
- **Attempt 2**: 559 (11.18%)
- **Attempt 3**: 165 (3.3%)
- **Attempt 4**: 78 (1.56%)

---

## 5. Transaction Amount Statistics (INR)

- **Median**: ₹1,995
- **Mean**: ₹2,380
- **95th Percentile**: ₹5,220
- **Maximum**: ₹21,880

---

## 6. Hidden Action Probabilities (Evaluation Ground Truth)

| Recovery Action | Mean Prob | Std Dev | Min Prob | Max Prob | Target Mean | Target StdDev | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `retry_now` | 0.5566 | 0.2697 | 0.0063 | 0.9963 | [0.25, 0.75] | >= 0.12 | ✅ Pass |
| `retry_later` | 0.7419 | 0.2077 | 0.0287 | 0.9951 | [0.25, 0.75] | >= 0.12 | ✅ Pass |
| `send_reminder` | 0.572 | 0.222 | 0.0224 | 0.9877 | [0.25, 0.75] | >= 0.12 | ✅ Pass |
| `request_payment_method_update` | 0.5728 | 0.2696 | 0.0158 | 0.9989 | [0.25, 0.75] | >= 0.12 | ✅ Pass |
| `escalate` | 0.2575 | 0.1842 | 0.0064 | 0.9837 | [0.25, 0.75] | >= 0.12 | ✅ Pass |

---

## 7. Deliberately Messy Edge Cases

- **Category A (Good-looking customer, poor recovery environment)**: 96 transactions (Target: >= 90)
- **Category B (Risky-looking customer, good recovery environment)**: 173 transactions (Target: >= 90)

---

## 8. Leakage Verification & Correlation Matrix

Below is the Pearson correlation matrix between observable numerical features and hidden action probabilities.  
**Leakage Gate Criterion**: All $|r| < 0.60$.  
**Maximum Absolute Observed $|r|$**: **0.2948** (Passed).

| Observable Feature | `retry_now` | `retry_later` | `send_reminder` | `request_payment_method_update` | `escalate` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `amount` | -0.0071 | 0.0129 | -0.0236 | 0.0127 | 0.0569 |
| `attempt_number` | -0.2948 | -0.1738 | 0.0067 | 0.1156 | 0.2094 |
| `customer_tenure_months` | 0.0503 | 0.05 | 0.0783 | 0.0728 | 0.0674 |
| `previous_transactions_count` | 0.0231 | 0.0262 | 0.0599 | 0.0446 | 0.0394 |
| `previous_success_rate` | 0.0548 | 0.0244 | 0.0462 | 0.0277 | 0.0357 |
| `average_transaction_value` | -0.0052 | 0.0211 | -0.0273 | 0.0057 | 0.05 |
| `days_since_last_payment` | -0.0113 | -0.0252 | -0.0331 | -0.0101 | -0.0306 |
