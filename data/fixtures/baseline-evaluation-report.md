# Baseline Policy Evaluation Report

**Evaluation Harness Version**: Day 2.3  
**Evaluation Mode**: Agent-Safe Heuristic Baseline vs. Theoretical Upper-Bound Oracle  

---

## 1. Dataset Summary

- **Total Dataset Size**: 5,000 transactions
- **Synthetic Seed**: 42
- **Failed Transactions Evaluated**: 1,868
- **Successful Transactions Skipped**: 3,132

## 2. Overall Performance

| Metric | Heuristic Baseline | Theoretical Oracle | Gap / Opportunity |
| :--- | :--- | :--- | :--- |
| **Count-based Recovery Rate** | 75.32% | 85.17% | +9.85% |
| **Revenue at Risk** | ₹44,95,901 | ₹44,95,901 | — |
| **Revenue Recovered** | ₹34,03,754 | ₹38,38,708 | +₹4,34,954 |
| **Revenue Recovery Rate** | 75.71% | 85.38% | +9.67% |
| **Total Evaluation Reward** | 1,407 pts | 1,591 pts | +184 pts |
| **Average Reward per Failed Tx** | 0.7532 pts | 0.8517 pts | +0.0985 pts |

## 3. Action Distribution

### Recovery Action Selections

| Category | Evaluated (n) | Recovered | Count Recovery Rate | Revenue at Risk | Revenue Recovered | Revenue Recovery Rate | Sample Note |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `retry_now` | 346 | 266 | 76.88% | ₹8,46,729 | ₹6,58,012 | 77.71% | ✅ Normal |
| `retry_later` | 422 | 379 | 89.81% | ₹10,20,830 | ₹9,21,754 | 90.29% | ✅ Normal |
| `send_reminder` | 177 | 88 | 49.72% | ₹4,07,684 | ₹1,86,076 | 45.64% | ✅ Normal |
| `request_payment_method_update` | 746 | 609 | 81.64% | ₹18,13,720 | ₹14,88,163 | 82.05% | ✅ Normal |
| `escalate` | 177 | 65 | 36.72% | ₹4,06,938 | ₹1,49,749 | 36.80% | ✅ Normal |

## 4. Recovery by Failure Reason

### Failure Reason Breakdown

| Category | Evaluated (n) | Recovered | Count Recovery Rate | Revenue at Risk | Revenue Recovered | Revenue Recovery Rate | Sample Note |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `network_timeout` | 361 | 254 | 70.36% | ₹8,78,930 | ₹6,09,024 | 69.29% | ✅ Normal |
| `insufficient_funds` | 452 | 340 | 75.22% | ₹11,04,319 | ₹8,39,822 | 76.05% | ✅ Normal |
| `authentication_failed` | 390 | 302 | 77.44% | ₹8,88,033 | ₹6,86,336 | 77.29% | ✅ Normal |
| `card_expired` | 302 | 255 | 84.44% | ₹7,81,553 | ₹6,65,789 | 85.19% | ✅ Normal |
| `technical_error` | 177 | 111 | 62.71% | ₹4,08,739 | ₹2,64,916 | 64.81% | ✅ Normal |
| `bank_server_down` | 186 | 145 | 77.96% | ₹4,34,327 | ₹3,37,867 | 77.79% | ✅ Normal |

## 5. Recovery by Attempt Number

### Attempt Number Breakdown

| Category | Evaluated (n) | Recovered | Count Recovery Rate | Revenue at Risk | Revenue Recovered | Revenue Recovery Rate | Sample Note |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `1` | 1,209 | 939 | 77.67% | ₹29,28,059 | ₹22,80,772 | 77.89% | ✅ Normal |
| `2` | 416 | 318 | 76.44% | ₹10,18,283 | ₹7,89,196 | 77.50% | ✅ Normal |
| `3` | 165 | 104 | 63.03% | ₹3,66,640 | ₹2,25,577 | 61.53% | ✅ Normal |
| `4` | 78 | 46 | 58.97% | ₹1,82,919 | ₹1,08,209 | 59.16% | ✅ Normal |

## 6. Recovery by Payment Method

### Payment Method Breakdown

| Category | Evaluated (n) | Recovered | Count Recovery Rate | Revenue at Risk | Revenue Recovered | Revenue Recovery Rate | Sample Note |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `upi` | 843 | 615 | 72.95% | ₹20,11,683 | ₹14,64,057 | 72.78% | ✅ Normal |
| `card` | 657 | 521 | 79.30% | ₹16,35,100 | ₹13,09,289 | 80.07% | ✅ Normal |
| `wallet` | 87 | 66 | 75.86% | ₹2,12,830 | ₹1,62,481 | 76.34% | ✅ Normal |
| `netbanking` | 281 | 205 | 72.95% | ₹6,36,288 | ₹4,67,927 | 73.54% | ✅ Normal |

## 7. Recovery by Subscription Status

### Subscription Status Breakdown

| Category | Evaluated (n) | Recovered | Count Recovery Rate | Revenue at Risk | Revenue Recovered | Revenue Recovery Rate | Sample Note |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `active` | 1,305 | 1,063 | 81.46% | ₹31,59,351 | ₹25,91,485 | 82.03% | ✅ Normal |
| `unpaid` | 196 | 146 | 74.49% | ₹4,49,770 | ₹3,29,472 | 73.25% | ✅ Normal |
| `canceled` | 99 | 30 | 30.30% | ₹2,26,970 | ₹69,966 | 30.83% | ✅ Normal |
| `past_due` | 268 | 168 | 62.69% | ₹6,59,810 | ₹4,12,831 | 62.57% | ✅ Normal |

## 8. Theoretical Oracle Benchmark Summary

- **Oracle Count Recovery Rate**: 85.17%
- **Oracle Revenue Recovery Rate**: 85.38%
- **Oracle Total Reward**: 1,591 pts
- **Baseline-to-Oracle Performance Gap**: +9.85% (+₹4,34,954)

## 9. Interpretation & Statistical Observations

1. **Baseline vs. Oracle Gap**: The heuristic baseline achieves a revenue recovery rate of 75.71% (₹34,03,754), leaving an uncaptured recovery potential of +₹4,34,954 (+9.67%) compared to the theoretical oracle.
2. **Low Sample Size Categories ($n < 30$)**: None. All evaluated categories meet the $n \ge 30$ threshold for statistical reliability.
3. **Count vs. Revenue Divergence (> 5 percentage points)**: None observed. Count-based recovery rates align closely with revenue recovery rates across all main categories.
