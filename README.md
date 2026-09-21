# SkillDNA

**A local-first VS Code extension that turns your repeated Copilot work into reusable, reviewable skills.**

SkillDNA does not simply create skills. It discovers which workflows are worth turning into skills. Core analysis and generation run entirely on your machine.

- **Version:** 0.1.2
- **Platform:** VS Code 1.103+ · Windows (ARM64 verified)
- **Runtime:** Node.js 22.12+ / current LTS

---

## Why SkillDNA

Prompts capture requests. Skills capture procedures. Between them, your team's useful *methods* keep getting rebuilt from scratch — one chat at a time. SkillDNA watches how you actually work, finds the repeatable steps, and turns them into project-scoped Copilot skills you can review, edit, and share.

The loop is: **Observe → Normalize → Detect → Explain → Recommend → Generate → Review → Export.** Nothing leaves your machine unless you enable the optional Copilot review, and even then only categorical evidence is sent.

## Highlights

- **Local-first discovery.** Mines your approved sessions on your own hardware. No telemetry, no automatic history scans, no background script execution.
- **Explicit consent.** Default-off observation, per-session approval, retention windows, and native OS confirmations before writing or exporting.
- **Transparent scoring.** Every workflow candidate shows its frequency, stable and optional steps, entry/exit evidence, and heuristic scores.
- **Reviewable skill drafts.** Generates instructions, a Mermaid workflow diagram, and a result template — all editable, YAML- and privacy-validated before export.
- **Optional Copilot review.** Opt-in AI second opinion on which workflows are strong enough to become team-ready skills. Runs asynchronously and never overrides local recommendations.
- **Owned integration surface.** Activity Bar entry, status indicator, dashboard webview, Command Palette commands, and a `@skilldna` chat participant.

## Requirements

| Requirement | Version |
| --- | --- |
| VS Code | 1.103 or later |
| Node.js | 22.12+ (or current supported LTS) |
| npm | Bundled with Node |
| OS | Windows (ARM64 verified). Other platforms untested. |
| GitHub Copilot | Not required for mining or generation. Required only for optional AI review. |

Dependency installation and the test-host download need internet; runtime analysis stays local.

## Install

### From source (recommended for now)

```powershell
git clone https://github.com/Harshapatilsp/skilldna.git
cd skilldna
npm ci
npm run build
```

Press <kbd>F5</kbd> with **Run Extension** selected to launch the Extension Development Host, then run **SkillDNA: Open Dashboard**.

### From a packaged VSIX

```powershell
npm run package
code --install-extension skilldna-0.1.2.vsix
```

The extension is not published to the VS Code Marketplace.

### Browser preview (synthetic data only)

```powershell
npm run dev
```

The preview at <http://127.0.0.1:5173> uses memory only. It cannot import real data, observe VS Code, or export files. Use it to explore the UI without installing the extension.

## First run

1. Open a trusted workspace and run **SkillDNA: Open Dashboard**.
2. Choose an evidence source in **Privacy**: import previous Copilot sessions, or enable VS Code activity observation.
3. Approve and analyze. Detected workflows appear with scores and evidence.
4. Select a candidate to generate a reviewable skill draft (instructions, workflow diagram, result template).
5. Validate, approve, and export to `.github/skills/<skill-name>/` in your workspace.

For a step-by-step walkthrough with screenshots, see [the demo guide](docs/demo.md).

## Privacy

SkillDNA is designed around a strict allowlist. It reads only workspace-scoped Copilot session files you point it at, keeps normalized previews in memory until you approve them, and never scans arbitrary history or executes code from generated skills. Redaction and validation run before anything is written to disk.

Full allowlist, threat model, and limitations: [`docs/privacy.md`](docs/privacy.md).

## Optional Copilot review

Off by default. When enabled in **Privacy**, SkillDNA can ask a Copilot model to give a suitability opinion on your approved workflow candidates.

- Requires explicit setting toggle, a native data-disclosure confirmation, model-access permission, and an available Copilot model.
- Sends only categorical evidence (counts, categories, structural signals) — never file names, paths, session bodies, or IDs.
- Runs asynchronously with a 10-candidate cap per analysis and a 45-second timeout per request. Results are cached in memory and cleared on window restart or when the setting is disabled.
- The AI opinion is displayed separately and never overrides local scoring or approval. Local analysis is preserved when the model is unavailable, denied, over quota, or returns malformed output.

## Development

```powershell
npm ci
npm run build          # host bundle + webview
npm run watch          # continuous rebuild
npm run lint
npm run check-types
npm test               # Vitest unit + integration
npx playwright test    # Webview browser tests
npm run test:host      # Extension-host tests in isolated profile
```

Set `VSCODE_EXECUTABLE` to reuse an installed VS Code for host tests; otherwise the runner downloads stable.

## Repository layout

```text
apps/extension/          Host, commands, webview, observation adapters
apps/webview/            React dashboard and draft editor
packages/domain/         Versioned contracts and message validation
packages/application/    Shared application state transitions
packages/adapters/       Explicit session-file parser
packages/privacy/        Redaction, normalization, intent rules
packages/workflow-engine/ Segmentation, mining, clustering, scoring, Copilot review
packages/skill-generator/ Generation, validation, safe export
packages/storage/        Local JSON repository
samples/                 Synthetic session data
tests/                   Unit, integration, browser, extension-host tests
docs/                    Architecture, privacy, roadmap, demo, screenshots
```

Design notes and threat model: [`docs/architecture.md`](docs/architecture.md) · [`docs/privacy.md`](docs/privacy.md) · [`docs/roadmap.md`](docs/roadmap.md).

## Limitations

- Discovery relies on Windows VS Code internal session storage, not an official Copilot history API. Unsupported or malformed formats are reported as skipped.
- One real-data source is active at a time; source changes discard pending data.
- Mining is session-level edit-similarity clustering plus bounded contiguous sequences — not a full process-mining system.
- Scores are heuristics, not proof that automation is safe. Human review of every generated draft is required.
- Redaction cannot recognize every secret or identifier. Local storage is not encrypted.
- Existing skill directories are refused; update/overwrite and remote-filesystem export are deferred.
- Generated skills contain no executable scripts. Sample requests are for manual testing only.

## Roadmap

Expand to more platforms (Microsoft 365 Copilot, GitHub, Visual Studio, JetBrains, and other Copilot surfaces). Plus advanced process mining, cross-workspace skills, anonymized team aggregation, enterprise knowledge graphs, skill versioning, approval governance, Copilot SDK, and permissioned MCP integration. Full plan: [`docs/roadmap.md`](docs/roadmap.md).

## Contributing

This is an early-stage personal project. Issues and pull requests are welcome once a contribution policy and license are in place.

## License

No license has been chosen yet. Until a `LICENSE` file is added, all rights are reserved. If you would like to use, extend, or redistribute the code, please open an issue first.

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md).
