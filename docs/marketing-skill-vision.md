# Vision: `/marketing-setup` Claude Code skill

**Status: DEFERRED — do not build yet.** Trigger to start: the marketing kit is proven live on paullearningcenter.com (end of revamp Phase 5).

## Vision

A reusable Claude Code skill that sets up **any** website/application project for marketing and tracking in one guided run — host-independent, no database, third-party conversion destination optional (Otute for PLC; any partner platform, or none, for other projects).

What the skill will do when invoked on a project:

1. Collect (or scaffold placeholders for) GTM / GA4 / Meta Pixel / Google Ads IDs and the list of outbound conversion domains.
2. Copy the `marketing-kit` (consent banner + Consent Mode v2, tag loading, UTM/gclid/fbclid attribution capture, outbound-click conversion handler with URL decoration, form helper) and generate `marketing.config.json`.
3. Inject the head snippet into the project's layout; wire forms to the chosen relay adapter (Netlify / Vercel / Cloudflare / Express / Web3Forms fallback).
4. Scaffold `/thank-you`, an ads landing-page checklist, and a privacy-policy stub.
5. Finish with a verification checklist: GA4 DebugView, Meta Test Events, Google Tag Assistant.

Related requirement docs (Claude artifacts, private — share from the page menu):

- PLC revamp plan: https://claude.ai/code/artifact/ece96e5d-5b15-4f9f-b210-0ea4e25e23d3
- Otute Partner Platform spec (postbacks / scoped API): https://claude.ai/code/artifact/558b61dd-5c87-4b6b-9105-09c422a325dc

## Progress tracker

Prerequisites (build these as normal project work first):

- [x] Phase 1 — PLC redesign shipped (live 2026-08-22, commit 5e51712; rollback tag `pre-revamp-2026-08-22`)
- [ ] Phase 2 — marketing kit running on PLC (consent, GTM, GA4, Meta Pixel, attribution, outbound `enroll_click` conversions)
- [ ] Phase 3 — Otute course integration + tracked redirects live
- [ ] Phase 4 — relay deployed on Netlify (contact email via Resend; Otute postback receiver forwarding offline conversions)
- [ ] Phase 5 — kit extracted into a project-agnostic `marketing-kit` package (config-driven, adapters, docs)

Skill authoring (starts only after all boxes above are checked):

- [ ] Write `SKILL.md` with the guided flow (steps 1–5 above)
- [ ] Bundle kit files + templates inside the skill folder
- [ ] Test the skill on a second, unrelated project (no Otute involvement)
- [ ] Document limits (what needs manual work: ad-account creation, DNS for email domain, consent copy review)

Update the checkboxes as phases land; this file is the single place to see how close the skill is to being ready.
