# Change Log

All notable changes to the "skilldna" extension will be documented in this file.

## 0.1.2

- Add separate, default-off Copilot suitability review in Privacy with native disclosure, model selection, and window-session permission.
- Review minimized approved workflow summaries asynchronously after explicit analysis. Show status, advisory recommendations, missing evidence and risks without overriding local scoring or human approval.
- Bound requests, validate model output, cache unchanged results in memory, cancel stale work, and retain local analysis when models are unavailable.
- Exclude demo videos and voice recordings from the extension package.

## 0.1.1

- Add Delete all imported sessions in the Sessions view, with confirmation. It removes imported sessions and their derived candidates, drafts, and feedback while keeping demo and observed data.
- Remove the redundant second confirmation after choosing Recent workspaces in the import picker.

## 0.1.0

- Include Copilot transcripts (`<hash>/GitHub.copilot-chat/transcripts/*.json[l]`) as an allowlisted discovery source. Selecting a workspace folder scans both chat sessions and transcripts. Other GitHub.copilot-chat subfolders remain excluded.
- Parse transcript turns that wrap the user's question in a `request` object; unsupported entries are skipped and reported.
- Improve the import picker: a Recent workspaces list shows Copilot workspaces by date with chat-session and transcript counts, alongside Browse folders, Enter a folder path, and Pick specific files.

## 0.0.9

- Add independent, keyboard-accessible collapse controls to Detected workflows and Workflow cards; keep the selected review pane visible.
- Show Need more info with a short reason on workflow cards and shorten empty-combination descriptions. Detailed review explanations and scoring are unchanged.

## 0.0.8

- Remove the inherited second divider and excess spacing in collapsible session groups.
- Explain workflow combination criteria in plain language and distinguish alternative procedures from sequential handoffs.
- Show the existing missing-evidence reason directly on workflow cards. Matching and recommendation rules are unchanged.

## 0.0.7

- Demo, observed, and imported session headings expand and collapse their lists independently, with native disclosure arrows and keyboard support.
- Collapsing a group preserves its sessions, approval selections, and the current review pane. Groups start expanded when the Sessions view mounts.

## 0.0.6

- Always show Potential combined skills, including an explicit no-compatible-combinations result after analysis.
- Empty results include source-filtered workflow family and repeated-family counts. The wording describes the current rules rather than claiming combination is impossible.

## 0.0.5

- Propose potential combined skills from repeated same-source workflow families with a substantial ordered shared core; retain originals and distinct variant evidence.
- Combined drafts preserve representative alternative paths and explicitly distinguish support across variants from combined executions. Suggestions remain subject to review, not automatic skill recommendations.
- Expand the local phrase catalog and map all 24 recognized intents to suggested actions. Suggested actions never overwrite recorded actions, prove execution, or fill missing outcome evidence.
- Remove Recorded resource from the main review table; keep the optional category in normalized evidence. Missing resource alone no longer blocks a recommendation.
- Reanalyze approved sessions for combination proposals. Existing recognized intents receive action suggestions in the UI; new phrase rules require a fresh import because raw text is not retained. Repeated imports are not deduplicated across scans.

## 0.0.4

- Explicit no-recognizable-workflow result for imported sessions, before and after approval.
- Replace visible unknown intent/action labels with missing-evidence wording; normalized JSON retains the original schema values.
- Missing action, resource, or outcome metadata requires more evidence before a positive recommendation. Known high-risk evidence still takes precedence. Feedback cannot bypass this check.
- Risk scores remain lower bounds, not proof of low risk. Reanalyze existing approved sessions to apply the updated recommendations; saved drafts are unchanged.

## 0.0.3

- Multi-folder selection, additional folder-path input, and a final folder checklist before scanning.
- Separate demo, observed, and imported session groups; imported sessions remain last and are selected for review after import.
- Imported evidence counts and source-filtered workflow candidates and recommended skills.
- Plain-language missing-metadata labels and explicit heuristic confidence labels.
- Source-separated workflow identities prevent demo/import selection and draft collisions.
- Responsive imported-session review with a horizontally scrollable evidence table.

## 0.0.2

- Consent-gated Copilot discovery restricted to workspace identifiers and direct chatSessions JSON/JSONL files.
- Folder-path input prefilled with Windows VS Code workspace storage, including %APPDATA% expansion.
- Small samples of 5, 10, or 25 files, or up to 500, with unread and skipped counts.
- Native JSONL mutation-log support and removal of chat-command collection.

## 0.0.1

- Local-only workflow discovery with 25 synthetic sessions and explainable scoring.
- Consent-gated imports, owned chat commands, and editor metadata previews.
- Editable skill drafts, privacy/structure validation, and explicitly approved export.
- React dashboard, privacy center, unit/integration/browser/extension-host tests.
