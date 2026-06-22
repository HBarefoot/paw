# Railway — make `git`/`gh` real on `paw` (and kill the GH_TOKEN loop)

**Why it's stuck:** #159 installs `git`/`gh` in the **Dockerfile** (build-time). If `paw` is deployed
from a pre-#159 image, the binaries aren't there → the tools fail → Paw mis-reads it as "needs a
GH_TOKEN." Fix = deploy the latest `main` (which rebuilds with the new Dockerfile) + apply the prompt
edit.

1. **Redeploy `paw` from the LATEST `main`.** Railway → `paw` → Deployments → Redeploy latest (or push
   any commit). Current `main` has #159 (binaries) + #162 (auth fix). A deploy stuck on an older commit
   is the whole problem.
2. **Verify in the `paw` shell:** `git --version` and `gh --version` → both must print. "command not
   found" = the build didn't run the Dockerfile's apt step; check the build logs.
3. **Apply the updated orchestrator system prompt** to `paw`'s live config (the file I edited) — removes
   the "git not installed" contradiction + the `GH_TOKEN` misconception. **Do NOT add a GH_TOKEN env
   var** — it's never read.
4. **`/new` session, then test:** have Paw run `gh pr list` on an allowlisted repo. Returns a list →
   `git`/`gh` is live.

**Done when:** `git`/`gh` print versions **and** `gh pr list` works.
