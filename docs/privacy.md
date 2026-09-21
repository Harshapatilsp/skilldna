# Privacy and Threat Model

## Default and consent

Observation defaults to off and is paused every time the extension activates. The modes are off, demo-only, metadata-only, and user-imported-content. Chat command collection has been removed; legacy chat-collection consent is reset to off on activation. Only one mode is active at a time. Enabling a real-data source requires a native confirmation in a trusted workspace. Selecting files and approving normalized sessions are separate actions. A pending batch can be excluded or discarded before analysis.

Demo data is explicitly synthetic. It can be explored without approving user-data collection. Local analysis makes no model calls. Optional Copilot suitability review is a separate, default-off external-processing permission; there is no telemetry.

## Optional Copilot processing

Privacy offers **Review workflow suitability with Copilot**. Enabling requires a trusted workspace, a native disclosure confirmation, VS Code model access consent, and selection of an available Copilot model. It authorizes reviews of existing approved candidates and later explicit analysis actions in this window session, not continuous monitoring. No API key is collected by SkillDNA.

The outbound allowlist is version, independent-session count, combined-variant flag, local recommendation, up to 24 categorical steps (intent, action, occurrence rate, stable flag), omitted-step count, resource categories, outcome counts, and unknown-action count. Every supporting session must already be approved. Names, identifiers, timestamps, paths, bodies, free-text input/output labels, and raw model prompts from imported sessions are excluded. Categories may still reveal work patterns. Requests go through the selected Copilot provider and consume quota; provider retention and organizational policies apply. This option is not local-only.

