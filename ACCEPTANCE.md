# dsh-tower P1 acceptance

## Pins

- Kimi Code `0.39.1`
- DeepSeek Harness `dsh-v0.1.2-alpha.1`
- No newer tower commits on kimi `main` relative to this pin
- Dirty-base init/open refused (divergence from Kimi, `#3346`)

## P0 protocol

- [ ] Protocol store / inbox / mission / finding / review tests green
- [ ] Dirty-base refusal covered

## P1 host

- [ ] 11 tools registered when flag enabled
- [ ] `/tower` command + skill load
- [ ] `startContinuable` path works
- [ ] Write guard enforces mission scope
- [ ] Feature flag default-off

## Dual-mission

- [ ] Plan two disjoint-scope missions
- [ ] Spawn workers, inbox/findings/reviews flow
- [ ] Merge gates (deps, clean review, scope, dirty base)
