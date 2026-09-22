#!/usr/bin/env bash
# Renders og/og.svg to public/og.png. Pango only loads raw TrueType, so the Fraunces WOFF files from
# @fontsource/fraunces are unpacked to TTF in a temp dir that a private fontconfig points at.
set -euo pipefail
cd "$(dirname "$0")/.."

fonts="$(mktemp -d)"
trap 'rm -rf "$fonts"' EXIT

python3 - "$fonts" node_modules/@fontsource/fraunces/files/fraunces-latin-{700,800}-normal.woff <<'PY'
import os, struct, sys, zlib

out_dir, *paths = sys.argv[1:]
for path in paths:
    data = open(path, "rb").read()
    flavor, _, num_tables = struct.unpack(">4sIH", data[4:14])
    entries = [struct.unpack(">4sIIII", data[44 + 20 * i : 64 + 20 * i]) for i in range(num_tables)]
    shift = 1 << (num_tables.bit_length() - 1)
    header = flavor + struct.pack(">HHHH", num_tables, shift * 16, shift.bit_length() - 1, num_tables * 16 - shift * 16)
    offset = 12 + 16 * num_tables
    directory, body = b"", b""
    for tag, off, comp_len, orig_len, checksum in entries:
        table = data[off : off + comp_len]
        if comp_len != orig_len:
            table = zlib.decompress(table)
        directory += struct.pack(">4sIII", tag, checksum, offset + len(body), orig_len)
        body += table + b"\0" * (-len(table) % 4)
    name = os.path.basename(path).replace(".woff", ".ttf")
    open(os.path.join(out_dir, name), "wb").write(header + directory + body)
PY

cat > "$fonts/fonts.conf" <<CONF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <include ignore_missing="yes">/opt/homebrew/etc/fonts/fonts.conf</include>
  <dir>$fonts</dir>
  <cachedir>$fonts/cache</cachedir>
</fontconfig>
CONF

PANGOCAIRO_BACKEND=fc FONTCONFIG_FILE="$fonts/fonts.conf" \
  rsvg-convert -w 1200 -h 630 og/og.svg -o "$fonts/og.png"
magick "$fonts/og.png" -strip -dither None -colors 256 -define png:compression-level=9 PNG8:public/og.png
magick identify public/og.png

rsvg-convert -w 180 -h 180 og/icon.svg -o "$fonts/icon.png"
magick "$fonts/icon.png" -strip -define png:compression-level=9 public/apple-touch-icon.png
magick identify public/apple-touch-icon.png
