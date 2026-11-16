#!/usr/bin/env bash
set -u
input="${1:?usage: judge-lo.sh <input-dir> <output-dir> [--roundtrip]}"
output="${2:?usage: judge-lo.sh <input-dir> <output-dir> [--roundtrip]}"
roundtrip=0
[ "${3:-}" = "--roundtrip" ] && roundtrip=1
limit="${LO_TIMEOUT:-60}"
batch="${LO_BATCH:-25}"
soffice_bin="$(command -v soffice || command -v libreoffice)"
[ -z "$soffice_bin" ] && { echo "soffice not found" >&2; exit 2; }

mkdir -p "$output/pdf" "$output/rt"
log="$output/lo.jsonl"
if [ "${LO_RESUME:-0}" != "1" ]; then : > "$log"; fi
touch "$log"
count=0
profile=""

fresh_profile() {
  [ -n "$profile" ] && rm -rf "$profile"
  profile="$(mktemp -d /tmp/seam-lo-XXXXXX)"
}

same_format() {
  case "${1##*.}" in
    docx|docm|dotx|dotm) echo docx ;;
    xlsx|xlsm|xltx|xltm) echo xlsx ;;
    pptx|pptm|potx|potm|ppsx|ppsm) echo pptx ;;
    *) echo "" ;;
  esac
}

convert() {
  timeout -k 5 "$limit" "$soffice_bin" "-env:UserInstallation=file://$profile" --headless --norestore --nolockcheck --convert-to "$1" --outdir "$2" "$3" >/dev/null 2>&1
  return $?
}

for file in "$input"/*; do
  [ -f "$file" ] || continue
  name="$(basename "$file")"
  id="${name%.*}"
  if [ "${LO_RESUME:-0}" = "1" ] && grep -q "\"id\":\"$id\"" "$log"; then continue; fi
  if [ $((count % batch)) -eq 0 ]; then fresh_profile; fi
  count=$((count + 1))
  rm -f "$output/pdf/$id.pdf"
  start=$(date +%s%N)
  convert pdf "$output/pdf" "$file"
  status=$?
  elapsed=$(( ($(date +%s%N) - start) / 1000000 ))
  load=false
  if [ -s "$output/pdf/$id.pdf" ]; then load=true; fi
  timedout=false
  [ "$status" -eq 124 ] && timedout=true && fresh_profile
  rt=false
  rtfile=""
  if [ "$roundtrip" -eq 1 ]; then
    fmt="$(same_format "$name")"
    if [ -n "$fmt" ]; then
      rm -f "$output/rt/$id.$fmt"
      convert "$fmt" "$output/rt" "$file"
      status=$?
      [ "$status" -eq 124 ] && fresh_profile
      if [ -s "$output/rt/$id.$fmt" ]; then rt=true; rtfile="$id.$fmt"; fi
    fi
  fi
  rm -f "$output/pdf/$id.pdf"
  printf '{"id":"%s","file":"%s","load":%s,"timeout":%s,"roundtrip":%s,"rtFile":"%s","ms":%s}\n' "$id" "$name" "$load" "$timedout" "$rt" "$rtfile" "$elapsed" >> "$log"
done
[ -n "$profile" ] && rm -rf "$profile"
exit 0
