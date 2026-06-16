---
name: onboarding
description: Use when onboarding a new client or customer — collect their details, set up their workspace, and send a welcome message.
---

# Client onboarding

Follow these steps whenever a new client needs to be onboarded.

1. Collect the client's name, company, email, and primary goal. Ask for anything missing before continuing.
2. Search memory (`memory_recall`) for any prior context about this client or company so you don't ask for what you already know.
3. Create a folder for the client in the canvas workspace (`canvas_mkdir`) named after their company slug.
4. Draft a short welcome message that restates their goal and the next concrete step, and confirm it with the operator before sending.
5. Store the key facts (name, company, goal, start date) with `memory_store` so future conversations have the context.
