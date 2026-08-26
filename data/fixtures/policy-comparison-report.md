# Policy Comparison Report

**Evaluation Harness Version**: Day 2.3  
**Dataset**: 5,000 transactions (1,868 failed transactions evaluated)  
**Synthetic Seed**: 42  

---

## 1. Three-Way Policy Comparison

| Policy | Count Recovery Rate | Revenue at Risk | Revenue Recovered | Revenue Recovery Rate | Total Reward |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Blind Retry** (Naive Baseline) | 46.95% | ₹44,95,901 | ₹21,18,953 | 47.13% | 877 pts |
| **Rule-Based Baseline** (Day 2.2) | 75.32% | ₹44,95,901 | ₹34,03,754 | 75.71% | 1,407 pts |
| **Theoretical Oracle** (Upper Bound) | 85.17% | ₹44,95,901 | ₹38,38,708 | 85.38% | 1,591 pts |

---

## 2. Rule-Based Baseline Uplift over Naive Blind Retry

- **Count Recovery Rate Uplift**: +28.37 percentage points (+530 recovered transactions)
- **Revenue Recovery Rate Uplift**: +28.58 percentage points (+₹12,84,801 recovered revenue)
- **Total Evaluation Reward Uplift**: +530 pts

---

## 3. Key Observations & Takeaways

1. **Naivety of Blind Retry**: Blind retry blindly applies `retry_now` (attempts 1-2) or `retry_later` (attempts 3-4) without considering failure reason or subscription state. It achieves a revenue recovery rate of 47.13% (₹21,18,953).
2. **Domain-Knowledge Uplift**: Incorporating basic failure reason and subscription rules in the **Rule-Based Baseline** increases revenue recovery rate from 47.13% to 75.71%, generating an additional **+₹12,84,801** (+28.58 percentage points) in recovered revenue.
3. **Remaining Opportunity to Oracle**: The theoretical oracle reaches 85.38% revenue recovery (₹38,38,708), leaving a **+₹4,34,954** (+9.67 percentage points) gap for future machine learning and AI agent optimization.
