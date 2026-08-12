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

# Scope the lookup to THIS package's own file list. A bare /opt/*/ glob would
# take the first match in all of /opt — staging, and then deleting, a
# same-named file belonging to some other electron app installed there.
SRC_FILE=""
if [ -n "${DPKG_MAINTSCRIPT_PACKAGE:-}" ] && command -v dpkg-query >/dev/null 2>&1; then
  SRC_FILE=$(dpkg-query -L "$DPKG_MAINTSCRIPT_PACKAGE" 2>/dev/null \
    | grep -x '/opt/.*/resources/server-credentials\.json' \
    | head -n 1)
fi

# No glob fallback on purpose: if the file can't be attributed to this package,
# leaving it for the app's own fallback beats touching another package's data.
if [ -z "$SRC_FILE" ] || [ ! -f "$SRC_FILE" ]; then
  log "no server-credentials.json in this package's payload — nothing to stage"
  exit 0
fi

# Who to stage for. sudo exports SUDO_USER, pkexec exports PKEXEC_UID. A
# PackageKit-backed GUI install (GNOME Software, KDE Discover) runs from a
# system daemon and exports neither, as does an unattended or container
# install — not an error, but see the note at the bottom.
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

if ! command -v runuser >/dev/null 2>&1; then
  log "runuser unavailable — leaving the packaged copy for the app to read"
  exit 0
fi

# Staged BY the target user, not by root: root writing through a path under a
# user-writable home means a pre-planted ~/.cowork-provision symlink would have
# root create, copy, and chown through it. Dropping privileges first removes
# that entirely, and makes ownership correct without any chown. umask 077 so
# the directory and file are born private rather than narrowed a moment later.
if runuser -u "$TARGET_USER" -- /bin/sh -c '
      set -u
      umask 077
      dest_dir="$1/.cowork-provision"
      if [ -L "$dest_dir" ]; then exit 1; fi
      mkdir -p "$dest_dir" || exit 1
      cp "$2" "$dest_dir/server-credentials.json"
    ' sh "$HOME_DIR" "$SRC_FILE"; then
  # Only once a private copy is confirmed: /opt is root-owned, so this is the
  # one moment anything can remove the world-readable original.
  rm -f "$SRC_FILE"
  log "staged credentials for ${TARGET_USER} and removed the packaged copy"
else
  log "failed to stage for ${TARGET_USER} — leaving the packaged copy for the app to read"
fi

# KNOWN LIMITATION: for PackageKit-backed GUI installs there is no installing
# user to stage for, so the credentials stay world-readable in /opt and the app
# logs a failed cleanup on every launch — the two things this script avoids for
# sudo/pkexec installs. Tracked as a follow-up.
exit 0
