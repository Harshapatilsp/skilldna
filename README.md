# SkillDNA

**SkillDNA does not simply create skills. It discovers which workflows are worth turning into skills.**

SkillDNA learns how experts work with Copilot and turns repeated, user-approved workflows into reusable intelligence.

Prompts capture requests. Skills capture procedures. SkillDNA discovers the procedures people are already following.

## Problem and solution

Useful multi-step procedures disappear across separate investigations and development sessions. SkillDNA turns approved normalized activity into explainable workflow candidates, recommends the appropriate reusable artifact, and generates reviewable project-scoped Copilot Agent Skills. It is not a chatbot, prompt library, or marketplace.

The local loop is **Observe > Normalize > Detect > Explain > Recommend > Generate > Review > Export**. Core analysis and generation require no cloud service. Optional, separately consented Copilot suitability review sends minimized approved summaries to the selected model provider. No telemetry, automatic history scanning, or automatic script execution is included.

[Workflow explorer screenshot](docs/screenshots/workflows-1440.png)

## Features

- 25 synthetic sessions across support investigation, developer failure investigation, and incident response.
- Default-off consent, in-memory normalized previews, per-session approval/exclusion, deletion, retention, and data export.
- Explicit JSON/JSONL adapter, approved file/task/debug metadata, and an owned `@skilldna` chat participant.
- Frequent contiguous sequences, similarity clusters, stable/optional steps, entry/exit evidence, and transparent heuristic scores.
- Recommendations for skills, prompts, agents, tools, manual work, or additional evidence.
- Optional background Copilot suitability opinions, with missing-evidence and risk explanations kept separate from local recommendations.
- Editable skill sections/files, Markdown preview, YAML/privacy validation, Mermaid graph, and result template.
- Review acknowledgement and native destination confirmation before project-scoped skill export.
- Activity Bar entry, status indicator, Command Palette commands, and categorical local feedback.

## Setup and run

Use Node.js 22.12+ or a current supported LTS, npm, and VS Code 1.103+. Verified on Windows ARM64. The extension does not require Copilot for mining or generation. Optional Copilot review requires available model access, consent, network connectivity, and quota. Dependency installation and test-host downloads need internet; core runtime processing remains local.

```sh
npm ci
npm run build
```

Press **F5** with **Run Extension** selected. The build task builds both host and webview. In the Extension Development Host, open a local scratch workspace and run **SkillDNA: Open Dashboard**.

Run `npm run package` for an installable VSIX, then use **Extensions: Install from VSIX**. This is a local hackathon package, not a Marketplace publication.

Run `npm run dev` for the synthetic-only browser preview at <http://127.0.0.1:5173>. The preview uses memory only and cannot import real data, observe VS Code, or export files.

## Demo

On first activation, SkillDNA offers **Import previous sessions**, **Try synthetic demo**, or **Not now**. The invitation is shown once per VS Code profile. The import action remains available in the dashboard and Command Palette afterward.

### Install to discovery

1. Choose **Import previous sessions** in a trusted workspace and approve the native consent notice.
2. In **Analyze my previous Copilot sessions**, choose **Preview Sessions** or **Analyze**, then choose a folder or session files. The picker starts at `%APPDATA%\Code\User\workspaceStorage`. Only workspace identifiers and direct `<hash>/chatSessions/*.json` or `*.jsonl` files in the selected scope are read.
3. Review **Found N sessions**, exclude unwanted sessions, and choose **Approve and discover**. Until approval, normalized sessions remain in memory only.
4. See actual session counts, detected workflows, and potential skills. Select a potential skill to generate its reviewable draft.

Counts are computed from the selected files and approved data, never hard-coded to a demo claim. A small or unrelated dataset may produce no recommendations. **Try discovery demo** runs the 25-session synthetic dataset through analysis in one action, with synthetic provenance shown explicitly. Import mode does not enable background observation.

**Preview Sessions** keeps results in memory for review. **Analyze** asks for approval of the discovered count before saving normalized sessions and analyzing. Cancel before scope selection reads nothing. State databases, extension state, unrelated caches, chatEditingSessions, and files outside the allowlist are never read by discovery. See [the privacy allowlist and limits](docs/privacy.md).

### Optional Copilot Review

In **Privacy**, enable **Review workflow suitability with Copilot**, approve the native data-disclosure dialog, grant VS Code model access if prompted, and select an available Copilot model. Approved existing candidates are reviewed, and subsequent explicit **Analyze workflows** or **Approve and discover** actions start asynchronous reviews without blocking local work. Live observation alone never triggers model calls.

