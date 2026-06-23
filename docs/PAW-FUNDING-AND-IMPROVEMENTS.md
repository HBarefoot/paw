# Paw — Funding/Acquisition Avenues + Non-Feature Improvement Assessment

_Prepared for Henry / Barefoot Digital. Two parts: (A) where money for Paw can come from, matched to
your actual stage; (B) five things to improve that are **not** new features — polish before a customer._

---

## Part A — Funding, support, and acquisition avenues

**The honest framing first:** most funding mechanisms below **require traction (a paying pilot, MRR, or
institutional funding) before they unlock.** You have a genuinely strong codebase but little revenue yet,
so the realistic sequence is: **land one ConstructAI pilot → that unlocks nearly everything else.** The
two things you can pursue *today* without revenue are **cloud/AI credits** and **open-source
sponsorship**. Map:

### 1. Non-dilutive — keep 100% ownership (pursue now)
- **Cloud credits (easiest, no equity, bootstrap-friendly).** AWS Activate (GenAI track ~up to $300K),
  Google for Startups (up to ~$350K on the AI-first track), Microsoft for Startups (~$150K Azure, $25K
  baseline). These directly offset your infra + AI inference bill — pure runway extension. Most accept
  bootstrapped/early founders; apply to all three and stack.
- **Anthropic / AI-provider credits.** Anthropic for Startups: ~$25K Claude credits direct (rolling,
  ~2-week review), up to ~$100K via a VC/accelerator referral — **but it typically requires institutional
  equity funding + founded < 4 years.** So this one likely needs an investor on board first. OpenAI /
  Mistral / Together run similar credit programs if you ever go multi-provider.
- **Mozilla Builders** — themed grants up to ~$100K for early-stage **open-source AI** projects, no
  equity. Currently between cohorts; watch builders.mozilla.org. A natural fit *if you open-source the
  Paw kernel* (see open-core note below).
- **Open-source sponsorship.** If you make the **Paw kernel** open-source (with ConstructAI as the
  closed commercial layer — classic open-core), **GitHub Sponsors + Open Collective / Polar** give
  recurring community funding. Modest dollars, but it builds credibility, contributors, and an audience
  you can later sell ConstructAI to.

### 2. Non-dilutive — against revenue (later, once ConstructAI has MRR)
- **Revenue-based financing: Founderpath / Capchase.** Advance cash against recurring revenue, repaid
  from MRR, no equity. Founderpath funds SaaS in ~48h; Capchase positions as lower-fee venture-debt
  alternative. **Needs real recurring revenue first** — a post-pilot tool, not a now tool.

### 3. Dilutive — raise equity / accelerate (if you want to go big)
- **Accelerators.** YC's 2026 batches are ~60% AI and **agent infrastructure is the hot category** —
  Paw-as-agent-infra is squarely on-thesis. **a16z Speedrun** ($1M for ~10%) explicitly concentrates on
  agent infra. Either puts a top-tier brand on your cap table + the credit referrals above.
- **Vertical (construction-tech) VCs** for **ConstructAi specifically** — e.g. Brick & Mortar Ventures
  and other contech funds back AI-for-construction theses. A vertical wedge (roofing insurance claims)
  is a fundable, concrete story.

### 4. Exit — sell the asset (only with traction)
- **Acquire.com** (formerly MicroAcquire) — curated SaaS marketplace, sweet spot ~$100K–$500K, confidential
  (NDA-gated), connect Stripe, ~60–90 day close. **Best fit for selling a SaaS micro-startup _once it has
  revenue_.** **Flippa** — larger, public, every asset type/price. A pre-revenue codebase sells for
  little, so this is a "build ConstructAI revenue first" path, not a now path.

### The takeaway
You're asking the right question, but the lever that unlocks *all four* buckets is the same one I keep
coming back to: **a paying ConstructAI pilot.** It turns credits from "maybe" to "yes," makes accelerators
interested, enables RBF, and gives an acquirer something to value. Pursue **cloud credits + (optional)
open-core sponsorship now**; let a pilot unlock the rest. Don't sell or raise against a pre-revenue
codebase — you'd be trading away the asset at its cheapest.