Requests are sequential, limited to ten candidates per analysis, 12,000 summary characters, at most 4,000 input tokens (subject to the selected model's context limit), 8,000 received response characters, and a 45-second timeout. No tools are supplied. Responses must match a strict JSON schema and are displayed as text, never executed or used to overwrite local scores. The model sees limited evidence and can be wrong. It cannot establish success or substitute for human approval.

Consent, model selection, and review cache exist only in extension-host memory. Unchanged summaries reuse results during this session. Disabling cancels pending requests and clears reviews. Source-evidence mutation/deletion clears reviews conservatively; full deletion also disables Copilot review. Already sent data cannot be recalled. Reopening the window requires opting in again. Reviews are excluded from local storage and Export My Data. Access failures, unavailable models, timeout, quota, and invalid responses leave local analysis intact. Tests use synthetic evidence and mocked responses; they do not send customer sessions to live models.

The extension activates after VS Code startup and shows a one-time invitation, not an automatic history scan. An `onboardingShown` boolean is stored in extension global state to avoid repeated invitations; it contains no session content and is not cleared by Delete All Data. Import requires a trusted workspace, native consent, and explicit scope selection before reading. Cancelling consent or the picker does not change consent or read session files. Preview Sessions retains normalized data only in memory. Analyze asks for a second approval of the discovered count before saving and mining; it also offers preview or cancellation. Cancelling that final approval discards pending data. Approve and discover in Sessions saves only selected sessions.

## Discovery allowlist

Discovery is Windows-only with the fixed root `%APPDATA%\Code\User\workspaceStorage`. Folder-path input is prefilled with the expanded root and accepts %APPDATA% and optional quotes. Browsing requests that initial location, but the OS may restore a previous picker location. The user may select the root, a 32-character hexadecimal workspace folder, its direct chatSessions folder, or direct JSON/JSONL session files within it. Selections outside this scope are rejected. The sample selector offers 5, 10 (first choice), 25, or up to 500 files in filename order. Session contents beyond the sample are not read; directory entries are enumerated to report available and unread counts.

Only `<hash>/workspace.json` (optional, capped at 64 KB), `<hash>/chatSessions/*.json` or `*.jsonl`, and `<hash>/GitHub.copilot-chat/transcripts/*.json` or `*.jsonl` are read. Workspace identifiers are parsed transiently, never followed as filesystem destinations or retained in normalized data. Directory listings are limited to the root, workspace hash folders, direct chatSessions folders, and direct GitHub.copilot-chat/transcripts folders. Symbolic links and junctions are rejected or skipped; resolved paths must stay within the root.

Selecting a workspace hash folder scans both its chat sessions and its Copilot transcripts. Other `GitHub.copilot-chat` subfolders, such as chatEditingSessions, remain outside the allowlist.

State databases, extension state, unrelated caches, other workspace files, chatEditingSessions, nested session subdirectories, empty-window/global storage, and other VS Code profiles/installations are outside this allowlist. The allowlist governs source discovery, not SkillDNA's own local state storage or user-approved exports.

## Collected and excluded data

Retained event fields are allowlisted controlled categories: action, intent, resource, tool, outcome, timestamp, confidence, optional duration, consent, classification method, redaction categories, and opaque event/session links. Source files are never modified. Metadata capture uses file category only, never file contents or full paths. It is limited to files in the open workspace plus supported task/debug lifecycle events. The @skilldna participant does not record interactions.

No live Copilot chat monitoring, keystroke collection, terminal monitoring, or employee productivity scores are implemented. An approved discovery scan reads previous conversations contained in the selected session scope, which can include sensitive prompts and responses. Raw import text is transiently processed in local memory, then discarded; it is never persisted or uploaded by SkillDNA. Tool-result structures are not interpreted as standalone workflow events.

## Redaction limits

The pipeline detects common private keys, passwords, bearer tokens, token formats, connection strings, emails, labeled customer/tenant/case/subscription identifiers, GUIDs, and common absolute paths. It uses typed placeholders for transient analysis and records category names, not matched values. Generic technical language is tested against false positives.

Detection is best effort. Arbitrary names, novel secrets, and proprietary facts cannot be reliably recognized by regex. Allowlisted normalized fields and curated generated instructions are the primary leak-prevention mechanisms. User-edited drafts can still contain unrecognized sensitive text. Review every supporting file. Automated validation cannot prove anonymity, correctness, or safe tool use.

## Storage, retention, and deletion

Data is stored in `ExtensionContext.storageUri` for the open workspace, falling back to `globalStorageUri` only without a workspace. Local JSON writes are serialized and atomically replaced. No raw-content backups are created. This is not encrypted storage; protect the OS account, device, backups, and extension host.

Default retention is 30 days, configurable from 1 to 365. Expiration occurs when the extension activates or retention settings are saved; synthetic fixtures are exempt. If real sessions expire, derived candidates, drafts, and feedback are cleared conservatively. The MVP is not a background retention daemon.

Delete All Data removes persisted state and pending memory, resets consent, and deletes audit history. It deliberately does not preserve a deletion audit record after full erasure. Single-session deletion also clears derived candidates/drafts/feedback. Export My Data includes persisted normalized state and saved user-reviewed drafts, excludes pending data, and writes only to the selected location. Exported skills and data exports are user-managed copies and are not deleted by extension data deletion.

## Threat boundaries

Mitigations cover accidental overcollection, malformed imports, common identifiers/secrets, webview command injection, traversal and symlink paths, and unintended overwrite/execution. Discovery lists at most 20,000 session file names and reads at most the chosen sample of 500 session files, 5 MB/file, 50 MB of session content/scan, 10,000 events, 500 normalized sessions, and 200 events/session. Invalid, oversized, and unsupported files are reported as skipped; aggregate limit failures do not publish a partial batch. Pending live observation caps at 200 events. Generated files are treated as drafts, never executed.

Not covered: a compromised VS Code/OS account, malicious extensions with disk access, concurrent filesystem substitution by local malware, unrecognized secrets, or semantically harmful instructions manually added after review. Normalized patterns can still reveal work habits. Exporting them should be an intentional decision.

## Prototype integrations

This is an opt-in adapter for internal VS Code storage, not an official Copilot-history API; formats can change. Supported root fields are sessions, conversations, events, messages, or requests. Native request.message.text and textual response parts are normalized. Current JSONL initial/set/push/delete mutation operations are reconstructed with bounded paths and prototype-access rejection. Malformed or unknown operations cause the entire file to be skipped, not partially imported. When both JSON and JSONL exist for the same basename, JSONL is preferred and the JSON copy is skipped. Re-importing the same scope in separate scans can still create duplicate normalized sessions; inspect existing data before repeating an import.

Format references: [VS Code session store](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/model/chatSessionStore.ts) and [mutation log](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/model/objectMutationLog.ts). The adapter is not an endorsement or stable compatibility guarantee from VS Code.
