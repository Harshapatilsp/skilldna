import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs/video');
const render = join(output, 'render');
const scenes = JSON.parse(await readFile(join(output, 'storyboard.json'), 'utf8'));
const duration = scenes.reduce((total, scene) => total + scene.duration, 0);
assert(duration > 0 && duration < 120, 'The pitch must remain under two minutes');
const firstDemo = scenes.findIndex(scene => scene.chapter === 'DEMO');
const demoStart = scenes.slice(0, firstDemo).reduce((total, scene) => total + scene.duration, 0);
const demoScenes = scenes.filter(scene => scene.chapter === 'DEMO');
const demoDuration = demoScenes.reduce((total, scene) => total + scene.duration, 0);
const demoEnd = demoStart + demoDuration;
const encoder = process.env.FFMPEG_PATH ?? join(tmpdir(), 'skilldna-video-tools/package/ffmpeg.exe');
const mode = process.argv[2] ?? '--check';
assert(['--check', '--record', '--render'].includes(mode));
await mkdir(render, { recursive: true });

function encode(args) {
  const result = spawnSync(encoder, ['-hide_banner', '-y', ...args], {
    encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return result.stderr;
}

function wavDuration(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
  let byteRate = 0;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const tag = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (tag === 'fmt ') byteRate = buffer.readUInt32LE(offset + 16);
    if (tag === 'data') dataSize = size;
    offset += 8 + size + size % 2;
  }
  assert(byteRate > 0 && dataSize > 0);
  return dataSize / byteRate;
}

function timecode(seconds) {
  const milliseconds = Math.round(seconds * 1000);
  return `${String(Math.floor(milliseconds / 3600000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')},${String(milliseconds % 1000).padStart(3, '0')}`;
}

let elapsed = 0;
const captions = [];
for (const scene of scenes) {
  scene.voiceDuration = wavDuration(await readFile(join(render, `${scene.id}.wav`)));
  assert(scene.voiceDuration < scene.duration - 0.2, `${scene.id}: narration exceeds scene`);
  scene.captions = [];
  const phrases = scene.narration.match(/[^.!?]+[.!?]+/g).map((phrase) => phrase.trim());
  const words = phrases.map((phrase) => phrase.split(/\s+/).length);
  const wordCount = words.reduce((total, count) => total + count, 0);
  let phraseStart = 0;
  for (const [index, phrase] of phrases.entries()) {
    const phraseEnd = phraseStart + scene.voiceDuration * words[index] / wordCount;
    scene.captions.push({ start: phraseStart, end: phraseEnd, text: phrase });
    captions.push(`${captions.length + 1}\n${timecode(elapsed + phraseStart)} --> ${timecode(elapsed + phraseEnd)}\n${phrase}\n`);
    phraseStart = phraseEnd;
  }
  elapsed += scene.duration;
}
await writeFile(join(output, 'SkillDNA-demo.srt'), captions.join('\n'));

if (mode === '--render') {
  const frameRate = 30;
  const sceneFrames = scenes.map(scene => Math.round(scene.duration * frameRate));
  const backgroundFilters = scenes.map((scene, index) =>
    `[${index}:v]fps=${frameRate},trim=end_frame=${sceneFrames[index]},setpts=PTS-STARTPTS,setsar=1[scene${index}]`);
  const subtitleTime = seconds => {
    const centiseconds = Math.round(seconds * 100);
    return `${Math.floor(centiseconds / 360000)}:${String(Math.floor(centiseconds / 6000) % 60).padStart(2, '0')}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
  };
  let captionOffset = 0;
  const subtitleEvents = scenes.flatMap(scene => {
    const events = scene.captions.map(caption =>
      `Dialogue: 0,${subtitleTime(captionOffset + caption.start)},${subtitleTime(captionOffset + caption.end)},Default,,0,0,0,,${caption.text}`);
    captionOffset += scene.duration;
    return events;
  });
  const subtitlePath = join(render, 'frame-locked.ass');
  await writeFile(subtitlePath, `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Segoe UI,30,&H00FFFFFF,&H00FFFFFF,&H001F2512,&H001F2512,0,0,0,0,100,100,0,0,1,1,0,2,55,55,18,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${subtitleEvents.join('\n')}\n`);
  const subtitleFilterPath = subtitlePath.replaceAll('\\', '/').replace(':', '\\:');
  backgroundFilters.push(`${scenes.map((_, index) => `[scene${index}]`).join('')}concat=n=${scenes.length}:v=1:a=0,ass=filename='${subtitleFilterPath}',format=yuv420p[background]`);
  const backgroundPath = join(render, 'frame-locked-background.mp4');
  encode([...scenes.flatMap(scene => ['-loop', '1', '-framerate', String(frameRate), '-i', join(render, `${scene.id}-base.png`)]),
    '-filter_complex', backgroundFilters.join(';'), '-map', '[background]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-frames:v', String(sceneFrames.reduce((total, count) => total + count, 0)), backgroundPath]);
  const nativeRecording = JSON.parse(await readFile(join(render, 'native-recording.json'), 'utf8'));
  const nativeInfo = spawnSync(encoder, ['-hide_banner', '-i', nativeRecording.path], { encoding: 'utf8' }).stderr;
  const nativeMatch = nativeInfo.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  assert(nativeMatch, nativeInfo);
  const nativeDuration = Number(nativeMatch[1]) * 3600 + Number(nativeMatch[2]) * 60 + Number(nativeMatch[3]);
  const nativeLead = Math.max(0, nativeDuration - nativeRecording.elapsed);
  const inputs = scenes.flatMap((scene) => ['-i', join(render, `${scene.id}.wav`)]);
  const audioFilters = scenes.map((scene, index) =>
    `[${index + 1}:a]apad,atrim=duration=${scene.duration},asetpts=PTS-STARTPTS[audio${index}]`);
  const audioConcat = scenes.map((_, index) => `[audio${index}]`).join('');
  const nativeEdits = [
    { id: 'sessions', ranges: [[0, 8]] },
    { id: 'workflows', ranges: [[8, 17]] },
    { id: 'steps', ranges: [[17, 27]] },
    { id: 'generate', ranges: [[27, 40]] },
    { id: 'files', ranges: [[40, 50]] },
    { id: 'approve', ranges: [[50, 60]] },
  ];
  for (const [index, edit] of nativeEdits.entries()) {
    assert.equal(edit.id, demoScenes[index].id);
    const keptSeconds = edit.ranges.reduce((total, [start, end]) => total + end - start, 0);
    assert(Math.abs(keptSeconds - demoScenes[index].duration) < 0.001, `${edit.id}: video and narration timelines differ`);
  }
  const ranges = nativeEdits.flatMap(edit => edit.ranges);
  const nativeFilters = [
    `[${scenes.length + 2}:v]setpts=${60 / nativeRecording.elapsed}*(PTS-STARTPTS),split=${ranges.length}${ranges.map((_, index) => `[source${index}]`).join('')}`,
    ...ranges.map(([start, end], index) => `[source${index}]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[cut${index}]`),
    `${ranges.map((_, index) => `[cut${index}]`).join('')}concat=n=${ranges.length}:v=1:a=0,setpts=PTS+${demoStart}/TB,scale=1664:936,setsar=1[native]`,
  ];
  const filters = [
    ...audioFilters,
    `${audioConcat}concat=n=${scenes.length}:v=0:a=1,highpass=f=75,equalizer=f=3500:t=q:w=1:g=-2,lowpass=f=8500,loudnorm=I=-16:TP=-1.5:LRA=7[audio]`,
    `[0:v]setpts=PTS-STARTPTS,fps=30,format=yuv420p[base]`,
    ...nativeFilters,
    `[base][native]overlay=x=128:y=80:enable='gte(t,${demoStart})*lt(t,${demoEnd})':eof_action=pass[walkthrough]`,
    `[${scenes.length + 3}:v]scale=1664:936,setsar=1[choices]`,
    `[walkthrough][choices]overlay=x=128:y=80:enable='gte(t,${demoStart + 3.4})*lt(t,${demoStart + 5})'[video]`,
  ].join(';');
  console.log(`Rendering ${duration}s MP4 with frame-locked scenes; Impact starts at frame ${demoEnd * frameRate}.`);
  const voicedVideo = join(output, 'SkillDNA-demo.mp4');
  encode(['-i', backgroundPath, ...inputs,
    '-i', join(output, 'SkillDNA-demo.srt'),
    '-ss', String(nativeLead), '-i', nativeRecording.path,
    '-i', join(render, 'native-source-choices.png'),
    '-filter_complex', filters, '-map', '[video]', '-map', '[audio]', '-map', `${scenes.length + 1}:s:0`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-c:a', 'aac', '-b:a', '160k',
    '-ar', '48000', '-ac', '2', '-c:s', 'mov_text',
    '-metadata:s:a:0', 'language=eng', '-metadata:s:a:0', 'title=English narration',
    '-disposition:a:0', 'default', '-metadata:s:s:0', 'language=eng',
    '-metadata:s:s:0', 'title=English captions',
    '-t', String(duration), '-movflags', '+faststart',
    '-metadata', 'title=SkillDNA | Capture the method. Share the skill. Move forward together.',
    '-metadata', 'comment=Real VS Code extension in isolated development host with synthetic import files; offline David narration; benefits unmeasured.',
    voicedVideo]);
  console.log('Rendered narrated MP4 with visible captions and an English subtitle track.');
  encode(['-i', voicedVideo, '-map', '0:v:0', '-map', '0:a:0',
    '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '6', '-crf', '30', '-b:v', '0',
    '-c:a', 'libopus', '-b:a', '128k', '-ac', '2', '-t', String(duration),
    '-metadata:s:a:0', 'language=eng', join(output, 'SkillDNA-demo.webm')]);
  console.log('Rendered Opus-audio WebM for browser playback.');
} else {
  const check = mode === '--check';
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
    ...(check ? {} : { recordVideo: { dir: render, size: { width: 1920, height: 1080 } } }),
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(process.env.DEMO_URL ?? 'http://127.0.0.1:5176/');
    await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SkillDNA demo recording</title>
      <style>
      *{box-sizing:border-box}body{margin:0;background:#12251f;color:#f6faf7;font-family:'Segoe UI',sans-serif;letter-spacing:0;overflow:hidden}
      header{height:140px;padding:20px 38px;display:flex;align-items:center;gap:34px;border-bottom:4px solid #72e4ae}
      #chapter{width:124px;color:#92e6bf;font-size:22px;font-weight:700}h1{font-family:'Bahnschrift','Segoe UI',sans-serif;font-size:36px;line-height:1.2;margin:0 0 8px;font-weight:650}
      #subtitle{font-size:22px;color:#c0cdc6}.badge{margin-left:auto;white-space:nowrap;text-align:right;font-size:19px;line-height:1.7;color:#cfdbd5}
      iframe{position:absolute;left:0;top:140px;width:1920px;height:788px;border:0;background:#fff}
      #pitch{position:absolute;inset:140px 0 152px;background:#f2f6f3;color:#12251f;z-index:5;padding:66px 100px;overflow:hidden}
      #pitch[hidden]{display:none}#pitch-label{color:#a34232;font-size:24px;font-weight:700;text-transform:uppercase;margin-bottom:24px}
      #pitch h2{font-family:'Bahnschrift','Segoe UI',sans-serif;font-size:72px;line-height:1.14;max-width:1660px;margin:0 0 44px}
      #beats{display:grid;grid-template-columns:repeat(3,1fr);gap:36px} .beat{border-top:7px solid #16765c;padding:24px 0;min-width:0}
      .beat:nth-child(2){border-color:#d97754}.beat:nth-child(3){border-color:#6b62a7}
      .beat strong{display:block;font-size:35px;line-height:1.25;margin-bottom:16px}.beat p{font-size:26px;line-height:1.4;color:#44564d;margin:0;max-width:490px}
      #pitch-note{position:absolute;left:100px;bottom:42px;font-size:23px;color:#44564d}
      footer{position:absolute;top:928px;left:0;right:0;height:152px;padding:20px 90px 28px;display:flex;align-items:center;justify-content:center}
      #caption{max-width:1620px;font-size:31px;line-height:1.35;text-align:center;font-weight:500}
      #native-preview{position:absolute;left:128px;top:80px;width:1664px;height:936px;object-fit:fill;display:none}
      body.native-demo header{height:80px;padding:10px 30px;gap:22px}body.native-demo h1{font-size:30px;margin:0}
      body.native-demo #subtitle{display:none}body.native-demo .badge{font-size:16px}body.native-demo #chapter{font-size:20px}
      body.native-demo footer{top:1016px;height:64px;padding:4px 60px}body.native-demo #caption{font-size:25px;line-height:1.15;max-width:1750px}
      body.native-demo #native-preview{display:block}body.native-demo iframe{visibility:hidden}
      #progress{position:absolute;bottom:0;left:0;height:5px;background:#e2ba62;width:0}
      #cursor{position:fixed;z-index:20;width:28px;height:28px;border:3px solid #0b6f52;border-radius:50%;background:#6dffc855;pointer-events:none;left:1750px;top:180px;box-shadow:0 0 0 3px #fff9;transform:translate(-50%,-50%)}
      </style></head><body>
      <header><div id="chapter">PROBLEM</div><div><h1>SkillDNA</h1><div id="subtitle">Why explain the same task twice?</div></div><div class="badge">SkillDNA<br>HACKATHON 2026</div></header>
      <iframe title="Live SkillDNA synthetic demo" src="${process.env.DEMO_URL ?? 'http://127.0.0.1:5176/'}"></iframe>
      <img id="native-preview" alt="Recorded native VS Code demonstration" />
      <section id="pitch" hidden><div id="pitch-label"></div><h2></h2><div id="beats"></div><div id="pitch-note"></div></section>
      <footer><div id="caption"></div></footer><div id="progress"></div><div id="cursor"></div>
      </body></html>`);
    const app = page.frameLocator('iframe');
    await expect(app.getByRole('heading', { level: 1 })).toBeVisible();
    await app.locator('body').evaluate((body) => { body.style.zoom = '1.18'; });
    await page.evaluate(() => {
      const cursor = document.getElementById('cursor');
      window.addEventListener('mousemove', (event) => {
        cursor.style.left = `${event.clientX}px`;
        cursor.style.top = `${event.clientY}px`;
      });
      const frame = document.querySelector('iframe');
      frame.contentWindow.addEventListener('mousemove', (event) => {
        cursor.style.left = `${event.clientX}px`;
        cursor.style.top = `${event.clientY + 140}px`;
      });
    });
    async function pace(seconds) {
      await page.evaluate(async (milliseconds) => {
        await document.getElementById('cursor').animate(
          [{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }],
          { duration: milliseconds, easing: 'ease-in-out' },
        ).finished;
      }, check ? 40 : seconds * 1000);
    }
    async function click(locator) {
      await locator.scrollIntoViewIfNeeded();
      const bounds = await locator.boundingBox();
      assert(bounds);
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 20 });
      await locator.click();
    }
    async function navigate(name) {
      await click(app.getByRole('navigation').getByRole('button', { name: new RegExp(`^${name}(?:\\s|$)`) }));
      await app.locator('body').evaluate(() => window.scrollTo(0, 0));
    }
    async function focus(locator, offset = 25) {
      await locator.evaluate((element, margin) => {
        window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - margin, behavior: 'instant' });
      }, offset);
    }
    const pitches = {
      problem: {
        label: 'The cost of lost team knowledge', heading: 'You solved this before. Your team starts over.',
        beats: [['The expert solves it', 'A useful process emerges through trial and correction.'], ['The method gets buried', 'Instructions stay inside a conversation.'], ['The cost repeats', 'The next teammate rebuilds the same context.']],
        note: 'Illustrative everyday scenario',
      },
      'early-demo': {
        label: 'The hidden cost of starting over', heading: 'Same process. Repeated instructions.',
        beats: [['More typing', 'Rebuild the context each time.'], ['More tokens', 'Repeat instructions and corrections.'], ['Lost know-how', 'The method stays in old chats.']],
        note: 'The opportunity: reuse the method, not the whole conversation.',
      },
      idea: {
        label: 'Meet SkillDNA', heading: 'Turn previous work into a Copilot skill.',
        beats: [['1 / Watch your work', 'Analyze approved sessions on your machine.'], ['2 / Find the pattern', 'Detect the steps you repeat across sessions.'], ['3 / Save the skill', 'Generate reviewable instructions plus a result template.']],
        note: 'A local-first VS Code extension. Nothing leaves your machine without approval.',
      },
      privacy: {
        label: 'How it helps every day', heading: 'A head start for you. And your team.',
        beats: [['Troubleshoot a bug', 'Start with a familiar checklist.'], ['Review a case', 'Follow the steps. Keep room for exceptions.'], ['Help a teammate', 'Share the reviewed playbook.']],
        note: 'Choose the sessions. Keep analysis local. Copilot review is opt-in.',
      },
      impact: {
        label: 'Why it matters', heading: 'Stop paying to rediscover the same process.',
        beats: [['Fewer repeated prompts', 'Reuse instructions across chats and teammates.'], ['Team-ready skills', 'Copilot can score each workflow before you share it.'], ['Knowledge that compounds', 'Improve the shared playbook instead of restarting.']],
        note: 'Measure tokens per completed task and handoff time. Copilot review is opt-in; skills also consume tokens.',
      },
      close: {
        label: 'SkillDNA / From individual work to team knowledge', heading: 'Capture the method. Share the skill. Move forward together.',
        beats: [['You discover it', 'Find the useful pattern in your work.'], ['Others reuse it', 'Share a skill your team can review.'], ['The team improves it', 'Refine the playbook as you learn.']],
        note: 'Export a reviewed skill. Share the method. Keep improving it together.',
      },
    };
    const actions = {
      problem: async () => {
        await expect(page.locator('#pitch')).toContainText('You solved this before');
      },
      'early-demo': async () => {
        await expect(page.locator('#pitch')).toContainText('More tokens');
      },
      idea: async () => {
        await expect(page.locator('#pitch')).toContainText('Save the skill');
      },
      privacy: async () => {
        await expect(page.locator('#pitch')).toContainText('Help a teammate');
      },
      sessions: async () => {
        await pace(1.6);
        await click(app.getByRole('button', { name: 'Try discovery demo', exact: true }));
        await expect(app.getByRole('heading', { name: '25 approved sessions analyzed' })).toBeVisible();
        await expect(app.getByRole('region', { name: 'Discovery results' }).getByRole('listitem')).toHaveCount(3);
      },
      workflows: async () => {
        await navigate('Workflows');
        await pace(2);
        await click(app.locator('.candidate').filter({ hasText: 'Evidence-Based Case Investigation' }));
        await focus(app.locator('.workflow-detail'));
        await expect(app.locator('.workflow-detail')).toContainText('12 approved sessions');
      },
      steps: async () => {
        await click(app.locator('.step.optional').first());
        await focus(app.locator('.flow-layout'));
        await expect(app.locator('.node-detail')).toContainText('retained as a conditional path');
      },
      generate: async () => {
        await pace(1);
        await click(app.getByRole('button', { name: 'Generate skill draft', exact: true }));
        await app.locator('body').evaluate(() => window.scrollTo(0, 0));
        await expect(app.getByRole('heading', { name: 'Skill review', exact: true })).toBeVisible();
        await click(app.getByRole('button', { name: 'Preview', exact: true }));
        await focus(app.locator('.file-tabs'));
      },
      files: async () => {
        await click(app.getByRole('button', { name: 'references/workflow.mmd', exact: true }));
        await focus(app.locator('.file-tabs'));
        await expect(app.locator('.markdown-preview')).toContainText('flowchart');
        await pace(3);
        await click(app.getByRole('button', { name: 'templates/result-template.md', exact: true }));
        await focus(app.locator('.file-tabs'));
        await expect(app.locator('.markdown-preview')).not.toBeEmpty();
      },
      approve: async () => {
        await click(app.getByRole('button', { name: 'Validate', exact: true }));
        await focus(app.locator('.review-approval'));
        await expect(app.getByRole('heading', { name: 'errors (0)', exact: true })).toBeVisible();
        await pace(2);
        await click(app.getByRole('checkbox'));
        await click(app.getByRole('button', { name: 'Approve draft', exact: true }));
        await expect(app.getByRole('button', { name: 'Export skill', exact: true })).toBeEnabled();
        await expect(app.locator('.draft-toolbar .badge')).toHaveText('approved');
        await focus(app.locator('.review-approval'));
      },
      impact: async () => {
        await expect(page.locator('#pitch')).toContainText('Team-ready skills');
      },
      close: async () => {
        await expect(page.locator('#pitch')).toContainText('Others reuse it');
      },
    };
    const start = Date.now();
    let sceneEnd = 0;
    for (const scene of scenes) {
      const sceneStart = sceneEnd;
      sceneEnd += scene.duration;
      console.log(`${sceneStart}s: ${scene.chapter} / ${scene.title}`);
      await page.evaluate(({ scene, sceneStart, totalDuration, quick, pitch, assetRoot }) => {
        document.body.classList.toggle('native-demo', scene.chapter === 'DEMO');
        const nativeImages = { sessions: 'native-source-import', workflows: 'native-import-preview', steps: 'native-observation', generate: 'native-observed-session', files: 'native-dashboard', approve: 'native-dashboard' };
        if (scene.chapter === 'DEMO') document.getElementById('native-preview').src = `/@fs/${assetRoot}/docs/video/render/${nativeImages[scene.id]}.png`;
        const panel = document.getElementById('pitch');
        panel.hidden = !pitch;
        document.getElementById('cursor').style.display = 'none';
        if (pitch) {
          document.getElementById('pitch-label').textContent = pitch.label;
          panel.querySelector('h2').textContent = pitch.heading;
          document.getElementById('pitch-note').textContent = pitch.note;
          const beats = document.getElementById('beats');
          beats.replaceChildren(...pitch.beats.map(([title, description], index) => {
            const beat = document.createElement('div');
            beat.className = 'beat';
            const heading = document.createElement('strong');
            heading.textContent = title;
            const text = document.createElement('p');
            text.textContent = description;
            beat.append(heading, text);
            beat.animate([{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }],
              { duration: quick ? 1 : 380, delay: quick ? 0 : 150 + index * 350, fill: 'both', easing: 'ease-out' });
            return beat;
          }));
          panel.querySelector('h2').animate([{ opacity: 0, transform: 'translateX(-24px)' }, { opacity: 1, transform: 'translateX(0)' }],
            { duration: quick ? 1 : 500, fill: 'both', easing: 'ease-out' });
        }
        document.getElementById('chapter').textContent = scene.chapter;
        document.querySelector('h1').textContent = scene.title;
        document.getElementById('subtitle').textContent = scene.subtitle;
        document.getElementById('caption').textContent = scene.captions[0].text;
        document.getElementById('progress').getAnimations().forEach((animation) => animation.cancel());
        document.getElementById('progress').animate([
          { width: `${sceneStart / totalDuration * 100}%` },
          { width: `${(sceneStart + scene.duration) / totalDuration * 100}%` },
        ], { duration: quick ? 100 : scene.duration * 1000, fill: 'forwards', easing: 'linear' });
        const began = performance.now();
        window.sceneId = scene.id;
        function update(now) {
          if (window.sceneId !== scene.id || quick) return;
          const seconds = (now - began) / 1000;
          const phrase = scene.captions.find((caption) => seconds >= caption.start && seconds < caption.end);
          document.getElementById('caption').textContent = phrase?.text ?? '';
          if (seconds < scene.duration) requestAnimationFrame(update);
        }
        requestAnimationFrame(update);
      }, { scene, sceneStart, totalDuration: duration, quick: check, pitch: pitches[scene.id], assetRoot: root.replaceAll('\\', '/') });
      if (scene.chapter === 'DEMO') {
        await page.locator('#native-preview').evaluate(async image => { await image.decode(); if (!image.naturalWidth) throw new Error('Native preview is blank'); });
      } else await actions[scene.id]();
      assert.equal(await app.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('#caption').evaluate((element) => element.scrollHeight <= 130), true);
      if (pitches[scene.id]) assert.equal(await page.locator('#pitch').evaluate((element) => element.scrollHeight <= element.clientHeight), true);
      await page.screenshot({ path: join(render, `${scene.id}.png`) });
      await page.locator('#caption').evaluate(element => { element.style.visibility = 'hidden'; });
      await page.locator('#pitch').evaluate(element => {
        for (const animation of element.getAnimations({ subtree: true })) animation.finish();
      });
      await page.screenshot({ path: join(render, `${scene.id}-base.png`) });
      await page.locator('#caption').evaluate(element => { element.style.visibility = ''; });
      if (!check) {
        const remaining = sceneEnd - (Date.now() - start) / 1000;
        assert(remaining > 0, `${scene.id} actions exceeded scene duration`);
        await pace(remaining);
      }
    }
    assert.deepEqual(errors, [], 'Browser errors during demo');
    const actualDuration = (Date.now() - start) / 1000;
    const video = page.video();
    await context.close();
    if (!check) {
      const path = join(render, 'walkthrough.webm');
      await video.saveAs(path);
      await video.delete();
      await writeFile(join(render, 'recording.json'), JSON.stringify({ path, elapsed: actualDuration, target: duration }, null, 2));
      console.log(`Recorded ${actualDuration.toFixed(3)} seconds.`);
    } else console.log('All 12 scenes passed interaction, layout, and browser-error checks.');
  } finally {
    await browser.close();
  }
}