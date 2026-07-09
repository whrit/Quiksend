# Changelog

## [2.9.1](https://github.com/whrit/Quiksend/compare/v2.9.0...v2.9.1) (2026-07-09)


### Bug Fixes

* **mailbox:** derive OAuth mailbox address from provider, not user input ([#97](https://github.com/whrit/Quiksend/issues/97)) ([0500c83](https://github.com/whrit/Quiksend/commit/0500c83a24d986cc887f225e87e4e22306cc4a16))
* **web:** make dev-server port configurable via WEB_PORT ([#99](https://github.com/whrit/Quiksend/issues/99)) ([604210d](https://github.com/whrit/Quiksend/commit/604210d9dc9b6b89eccfde055959d48406f6121d))


### Documentation

* **nango:** mailbox address is OAuth-derived, not user-typed ([#100](https://github.com/whrit/Quiksend/issues/100)) ([6e14671](https://github.com/whrit/Quiksend/commit/6e14671b5a9ddd84a991c54c1e96f7ef8ba60513))

## [2.9.0](https://github.com/whrit/Quiksend/compare/v2.8.0...v2.9.0) (2026-07-09)


### Features

* **design:** operator's console redesign — strip editorial affectation ([#95](https://github.com/whrit/Quiksend/issues/95)) ([669670a](https://github.com/whrit/Quiksend/commit/669670a05705dd73553b7770fe632fa7f0064f73))

## [2.8.0](https://github.com/whrit/Quiksend/compare/v2.7.0...v2.8.0) (2026-07-09)


### Features

* **design:** intentional warm-dark broadsheet theme ([#91](https://github.com/whrit/Quiksend/issues/91)) ([2163a85](https://github.com/whrit/Quiksend/commit/2163a85421f3a284e134138632bee795824a5bce))
* **inbox:** two-pane newspaper reader ([#93](https://github.com/whrit/Quiksend/issues/93)) ([ae3a6bc](https://github.com/whrit/Quiksend/commit/ae3a6bc5f81948fcc3564242b8b5003f9d588bc2))
* **sequences:** editorial paper-slip step cards + masthead ([#92](https://github.com/whrit/Quiksend/issues/92)) ([5ce5a4a](https://github.com/whrit/Quiksend/commit/5ce5a4a898f99c089c7c9326b54125913a2bcbc6))

## [2.7.0](https://github.com/whrit/Quiksend/compare/v2.6.2...v2.7.0) (2026-07-09)


### Features

* **design:** editorial command-center design system ([#89](https://github.com/whrit/Quiksend/issues/89)) ([8bb7017](https://github.com/whrit/Quiksend/commit/8bb701757f90a009ff0bc3695f82b07ff892fe4b))

## [2.6.2](https://github.com/whrit/Quiksend/compare/v2.6.1...v2.6.2) (2026-07-09)


### Bug Fixes

* **auth:** auto-restore active workspace on logout / restart ([#87](https://github.com/whrit/Quiksend/issues/87)) ([749774a](https://github.com/whrit/Quiksend/commit/749774a61831a98145433971ff059412f700ee65))

## [2.6.1](https://github.com/whrit/Quiksend/compare/v2.6.0...v2.6.1) (2026-07-06)


### Bug Fixes

* **worker:** register cron queue before scheduling it ([#85](https://github.com/whrit/Quiksend/issues/85)) ([e7ce215](https://github.com/whrit/Quiksend/commit/e7ce21564c8ea94c7c5221124d52e232306a5e96))

## [2.6.0](https://github.com/whrit/Quiksend/compare/v2.5.0...v2.6.0) (2026-07-06)


### Features

* **ai:** Brave Search provider + BRAVE_API_KEY/EXA_API_KEY/TAVILY_API_KEY env vars ([#79](https://github.com/whrit/Quiksend/issues/79)) ([4870f7e](https://github.com/whrit/Quiksend/commit/4870f7e0c45d6a2056e3539d23837876ab5985e7))
* **ai:** non-blocking research pipeline in generateEmailForProspect ([#80](https://github.com/whrit/Quiksend/issues/80)) ([baf507e](https://github.com/whrit/Quiksend/commit/baf507e11b51ae778b13c8e00f35df27186e46e1))
* **analytics:** per-sequence performance drill-down on the analytics dashboard ([#81](https://github.com/whrit/Quiksend/issues/81)) ([e86e39f](https://github.com/whrit/Quiksend/commit/e86e39fb2296df2f1369d87a6cacd26961be4a44))
* **mailbox+crm:** Nango reconnect flow + mailbox health link + SMTP domain-auth check ([#83](https://github.com/whrit/Quiksend/issues/83)) ([8a3abe4](https://github.com/whrit/Quiksend/commit/8a3abe433ffebc2941dd2bb2d3df9f565b7d88f9))
* **observability:** initialize Sentry SDK in the web app ([#82](https://github.com/whrit/Quiksend/issues/82)) ([2026186](https://github.com/whrit/Quiksend/commit/20261861bedcb6d50c9c93492c13b45f7ddd9d47))
* **queue:** defense-in-depth org filter on seed_inbox.verify + crm.writeback ([#78](https://github.com/whrit/Quiksend/issues/78)) ([675dd93](https://github.com/whrit/Quiksend/commit/675dd9328d130192cafaa282e5f24818da2e25f7))

## [2.5.0](https://github.com/whrit/Quiksend/compare/v2.4.0...v2.5.0) (2026-07-06)


### Features

* **deliverability:** routing policy Off/Warn/Enforce UI + filtered canary drawer + grid empty state ([#71](https://github.com/whrit/Quiksend/issues/71)) ([6a882ff](https://github.com/whrit/Quiksend/commit/6a882ffe82a8f4e4158f3008719dc38b5d5d03ac))
* **mailbox:** inline MAILBOX_ENCRYPTION_KEY error on SMTP mailbox creation ([#76](https://github.com/whrit/Quiksend/issues/76)) ([1cf486d](https://github.com/whrit/Quiksend/commit/1cf486d384abb5c44669cb6d784955872a60fec2))
* **prospects:** CSV import runs on the worker queue instead of blocking the request ([#74](https://github.com/whrit/Quiksend/issues/74)) ([c02b1d9](https://github.com/whrit/Quiksend/commit/c02b1d99ca75534f4d3dcfc7b1798e794cca4e4f))
* **security:** admin gates on webhook/API-key/sequence lifecycle + manual suppression add + step-0 validation ([#70](https://github.com/whrit/Quiksend/issues/70)) ([8e2e4b2](https://github.com/whrit/Quiksend/commit/8e2e4b2c9526d2c66ac6a0a0f91a5f10b231a14b))
* **ux:** error boundaries + compose anchor plumbing + prospects previous page + sequence enroll mailbox names ([#73](https://github.com/whrit/Quiksend/issues/73)) ([c10e49e](https://github.com/whrit/Quiksend/commit/c10e49eadeebd3135b5e3d46e5491876bbafde7c))
* **webhooks+api:** full engine event fanout + REST enroll safety net + canonical /webhooks/{id} + per-step analytics ([#72](https://github.com/whrit/Quiksend/issues/72)) ([4299524](https://github.com/whrit/Quiksend/commit/42995248486846eccd741d36293de2e1639bcaba))

## [2.4.0](https://github.com/whrit/Quiksend/compare/v2.3.4...v2.4.0) (2026-07-06)


### Features

* **web:** add primary navigation shell + empty-state dashboard hero ([#67](https://github.com/whrit/Quiksend/issues/67)) ([138f2fc](https://github.com/whrit/Quiksend/commit/138f2fcac24dde61650bfb8f87fd13a37ed49494))

## [2.3.4](https://github.com/whrit/Quiksend/compare/v2.3.3...v2.3.4) (2026-07-06)


### Bug Fixes

* **web:** stop /deliverability route pulling server-only canary-injection.ts ([#65](https://github.com/whrit/Quiksend/issues/65)) ([8e937c7](https://github.com/whrit/Quiksend/commit/8e937c742245ad8e1389ce7502cc33f9464a0e69))

## [2.3.3](https://github.com/whrit/Quiksend/compare/v2.3.2...v2.3.3) (2026-07-03)


### Bug Fixes

* **web:** serialize JS Date to ISO string in raw SQL interpolations ([#63](https://github.com/whrit/Quiksend/issues/63)) ([3f89e6d](https://github.com/whrit/Quiksend/commit/3f89e6ddadf28b8bef087ead584804aebf8b9ef7))

## [2.3.2](https://github.com/whrit/Quiksend/compare/v2.3.1...v2.3.2) (2026-07-03)


### Bug Fixes

* **web:** silence dev-mode import-protection warnings + Grammarly hydration mismatch ([#61](https://github.com/whrit/Quiksend/issues/61)) ([8094b6e](https://github.com/whrit/Quiksend/commit/8094b6e298369913135449f289f11112bc91c2f5))

## [2.3.1](https://github.com/whrit/Quiksend/compare/v2.3.0...v2.3.1) (2026-07-03)


### Bug Fixes

* **web:** stop server code leaking into client bundle (env crash + password-in-URL + notFound) ([#59](https://github.com/whrit/Quiksend/issues/59)) ([d8c066b](https://github.com/whrit/Quiksend/commit/d8c066b7ced0d8e536bda8b4e71e94f2adfa98cc))

## [2.3.0](https://github.com/whrit/Quiksend/compare/v2.2.1...v2.3.0) (2026-07-03)


### Features

* **wave8-sigma:** webhook fanout + UI wiring + docs alignment ([#56](https://github.com/whrit/Quiksend/issues/56)) ([c74b91f](https://github.com/whrit/Quiksend/commit/c74b91ffb1ad65dd5cdcb51926e34de6e569f17e))


### Bug Fixes

* **wave8-omicron:** canary signal reliability ([#54](https://github.com/whrit/Quiksend/issues/54)) ([70cc465](https://github.com/whrit/Quiksend/commit/70cc4650823e9a29b57b47822f7d75baef01d61e))
* **wave8-phi2:** provider ops crons + testing gaps + architecture cleanup ([#57](https://github.com/whrit/Quiksend/issues/57)) ([e3387cd](https://github.com/whrit/Quiksend/commit/e3387cd7c99d0ac35207fd529cff3eb073148547))
* **wave8-rho:** performance + gateway cache + DNS security ([#55](https://github.com/whrit/Quiksend/issues/55)) ([92ba868](https://github.com/whrit/Quiksend/commit/92ba868d38294a539971593cc9646d641c87d1cc))

## [2.2.1](https://github.com/whrit/Quiksend/compare/v2.2.0...v2.2.1) (2026-07-03)


### Documentation

* **v2.2.0:** catch up all docs + env with Phase 11 shipped ([#52](https://github.com/whrit/Quiksend/issues/52)) ([85f39a0](https://github.com/whrit/Quiksend/commit/85f39a011f08203927903d387b90b75188bcdb38))

## [2.2.0](https://github.com/whrit/Quiksend/compare/v2.1.1...v2.2.0) (2026-07-03)


### Features

* **wave7-phi:** Phase 11C — Canary deliverability (code) ([#50](https://github.com/whrit/Quiksend/issues/50)) ([606fef5](https://github.com/whrit/Quiksend/commit/606fef520ee2b654984ae813bdd96142ce6cdf19))
* **wave7-tau:** Phase 11A — SEG detection + segmentation ([#48](https://github.com/whrit/Quiksend/issues/48)) ([778c62d](https://github.com/whrit/Quiksend/commit/778c62d268eaf13a9dc6230ab773750ffa16f3f4))
* **wave7-upsilon:** Phase 11B — Routing + content sanitizer ([#49](https://github.com/whrit/Quiksend/issues/49)) ([10db2f9](https://github.com/whrit/Quiksend/commit/10db2f9cbc1c9169acd2ed47a296968c9d52110e))


### Documentation

* **phase-11:** spec enterprise deliverability (SEG detection + routing + canary) ([e43e612](https://github.com/whrit/Quiksend/commit/e43e612fe4c786ece9cf132006bf7bcd0ff6fd85))
* **wave7-omega-ops:** Phase 11C — Provider seed pool operational runbook ([#51](https://github.com/whrit/Quiksend/issues/51)) ([4d72533](https://github.com/whrit/Quiksend/commit/4d725334d9a9053dbb9cdeabffa67947a7e4585b))

## [2.1.1](https://github.com/whrit/Quiksend/compare/v2.1.0...v2.1.1) (2026-07-02)


### Bug Fixes

* **wave6-omega:** close remaining review findings ([#44](https://github.com/whrit/Quiksend/issues/44)) ([4407d96](https://github.com/whrit/Quiksend/commit/4407d964555ab83bcf37417f9c23be74e20c9029))


### Documentation

* **wave6-psi:** real-user documentation ([#43](https://github.com/whrit/Quiksend/issues/43)) ([0925103](https://github.com/whrit/Quiksend/commit/0925103f5677e03b28a18e5f44b4ec8525d211e8))

## [2.1.0](https://github.com/whrit/Quiksend/compare/v2.0.0...v2.1.0) (2026-07-02)


### Features

* **wave5-beta:** OAuth mailboxes + PRD gap-close ([#37](https://github.com/whrit/Quiksend/issues/37)) ([1cfce2d](https://github.com/whrit/Quiksend/commit/1cfce2deed08202a48af26dfd25970e6b4637b5a))


### Bug Fixes

* **wave5-alpha:** engine safety + CAN-SPAM auto-send + effect executor ([#39](https://github.com/whrit/Quiksend/issues/39)) ([77dbc99](https://github.com/whrit/Quiksend/commit/77dbc993159565b507bcbb07a323f370858f5b6d))
* **wave5-gamma:** security hardening ([#38](https://github.com/whrit/Quiksend/issues/38)) ([5f3edfd](https://github.com/whrit/Quiksend/commit/5f3edfd3a21c1ea0903fb0793496471ee3660397))


### Performance

* **wave5-epsilon:** performance indexes + client hardening + Turbo cache ([#41](https://github.com/whrit/Quiksend/issues/41)) ([0b786b4](https://github.com/whrit/Quiksend/commit/0b786b4c1d395a2d901a330a7699461f042b0957))


### Refactors

* **wave5-delta:** architecture cleanup + correctness fixes ([#36](https://github.com/whrit/Quiksend/issues/36)) ([74c31d6](https://github.com/whrit/Quiksend/commit/74c31d6e639f566f4d665da0cce85ceb71b4a9fe))

## [2.0.0](https://github.com/whrit/Quiksend/compare/v1.13.0...v2.0.0) (2026-07-02)


### Chores

* cut v2.0.0 for V0 milestone completion ([1e45f82](https://github.com/whrit/Quiksend/commit/1e45f82ad620dc97d865a1b3163a29fc7ea9a370))

## [1.13.0](https://github.com/whrit/Quiksend/compare/v1.12.0...v1.13.0) (2026-07-02)


### Features

* **phase-10-api-webhooks:** Phase 10 complete ([#30](https://github.com/whrit/Quiksend/issues/30)) ([1b4ae6f](https://github.com/whrit/Quiksend/commit/1b4ae6f0a9fcada47fc636a02e79c9588cea2789))

## [1.12.0](https://github.com/whrit/Quiksend/compare/v1.11.0...v1.12.0) (2026-07-02)


### Features

* **phase-9-writeback-analytics:** Phase 9 complete ([#29](https://github.com/whrit/Quiksend/issues/29)) ([75f8cd0](https://github.com/whrit/Quiksend/commit/75f8cd0a4818ee2c9bece78df2279f02a3a6964a))

## [1.11.0](https://github.com/whrit/Quiksend/compare/v1.10.0...v1.11.0) (2026-07-02)


### Features

* **phase-8-ai:** Phase 8 complete ([#28](https://github.com/whrit/Quiksend/issues/28)) ([7d0e0ee](https://github.com/whrit/Quiksend/commit/7d0e0eec1b22738cb76fd6cc263fc9c3cedf6842))

## [1.10.0](https://github.com/whrit/Quiksend/compare/v1.9.0...v1.10.0) (2026-07-02)


### Features

* **phase-7-inbox:** Phase 7 complete ([#27](https://github.com/whrit/Quiksend/issues/27)) ([07e61c3](https://github.com/whrit/Quiksend/commit/07e61c36a522c18f4504fba519c88a3f2fae8fc5))

## [1.9.0](https://github.com/whrit/Quiksend/compare/v1.8.0...v1.9.0) (2026-07-02)


### Features

* **phase-8-prep-ai:** Phase 8-prep complete ([#22](https://github.com/whrit/Quiksend/issues/22)) ([3d0ff2f](https://github.com/whrit/Quiksend/commit/3d0ff2f3edc34baa1be409dedea1527543a48afe))

## [1.8.0](https://github.com/whrit/Quiksend/compare/v1.7.0...v1.8.0) (2026-07-02)


### Features

* **phase-7-prep-inbound:** Phase 7 prep complete ([#21](https://github.com/whrit/Quiksend/issues/21)) ([b855af2](https://github.com/whrit/Quiksend/commit/b855af24f061cdcb47c44f56d3cdfbda95a796cc))

## [1.7.0](https://github.com/whrit/Quiksend/compare/v1.6.0...v1.7.0) (2026-07-02)


### Features

* **phase-6-engine:** Phase 6 engine complete ([#23](https://github.com/whrit/Quiksend/issues/23)) ([a5bb4bb](https://github.com/whrit/Quiksend/commit/a5bb4bb491dfcf46699c36ce272c511609ebd7cb))

## [1.6.0](https://github.com/whrit/Quiksend/compare/v1.5.0...v1.6.0) (2026-07-02)


### Features

* **phase-4-gmail-graph:** Phase 4 remainder complete ([#17](https://github.com/whrit/Quiksend/issues/17)) ([9668eb9](https://github.com/whrit/Quiksend/commit/9668eb9d2da2c1df7ec014edc99afafdbdf65217))

## [1.5.0](https://github.com/whrit/Quiksend/compare/v1.4.0...v1.5.0) (2026-07-02)


### Features

* **phase-5-sequences:** Phase 5 complete ([#18](https://github.com/whrit/Quiksend/issues/18)) ([ff93e0b](https://github.com/whrit/Quiksend/commit/ff93e0b5942e3f05847168116a2e5388c0025ef4))

## [1.4.0](https://github.com/whrit/Quiksend/compare/v1.3.0...v1.4.0) (2026-07-02)


### Features

* **phase-4:** mailbox + message schemas + SMTP adapter + compose + single send ([#13](https://github.com/whrit/Quiksend/issues/13)) ([a9ba04a](https://github.com/whrit/Quiksend/commit/a9ba04a68bc7a9399f84ba334fd47b37a331afd1))


### Bug Fixes

* **drizzle:** correct 0003 snapshot prevId ([34f8ca0](https://github.com/whrit/Quiksend/commit/34f8ca00545791702034ce2b3923d149059b3be0))
* **drizzle:** merge missing tables into 0003_snapshot ([d8f88dd](https://github.com/whrit/Quiksend/commit/d8f88dd96692dc80e63445c6f71ef143e027bca6))

## [1.3.0](https://github.com/whrit/Quiksend/compare/v1.2.0...v1.3.0) (2026-07-02)


### Features

* **phase-3-crm:** Phase 3 back-half complete ([#12](https://github.com/whrit/Quiksend/issues/12)) ([c98a963](https://github.com/whrit/Quiksend/commit/c98a963eb3ae6b24979116d07052a974ee662d45))

## [1.2.0](https://github.com/whrit/Quiksend/compare/v1.1.0...v1.2.0) (2026-07-02)


### Features

* **phase-2-prospects:** Phase 2 complete ([#11](https://github.com/whrit/Quiksend/issues/11)) ([cd5f2d5](https://github.com/whrit/Quiksend/commit/cd5f2d5fbe6ec41ae5ce4c686d9b8d6b6fcf3104))

## [1.1.0](https://github.com/whrit/Quiksend/compare/v1.0.3...v1.1.0) (2026-07-02)


### Features

* **foundations:** scaffold core/mail/integrations/queue/observability packages ([#9](https://github.com/whrit/Quiksend/issues/9)) ([1b4a564](https://github.com/whrit/Quiksend/commit/1b4a564886bc7ae07d7a91f2d1eed50b1f9b35ce))

## [1.0.3](https://github.com/whrit/Quiksend/compare/v1.0.2...v1.0.3) (2026-07-01)


### Bug Fixes

* **web:** update Node version, base color, and icon library ([#7](https://github.com/whrit/Quiksend/issues/7)) ([9259a48](https://github.com/whrit/Quiksend/commit/9259a488dff861ea7cb092f00a321a1745806f73))

## [1.0.2](https://github.com/whrit/Quiksend/compare/v1.0.1...v1.0.2) (2026-07-01)


### Bug Fixes

* **web:** ensure tsconfig.base.json is copied during build ([#5](https://github.com/whrit/Quiksend/issues/5)) ([b78b668](https://github.com/whrit/Quiksend/commit/b78b668b917caa78a5d90662c4b4e1b4fdd1a3fc))
* **worker:** ensure tsconfig.base.json is copied during build ([b78b668](https://github.com/whrit/Quiksend/commit/b78b668b917caa78a5d90662c4b4e1b4fdd1a3fc))

## [1.0.1](https://github.com/whrit/Quiksend/compare/v1.0.0...v1.0.1) (2026-07-01)


### Bug Fixes

* **web:** update Node version and turbo pruning method ([#3](https://github.com/whrit/Quiksend/issues/3)) ([94f9be5](https://github.com/whrit/Quiksend/commit/94f9be5de8dd3e2b9972c240056253c9d3820417))
* **worker:** update Node version and turbo pruning method ([94f9be5](https://github.com/whrit/Quiksend/commit/94f9be5de8dd3e2b9972c240056253c9d3820417))

## 1.0.0 (2026-07-01)


### Features

* **project:** initialize monorepo structure and setup ([b068239](https://github.com/whrit/Quiksend/commit/b0682394e7beb94e4e5c20a942127e9d6c24b113))
* **quiksendPhase1:** initialize web and worker applications ([#1](https://github.com/whrit/Quiksend/issues/1)) ([784165f](https://github.com/whrit/Quiksend/commit/784165f6ee372d3de1c568857de0d43d89a6292e))


### Bug Fixes

* **oxfmt.config:** add CHANGELOG.md to ignore patterns ([4602508](https://github.com/whrit/Quiksend/commit/4602508f53671e2839a6f9ec8dda3aaa704e3bff))
* **oxfmt.config:** add config files to ignore patterns ([ecda86d](https://github.com/whrit/Quiksend/commit/ecda86dd0e32209f4470533514778e7da78de19d))

## Changelog

All notable changes to Quiksend are recorded here. This file is maintained
automatically by [Release Please](https://github.com/googleapis/release-please)
from [Conventional Commit](https://www.conventionalcommits.org/) messages — do
not edit it by hand.
