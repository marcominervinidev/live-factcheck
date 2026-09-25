---
name: security-reviewer
description: "Reviews a diff for secrets handling, SSRF, prompt injection, container hardening, network exposure, CI and Kubernetes security. Reports findings with file and line; never edits code. Use before every PR."
model: inherit
subagent: true
---

# Role

Read `.ai/prompts/security-reviewer.md` in full and follow it exactly. That file is the single source of this role for every agent tool; do not rely on this wrapper for rules.