### Sources
- [Anthropic — Claude for Startups](https://claude.com/programs/startups) · [Credit for Startups (AI credits directory)](https://creditforstartups.com/credits/ai) · [AI startup credits guide 2026](https://orbitmoney.io/deals/blog/startup-credits)
- [AWS Activate / cloud-credit overview](https://www.theainewsdigest.com/p/aws-startup-programs-cloud-credits)
- [Mozilla Builders](https://builders.mozilla.org/)
- [GitHub Sponsors / Open Collective](https://opencollective.com/github-sponsors) · [Polar (HN)](https://news.ycombinator.com/item?id=36722702)
- [Founderpath review (Capchase)](https://www.capchase.com/blog/founderpath-review)
- [a16z Speedrun application notes](https://www.techbuzz.ai/articles/a16z-partner-reveals-speedrun-accelerator-application-tips) · [Best AI accelerators 2026](https://elev-x.com/news-insights/article-best-ai-accelerators-for-startups/)
- [Acquire.com vs Flippa 2026](https://ecommerceparadise.com/flippa-vs-acquire-2026/) · [Best places to sell micro-SaaS 2026](https://superframeworks.com/articles/best-places-sell-startup-microsaas)

---

## Part B — Five non-feature improvements (polish before a customer)

Grounded in reviewing the whole codebase this session. None of these add features — they make what
exists trustworthy, legible, and demo-ready.

### 1. Contract tests at data seams (the highest-leverage one)
The run-verdict timestamp bug (blind for ~10 PRs), the `approval_id` silent write-drop, and the
`inferPermission` fallthrough are **the same class of bug**: a format/contract mismatch at a boundary
that passes logic-level tests because the tests use hand-built data instead of the real thing. Adopt a
discipline: **round-trip through the real migrated DB / real formats** at every store, provider, tool-log,
and timestamp seam (the new `run-window.test.ts` is the model — it asserts on a real `datetime('now')`
row). This is what would have caught the verdict being dead. Do this first; it pays for itself.

### 2. Get the test suite green + clear the tsc baseline debt
Every PR this session reported "1 fail + 1 error (pre-existing canvas artifact)" and worked around the
known `c.html` TS2769 overload class with a `.toString()` dance. A chronically-red suite and a type-debt
class you route around are **broken windows** — they erode the signal a green check is supposed to give
and tax every PR. Fix or quarantine the red test; fix the Hono `c.html` typing at the root so the
workaround disappears. Table-stakes before a customer or contributor opens the repo.

### 3. Make fail-open paths fail *loud*
Paw rightly wraps a lot of logic in fail-open try/catch (a card move must never break a run). But the
verdict being **silently** dead for many PRs proves fail-open can also hide total breakage. Add
self-checks that surface silent failure: warn when a subsystem fail-opens repeatedly, alert if the
verdict logs `0 tool calls` across N consecutive runs, a `/health` that asserts subsystems are actually
*producing data*, not just "not throwing." Resilience that also notices when it's broken.

### 4. Consolidate the ledger / card model
Across five phases (2a→2c.1) the ledger accreted inconsistencies: the cron/§8 double-card, transition
validation that lives only on the board path (not on the `task_update` tool), naming drift (`/tasks` vs
`agent_work` vs the design doc's `/agent-work`), the `approval_id` write-drop. A reconciliation pass to
unify the model, the validation surface, and the naming — **no new behavior**, just making a subsystem
that grew fast legible and lower-surface. Cheaper to do now than after a customer is on it.

### 5. Demo-readiness + document the honesty architecture as a selling point
Before a customer sees it: polish the rough edges you keep catching live (the `/runs` noise, the cron
double-card), seed a **clean demo dataset** (no `barefoot.digital` test rows, no half-finished cards),
and **write the honesty story down** — the ledger + run-verdict + approve-leash + execute-on-approve.
"This agent *cannot* mark work done without proof, and a human approves every side-effect" is your real
differentiator, and it's exactly what a buyer's security/ops team asks about. Right now that story lives
in gitignored briefs and your head. Turn it into a one-pager. This is polish + positioning — the cheapest
way to make the product *look* as trustworthy as it now actually is.
