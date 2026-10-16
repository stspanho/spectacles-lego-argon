#!/bin/sh
# Re-render the soundtrack after editing events.json (times in s, kinds: shutter click next pop reveal place finale fade, optional "gain")
# and mux it next to the original. Usage: sh render.sh [input.mp4] [output.mp4]
set -e
cd "$(dirname "$0")"
IN=${1:-$HOME/Desktop/lego-argon.mp4}
OUT=${2:-$HOME/Desktop/lego-argon-sound.mp4}
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
python3 sound.py events.json "$DUR" mix.wav
ffmpeg -y -v error -i "$IN" -i mix.wav -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -shortest "$OUT"
echo "wrote $OUT"
