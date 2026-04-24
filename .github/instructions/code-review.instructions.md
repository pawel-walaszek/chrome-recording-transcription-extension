# Code Review Instructions

Prioritize findings in this order:

1. Behavior regressions in Google Meet caption scraping, popup controls, background/offscreen messaging, recording, and downloads.
2. Chrome permission, privacy, or data-handling risks.
3. Build or packaging failures.
4. Missing test or smoke-test coverage for changed behavior.
5. Maintainability issues that make future changes harder.

Do not block on formatting-only comments unless the style issue makes the code harder to understand.

Report all actionable findings you can identify in the current review round. Do not intentionally drip-feed comments across multiple rounds. Later rounds should focus on newly introduced changes, unresolved findings, or issues that were not reasonably visible earlier.

For each actionable issue, include:

- the affected file or behavior,
- why it matters,
- a practical fix or verification step.
