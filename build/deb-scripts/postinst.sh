#!/bin/sh
# deb postinst (ENG-1241) — runs as root after dpkg lays the payload into /opt.
#
# Moves the OAuth credentials out of root-owned /opt, where the app could never
# delete them, into a private copy in the installing user's home. Without this
# the plaintext secrets sit world-readable forever and every launch logs a
# failed cleanup. Never fails the install: if staging doesn't happen, the app
# still reads the packaged copy via getCandidateStagingPaths()'s fallback.
set -u

log() {
  echo "[cowork-postinst] $*" >&2
}

# electron-builder installs to /opt/<sanitizedProductName>/ (see
# LinuxTargetHelper.installPrefix), so glob for it rather than hardcoding a
# name that a productName change would silently break. The product name
# contains a space; glob expansion yields one word per match regardless.
SRC_FILE=""
for candidate in /opt/*/resources/server-credentials.json; do
  [ -f "$candidate" ] || continue
  SRC_FILE="$candidate"
  break
done

if [ -z "$SRC_FILE" ]; then
  log "no server-credentials.json in the payload — nothing to stage (dev/unsigned build?)"
  exit 0
fi

# Who to stage for. `sudo apt install` / `sudo dpkg -i` export SUDO_USER;
# polkit-backed GUI installers (gdebi, GNOME Software) export PKEXEC_UID
# instead. An unattended or container install has neither, which is not an
# error — it is the case the resourcesPath fallback exists for.
TARGET_USER=""
if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
  TARGET_USER="$SUDO_USER"
elif [ -n "${PKEXEC_UID:-}" ]; then
  TARGET_USER="$(getent passwd "$PKEXEC_UID" | cut -d: -f1)"
fi

if [ -z "$TARGET_USER" ]; then
  log "no installing user identifiable — leaving the packaged copy for the app to read"
  exit 0
fi

HOME_DIR="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
if [ -z "$HOME_DIR" ] || [ ! -d "$HOME_DIR" ]; then
  log "no home directory for ${TARGET_USER} — leaving the packaged copy for the app to read"
  exit 0
fi

DEST_DIR="$HOME_DIR/.cowork-provision"
DEST_FILE="$DEST_DIR/server-credentials.json"

# 077 so the directory and file are created private, rather than being created
# world-readable under root's usual 022 and narrowed a moment later.
umask 077

if mkdir -p "$DEST_DIR" \
  && cp "$SRC_FILE" "$DEST_FILE" \
  && chown "$TARGET_USER:" "$DEST_DIR" "$DEST_FILE" \
  && chmod 700 "$DEST_DIR" \
  && chmod 600 "$DEST_FILE"; then
  # Only once a private copy is confirmed in place: /opt is root-owned, so this
  # is the one and only moment anything can remove the world-readable original.
  rm -f "$SRC_FILE"
  log "staged credentials for ${TARGET_USER} and removed the packaged copy"
else
  log "failed to stage for ${TARGET_USER} — leaving the packaged copy for the app to read"
fi

exit 0
