# SkillDNA Hackathon Pitch

[Open the demo](SkillDNA-demo.mp4)

- Runtime: 1:58.02, within the two-minute limit.
- Format: MP4, H.264 video, stereo AAC narration, 1920 x 1080, 30 fps.
- Size: approximately 6.3 MB.
- Microsoft David narration at normal speed with reduced upper-mid emphasis and loudness normalization. This remains synthetic speech, not a human voice recording.
- Visible burned-in captions plus an embedded English subtitle track.
- Controls are selected individually with short pauses; typing is visible at normal speed. Review time is preserved without extending the runtime.
- Scene backgrounds and captions are frame-locked. The demo overlay ends exactly when Impact begins, without overlapping screens. Pitch backgrounds are held still for readability.
- Both Privacy source choices are shown, followed by actual open/save capture, visible inspect/edit events, and approval. Speech is not accelerated.

Play the MP4 in Microsoft Edge or a desktop media player. An [Opus-audio WebM alternative](SkillDNA-demo.webm) is also available.

## Submission

Upload **SkillDNA-demo.mp4 directly to the correct project page in Innovation Studio**. Submit the video file, not an external link. The video has not been uploaded automatically. Check the event's full "Video upload guidance - 6 important things to know" for any additional requirements not visible in the supplied image.

The supplied Innovation Studio project URL returned a work-account sign-in page. No private project description was retrieved or quoted. The pitch uses the user's stated priorities and demonstrated product behavior.

## Timeline

| Time | Section | Content |
| --- | --- | --- |
| 0:00-0:17 | Problem | Expertise gets buried in chats; teammates repeat the cost |
| 0:17-0:35 | Idea | SkillDNA analyzes approved sessions and produces a reusable Copilot skill |
| 0:35-0:43 | Demo | Open the status-bar button; show both Privacy source choices |
| 0:43-0:52 | Demo | Quickly accept import prompts; preview and approve synthetic sessions |
| 0:52-1:02 | Demo | Select VS Code activity; enable observation; open and save a file |
| 1:02-1:15 | Demo | Pause; verify inspect/edit events; approve; open an imported workflow |
| 1:15-1:25 | Demo | Generate a skill and inspect instructions and result template |
| 1:25-1:35 | Demo | Validate files, approve the draft, and show export available |
| 1:35-1:58 | Impact | Reusable team knowledge; optional Copilot review; target fewer tokens |

The user's latest direction prioritizes pacing within two minutes, not filling each recommended time slot. Token savings and efficiency gains are intended benefits, not measured results. Skill instructions themselves also consume tokens. Sharing means distributing a reviewed exported skill, not an automatic team-sharing service. Export is shown as available but is not executed in the video.

## Native Recording Safety

The native footage uses a separate VS Code Extension Development Host, loading this extension's built bundle. Its profile, extension folder, workspace, and APPDATA are isolated in a temporary directory. Only generated synthetic session files are placed in that isolated workspaceStorage tree; the user's normal VS Code history is never scanned or modified. The import dialogs, observation capture, status bar, and skill review are the actual extension, not reconstructed browser controls. The user's normal observation settings and installed extension are unchanged.

At 0:29.4-0:31, the actual captured dropdown screenshot replaces the corresponding native frames because Playwright's video stream omits the native select popup. Observation verification checks recorded action categories, not successful task outcomes. The generated workflow comes from the approved imported examples, not the single observed edit.

## Supporting Files

- [Storyboard and narration](storyboard.json)
- [Subtitle sidecar](SkillDNA-demo.srt)

## Reproduce

Run from the repository root with dependencies installed, Microsoft Edge, Windows SAPI, and Playwright's recording binary (`npx playwright install ffmpeg`). Start the preview with `npm run dev -- --port 5176 --strictPort`.

```powershell
./scripts/narrate-demo.ps1
node scripts/record-native-demo.mjs
node scripts/record-native-demo.mjs --record
node scripts/record-demo.mjs --check
node scripts/record-demo.mjs --render
```

Native recording uses the cached VS Code executable at `.vscode-test/vscode-win32-arm64-archive-1.137.0/Code.exe` and the existing built extension bundle. Rendering requires FFmpeg with H.264/AAC and VP9/Opus support. Set `FFMPEG_PATH` to an existing executable, or use the temporary encoder installed for this recording at `%TEMP%/skilldna-video-tools/package/ffmpeg.exe`. No encoder dependency was added to the extension. Intermediate screenshots, narration, and raw footage are in `render/`.

Verification: native source selection, import, observation, draft generation, and approval passed assertions. Both recorded action cells passed viewport checks. All twelve pitch layout checks passed; narration fits each scene at normal speed. The full MP4 decoded without errors and contains stereo English narration, visible captions, and an English subtitle track. Audio mean volume is -21.9 dBFS and peak is -4.5 dBFS. Encoded frames were visually reviewed, including the final dropdown. These checks cannot verify the computer's speaker volume or selected output device. No extension source, version, or installed VSIX was changed for this video.

The revised capture also verifies slower individual actions and normal-speed typing. Final encoded frames 2579, 2580, and 2581 were inspected: the last demo frame switches directly to Impact, with no outgoing demo over the new background. Workspace selection, sample selection, and the editor were confirmed in the final moving footage.