The **Copilot suitability review** section shows queued, reviewing, complete, or unavailable status, an AI opinion, reasons, missing evidence, and risks. The local recommendation is unchanged: AI review does not prove a workflow works, fill missing evidence, execute instructions, or approve export. Only categorical evidence is available to the model, so it cannot reconstruct technical details from discarded raw chats.

At most ten candidates per analysis are reviewed sequentially with a 45-second timeout per request. Unchanged summaries reuse in-memory results. Disable the setting to cancel pending requests and clear reviews. Permission, model selection, and reviews reset on window restart. Deletion, evidence correction, feedback changes, and retention invalidation clear affected review state conservatively. Quota, denied access, malformed responses, and unavailable models preserve local analysis. This feature is unavailable in the synthetic browser preview.

### Detailed walkthrough

1. Open the dashboard and show observation off.
2. Load synthetic demo data and inspect normalized sessions.
3. Analyze workflows and select Evidence-Based Case Investigation.
4. Inspect 12 occurrences, 9 stable steps, 3 optional paths, the blocked exit, and recommendation factors.
5. Generate a skill draft and review/edit all three files.
6. Validate, acknowledge review, and approve the saved draft.
7. Export and confirm the destination under `.github/skills/<skill-name>/`. SKILL.md opens for inspection. Nothing executes.
8. Manually test using the synthetic request shown in Skill Review and record local feedback.

See [the complete demo guide](docs/demo.md) for import and observation demonstrations.

## Architecture

```text
apps/extension/          Host, commands, webview, observation adapters
apps/webview/            React dashboard and draft editor
packages/domain/        Versioned contracts and message validation
packages/application/   Shared application state transitions
packages/adapters/      Explicit session-file parser
packages/privacy/       Redaction, normalization, intent rules
packages/workflow-engine/ Segmentation, mining, clustering, scoring
packages/skill-generator/ Generation, validation, safe export
packages/storage/       Local JSON repository
samples/                Synthetic workflow and import data
tests/                  Unit, integration, browser, extension-host tests
docs/                   Architecture, privacy, demo, roadmap, screenshots
```

See [architecture](docs/architecture.md), [privacy and threat model](docs/privacy.md), and [roadmap](docs/roadmap.md).

## Testing

```sh
npm test
npm run check-types
npm run lint
npm run build
npx playwright test
npm run test:host
```

Vitest covers privacy/normalization, consent, segmentation, mining/scoring, generation/validation, storage, import, and actual temporary-directory exports. Playwright uses Microsoft Edge and checks demo behavior, approval invalidation, and desktop/mobile layouts; screenshots go to `docs/screenshots`. Select an installed browser channel in the config on other platforms.

Extension-host tests use an isolated profile and check activation, default-off, command registration, and demo mining. Set `VSCODE_EXECUTABLE` to test an existing installation; otherwise the runner downloads stable VS Code. Native confirmation dialogs, actual Copilot invocation, and each metadata source also have manual checks in the demo guide; they are not claimed as fully automated coverage.

## Known limitations

- Discovery is an explicit, Windows-only scan of internal VS Code session storage, not an official Copilot-history API. Unsupported/malformed formats are reported as skipped. Other profiles, empty-window sessions, and arbitrary external import paths are excluded.
- One real-data mode is active at a time. Source changes discard pending data. Observation pauses on activation.
- Global command/terminal monitoring and model-assisted classification are not implemented. Owned chat is a local command interface, not an LLM assistant.
- Mining is session-level edit-similarity clustering plus bounded contiguous sequences, not a full process-mining system. Explicit loop semantics and multi-workflow sessions need further work.
- Scores and risk estimates are heuristics, not proof that automation is safe. Required inputs use conservative generic contracts.
- Redaction cannot recognize every secret or identifier. Edited drafts require human review; local storage is not encrypted.
- Retention runs on activation/settings changes, not continuously. Unsupported storage versions require explicit reset.
- Existing skill directories are refused; update/overwrite workflows and remote filesystem export are deferred.
- Generated skills include no executable scripts. Sample Copilot requests are for manual testing; execution results are never fabricated.

## Roadmap

Official adapters when available, advanced process mining, personal cross-workspace skills, anonymized team aggregation, enterprise knowledge graphs, skill versioning/effectiveness, approval governance, Copilot SDK, and permissioned MCP integration. See [the roadmap](docs/roadmap.md).
