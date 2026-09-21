# Demo Guide

## Quick discovery

Version 0.1.0 improves the importer. After consent, choose a source: **Recent workspaces** lists Copilot workspaces by date with chat-session and transcript counts, so you no longer need to know the raw hash folder; **Browse folders**, **Enter a folder path**, and **Pick specific files** remain available. Selecting a workspace hash folder now scans both `chatSessions` and `GitHub.copilot-chat/transcripts`, so the richer transcripts (full question-and-answer turns) are included. Other `GitHub.copilot-chat` subfolders, such as chatEditingSessions, are still excluded. Transcript turns that wrap the user's question in a `request` object are supported; unsupported entries are skipped and reported.

Version 0.0.5 adds **Potential combined skills** to Workflow Explorer. It compares at most 20 repeated families (at least three supporting sessions each) and returns at most 10 pairwise proposals. Families must have the same source and synthetic status, at least two shared stable intents covering half of the larger stable core, distinct variant steps, and the shared core in the same order in every supporting session. This is a structural heuristic, not proof of a common business goal or a handoff. Original workflows remain selectable. Combined drafts include one representative path per variant; do not concatenate them or interpret total session support as combined executions. Proposals require review and remain **Need more evidence** unless risk calls for **Keep manual**.

The session **Action** column distinguishes source-recorded actions from suggestions derived from recognized intents. The local catalog covers all 24 recognized intents and additional phrases for ticket review, stack traces, changes, test reruns, evidence collection, and mitigation planning. Suggestions are not evidence that an action happened. Intent corrections update suggestions. Resource remains optional internal evidence, visible in normalized JSON, and no longer blocks recommendations by itself. Recorded action and outcome evidence are still required for positive recommendations.

Reanalyze existing sessions after upgrading for combination proposals. Action suggestions can be displayed from existing recognized intents without raw text. Previously unrecognized text cannot be reclassified from stored categories alone: a fresh explicit import is necessary for the expanded phrase rules. Avoid retaining the same sessions twice; deduplication only covers overlapping scopes within a scan, not repeated imports. Saved drafts are unchanged.

Version 0.0.3 supports **Choose folders**, **Add another folder path**, and a final **Confirm folders to scan** checklist. Use path entry to add multiple folders when the Windows native dialog only allows one. All folders must remain within the allowed discovery scope; overlapping selections are deduplicated within a scan. The sample limit applies across the combined selection, not separately to each folder.

Imported sessions appear in their own group below demo and observed sessions. A new import is selected for review automatically. The import summary shows pending and approved sessions, event counts, and identified intents. After **Approve and discover**, Workflow Explorer defaults to **Imported** results. Source buttons separate imported, demo, and observed results. Candidate recommendations distinguish detected procedures from skills with sufficient evidence; demo evidence does not increase imported support.

Session labels use normalized intent summaries, not original file names or chat titles, which are not retained. **Not recorded** means the source did not supply a supported action/resource category; **Not confirmed** means no explicit supported outcome was supplied. A **65% keyword heuristic** is a fixed rule score, not measured accuracy. **Removed: path** records path redaction during processing. Raw chat bodies are never retained. Reanalyze existing approved sessions after upgrading to regenerate source-separated candidate identifiers; existing saved drafts remain available.

Version 0.0.2 adds **Enter folder path** as the first scope choice, prefilled with the expanded `%APPDATA%\Code\User\workspaceStorage` path. Paste that environment-variable path, a workspace hash folder beneath it, or its chatSessions folder, with or without quotes. Outside-root paths remain rejected. Browse options remain available, but the OS may restore a previous picker location; path entry avoids that dependency.

Choose **10 files** for an initial preview, or 5, 25, or up to 500. Samples use filename order, not newest-first or inferred relevance. Unselected session contents are not read. The summary reports found file names, loaded sessions, skipped files, and files left unread. A small sample may not yield recommendations. Unsupported-event errors mean a schema mismatch, not necessarily corrupt JSON. Confirm version 0.0.2 in Extensions if the old raw parser error appears instead of a skipped-file summary.

Install the VSIX and reload VS Code. The one-time welcome invitation offers **Import previous sessions**, **Try synthetic demo**, and **Not now**. For a repeat demonstration, use **Import previous sessions** or **Try discovery demo** on Overview; reinstalling does not reset the invitation flag.

