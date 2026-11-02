# Thesis (from Anur's YC W27 application)

The YC application is the source of truth. If it changes, update this file from it. Don't edit it from memory.

- One-liner: "Keep humans and AI agents on the same page."
- "Engineering teams now have AI agents writing much of their code. The code lands, but the understanding doesn't. The team doesn't know what the AI agent assumed, what it decided, or what it changed that no one read closely. Reviews pass and the system still breaks."
- "We build visualizations that give the team that understanding back. The first is Living Map, a live mind map of the system. It reads the AI agents' sessions and draws what they changed, assumed and decided on top of the real repo and infrastructure. Engineers brainstorm on it, ask it questions, add what they know, and confirm or dispute each item with a click. Their answers go back to the AI agent, so its next step starts from what the team agreed."
- "Every time an engineer confirms or disputes something, we learn what a person understood about a real system, and whether it held up when the code shipped." Long term, those labels train a small model that AI agents ask before they act.
- "The fight is over the record that people and AI agents check before acting… Teams run four AI coding tools on average, so the record has to sit across all of them."
- Origin: an agent's PR, "simplify networking", replaced the overlay network. Review passed, and the system was down for 5 hours. At the founder's last company, "every change started as a diagram we reviewed before anyone wrote code. It worked."
- Buyer: teams of 5–30 engineers running 2+ AI coding agents.
- Next: Codex and Cursor plugins; Terraform, Kubernetes and cloud-console connectors; a state API that agents read before they act.

The founder's own shorthand is "a collaboration system for agents, engineers and PMs that builds clarity in the design phase". The application doesn't mention PMs or Linear. The founder chose to keep a PM in the demo.
