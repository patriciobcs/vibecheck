#!/usr/bin/env bash
# Generates the demo voices with macOS text-to-speech: the participant's think-aloud (fed to the
# fake microphone, 48 kHz mono PCM like e2e/fixtures/speech.wav) and narrator clips for the video.
set -euo pipefail
cd "$(dirname "$0")"
OUT=../../demo-recordings/voice
mkdir -p "$OUT"
say -v Samantha -r 178 -o "$OUT/participant.aiff" -f participant.txt
ffmpeg -loglevel error -y -i "$OUT/participant.aiff" -ar 48000 -ac 1 -c:a pcm_s16le "$OUT/participant.wav"
node -e '
const fs = require("fs");
for (const c of JSON.parse(fs.readFileSync("narrator.json", "utf8"))) fs.writeFileSync(`'"$OUT"'/narrator-${c.id}.txt`, c.text);
'
for f in "$OUT"/narrator-*.txt; do
  id=$(basename "$f" .txt)
  say -v Daniel -r 172 -o "$OUT/$id.aiff" -f "$f"
  ffmpeg -loglevel error -y -i "$OUT/$id.aiff" -ar 48000 -ac 2 -c:a pcm_s16le "$OUT/$id.wav"
done
rm -f "$OUT"/*.aiff "$OUT"/narrator-*.txt
for f in "$OUT"/*.wav; do printf "%s %ss\n" "$(basename "$f")" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")"; done