For real data, open **Import previous sessions** in a trusted workspace. The native **Analyze my previous Copilot sessions** dialog offers **Preview Sessions**, **Analyze**, or **Cancel**. After consent choose a folder or files in the picker, which starts at `%APPDATA%\Code\User\workspaceStorage`. The root, a workspace hash folder, its chatSessions folder, or direct session JSON/JSONL files are valid scopes. The Sessions view displays actual file, session, and skipped counts. Preview keeps results in memory; inspect, exclude, and **Approve and discover**. Analyze offers a second count-based approval before saving and mining, or a return to preview. No recommended skill is fabricated when evidence is insufficient.

For the browser demo, choose **Try discovery demo**. This immediately analyzes 25 synthetic sessions and shows three detected workflow families. Real file import remains disabled in the browser.

## Detailed walkthrough

1. Run `npm install`, `npm run build`, then press F5 with **Run Extension** selected. In the Extension Development Host open a local scratch workspace.
2. Open **SkillDNA: Open Dashboard**. Show observation off and the Privacy center. No source is automatically enabled.
3. Load the synthetic demo. It contains 25 sessions: 12 support investigations, 7 developer investigations, and 6 incident responses.
4. Review Sessions. Show the normalized event fields, source categories, redaction categories, intent correction, and segmentation reason. All fixtures are explicitly synthetic.
5. Return to Overview and Analyze Workflows.
6. Open Evidence-Based Case Investigation. It has 12 occurrences, 9 stable steps, and 3 optional steps. Authentication and configuration each appear in 6 sessions; escalation appears in 4.
7. Select a step to show source, confidence, preceding/following steps, and the stable/optional explanation. Show the alternate missing-evidence exit, rather than claiming all sessions succeeded.
8. Read the recommendation and component scores. This is a repeatable procedure, not a one-step transformation. Scores are heuristic and no person is ranked.
9. Generate Skill Draft. Review the description, inputs, workflow, conditional paths, validation, privacy, output contract, synthetic example, and provenance.
10. Review all three files using the file tabs. Edit a section or full Markdown. The Mermaid file describes actual observed edges; the template defines the output contract.
11. Run Validate. The untouched demo draft should have zero errors and zero warnings, plus a human-review recommendation. A secret-like edit should block save/export.
12. Check the review acknowledgement and Approve Draft. Select Export Skill. Confirm the destination under `.github/skills/evidence-based-case-investigation/`. Existing folders are refused; rename the reviewed draft to export another version. No scripts run.
13. SKILL.md opens in VS Code. Test manually in Copilot with the synthetic request shown in Skill Review. Supply synthetic evidence yourself or expect the skill to request missing inputs. SkillDNA does not automatically invoke Copilot or claim the skill ran successfully.
14. Record recommendation feedback in Workflow Explorer. Feedback is local and categorical; no prompt text is stored.

## Optional import demonstration

Choose **Import previous sessions**, then **Preview Sessions**, then **Choose folders**. Select one workspace hash folder under the fixed discovery root to keep the first demonstration small, continue with selected folders, and confirm the checklist. Inspect normalized sessions and the skipped-file count before approving. State databases, extension state, chatEditingSessions, unrelated caches, and other files are excluded. Do not move fixtures into VS Code's internal storage to demo imports; use **Try discovery demo** for synthetic data. The parser fixture remains available to tests, but arbitrary file locations are no longer accepted by the native import action.

Check native cancellation manually: dismiss the welcome invitation, cancel consent, cancel scope type, or cancel the picker (no reads or consent change). Cancel the final analysis approval after a scan to discard pending sessions; import consent remains selected with observation paused. Invalid JSON or unsupported JSONL operations should increase the skipped count without importing partial files. Aggregate limits should stop discovery without publishing a partial batch. Outside-root selections and linked paths must fail. A pending batch must be reviewed or discarded before another import. Reloading pauses observation and drops unapproved in-memory sessions.

## Metadata and owned chat

Enable **VS Code activity** and open/save a file inside the workspace. Review pending categories before approving. Pause and verify no further events are collected. Start/Stop Session sets explicit boundaries. The `@skilldna /candidates` and `/analyze` commands remain usable, but chat command collection and its consent option have been removed. Invoking these commands must not add pending observations.

## Browser preview

Run `npm run dev`. The page at <http://127.0.0.1:5173> is an in-memory synthetic-only preview, not the extension host. It supports mining, review, editing, validation, and feedback. Real import, observation, data export, and repository export require VS Code.
