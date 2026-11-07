# Field testing and rollout

All targets below are proposed starting points, not findings. No benchmark exists for this kind of capture. Recalibrate them from a baseline pilot, and judge by physical audit against independently recorded ground truth.

## Targets for "capture one network asset"

| Metric | First unaided attempt after training | After one week |
|---|---|---|
| Completion without "show me how" | ≥70% | ≥90% |
| Median time per asset, excluding walking | <3 min | <90 s |
| Taps, common case | ≤8 | ≤8 |
| Record-level error by physical audit | ≤10% | ≤5% |
| Critical error (wrong type, or location beyond tolerance) | ≤3% | ≤1% |
| Usable audit photo | ≥90% | ≥95% |
| Lost data | 0 | 0 |
| Completion gap, lowest to highest literacy group | ≤15 points | ≤10 points |

Any critical-error pattern or lost-data event blocks release, regardless of averages. Fix any problem seen in three or more participants before the next round.

## How to run a round

- **People:** 12–16 workers mixed by state and literacy (use a private read-aloud screen). Include women if crews do. Pay at least a casual day's wage.
- **Place:** real streets at midday, with a dead-zone segment and noise.
- **Moderator:** same language, not presented as the builder. In 450 Bangalore interviews people were about 2.5 times more likely to favor what they believed the interviewer built, about 5 times with a foreign interviewer using a translator.
- **Tasks:** given by voice or picture card against a physical target, framed as stories ("a friend needs..."):
  1. Add a tagged pole
  2. Add an untagged box
  3. Record a cable run
  4. Find an asset
  5. Walk to a target
  6. Undo a mistake
  7. Recover from no GPS
  8. Sync
- **Scoring:** log prompts at levels 0–3. Needing "show me how" counts as failure. Compare against the current process, whether paper or WhatsApp photos.
- **Understanding:** ask people to explain "Saved on phone" in their own words. Do not use SUS; no validated Kannada or Telugu version was found.
- **Reporting:** give counts with intervals. 10 of 12 is about 54–96%, so a round finds major problems but proves nothing finer.

Then pilot with 30–50 workers and several hundred captures, and audit 5–10% of assets at 1 and 4 weeks.

## Training

- 45–60 minutes in groups of 3–5, on workers' own phones. Groups behave more boldly than individuals
- A visibly marked practice workspace
- Offline videos of 60–90 seconds per task, showing local crews. Manuals mostly go unread
- A rotated buddy period, then measure solo, because a buddy can mask problems by taking the phone
- Sign-off is two consecutive perfect practice captures. Expect errors later anyway: the same threshold still produced 7.6%
- Weekly feedback as photo or voice-note coaching, never punishment, which teaches people to hide errors

**Training dose matters.** An hour gave under 2% errors, against 14% with 2–3 minutes. Demo mode and buddying have no direct evidence, so measure them.

## Do not conclude

- That a screen is easy because you, or an office user, finds it easy
- That people like it because they said so
- That passing validation means correct data
