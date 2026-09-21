# Roadmap

## Platform expansion

Bring the same consent-first workflow discovery to every surface where Copilot works. Each platform is treated as a separate adapter behind the same core mining and generation pipeline, with its own privacy review, allowlist, and native approval flow.

- **VS Code (current).** Full mining, generation, review, and export. Windows-verified; Linux and macOS parity next.
- **Microsoft 365 Copilot.** Discover repeated patterns across Word, Excel, Outlook, and Teams Copilot sessions using supported Graph and Copilot APIs. Export as declarative agents / M365 Copilot Agents packaged for the [Microsoft 365 Agents SDK](https://learn.microsoft.com/microsoft-365-copilot/extensibility/) or Copilot Studio, with tenant-admin governance hooks.
- **GitHub Copilot Chat on GitHub.com.** Observe issue-triage, PR-review, and discussion patterns; generate repository-scoped skills and reusable prompt packs. Deliver as GitHub Actions / Copilot Extensions with per-repo consent.
- **Visual Studio.** Port the mining pipeline as a Visual Studio extension (VSIX) that reads the IDE's own Copilot session store, mirroring the VS Code trust and consent model.
- **JetBrains IDEs.** IntelliJ Platform plugin covering IntelliJ IDEA, PyCharm, WebStorm, Rider, and GoLand — same core packages, JetBrains-native settings and confirmations.
- **Copilot in Microsoft Edge / browser sidebars.** Optional browser extension for Edge (and later Chrome/Firefox) that observes research/summarization workflows with per-site allowlists.
- **Copilot in Windows / Terminal.** Explicit adapters for the Windows Copilot pane and Windows Terminal chat, gated behind Windows account consent and per-app opt-in.
- **Azure AI Foundry & Copilot Studio agents.** Publish discovered skills as reviewable Foundry agent definitions or Copilot Studio topics/plugins with the Foundry evaluation and continuous-monitoring workflow attached.
- **Neutral / cross-tool export.** Emit the shared skill draft as portable formats — Markdown + YAML front matter (already), MCP tool manifests, OpenAI Assistant/tool schemas, Anthropic Claude skill packs — so a workflow discovered once can ship anywhere.
- **Shared core, thin adapters.** Domain, privacy, workflow-engine, and skill-generator packages stay platform-neutral. Each host contributes only its session adapter, its native consent surface, and its export target.
- **Federated discovery (later).** Optional, opt-in cross-surface discovery that reconciles the same repeated method across VS Code + M365 + browser sessions on one user's machine — locally, without a server.

## Product depth

- Official session-data adapters if supported APIs become available, without undocumented discovery.
- Cross-workspace personal skills with explicit scope and retention controls.
- Team-level aggregation with privacy review and anonymized patterns, never employee rankings.
- Enterprise knowledge graphs with authorization-aware evidence links.
- PrefixSpan/process mining, alignment-aware optional paths, explicit loop models, and background workers.
- Skill effectiveness measurement using approved outcome feedback, not private prompt capture.
- Skill versioning and diff-based review; explicit overwrite/update approval.
- Multi-stage approval workflows and organization-level governance.
- Copilot SDK integration when a supported API fits the consent model.
- MCP-based enterprise integrations with explicit tool permissions and data boundaries.
- Optional model-assisted classification behind separately disclosed processing consent. External providers would change the local-only guarantee and must never be enabled implicitly.
- Encrypted storage, strict runtime migrations, scheduled retention, and adversarial import/export hardening for production.

## Non-goals

- Cross-user telemetry, behavioral scoring, or employee rankings.
- Silent background reads or undocumented API scraping on any platform.
- Automatic execution of generated skills. Every host adapter must keep human review before export and before use.
