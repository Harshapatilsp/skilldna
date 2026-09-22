import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

// Neural voices via Edge — no API key. WAV is produced by piping MP3 through ffmpeg
// so record-demo.mjs's wavDuration parser (RIFF/PCM) keeps working.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs/video/render');
const scenes = JSON.parse(await readFile(join(root, 'docs/video/storyboard.json'), 'utf8'));
const encoder = process.env.FFMPEG_PATH ?? join(tmpdir(), 'skilldna-video-tools/package/ffmpeg.exe');
const voice = process.env.NARRATOR_VOICE ?? 'en-US-AndrewMultilingualNeural';
const rate = process.env.NARRATOR_RATE ?? 'default';
const pitch = process.env.NARRATOR_PITCH ?? 'default';
await mkdir(output, { recursive: true });

const tts = new MsEdgeTTS();
await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

for (const scene of scenes) {
  const wavPath = join(output, `${scene.id}.wav`);
  const { audioStream } = tts.toStream(scene.narration, { rate, pitch });
  const ffmpeg = spawn(encoder, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', 'pipe:0',
    '-ar', '22050', '-ac', '1', '-sample_fmt', 's16',
    '-f', 'wav', wavPath,
  ], { stdio: ['pipe', 'ignore', 'inherit'] });
  audioStream.pipe(ffmpeg.stdin);
  const code = await new Promise((resolvePromise, rejectPromise) => {
    ffmpeg.once('error', rejectPromise);
    ffmpeg.once('close', resolvePromise);
  });
  assert.equal(code, 0, `ffmpeg failed for ${scene.id}`);
  console.log(`${scene.id}: ${wavPath}`);
}

tts.close();
