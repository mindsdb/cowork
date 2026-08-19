#!/bin/bash

if type update-alternatives >/dev/null 2>&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Install apparmor profile. (Ubuntu 24+)
# First check if the version of AppArmor running on the device supports our profile.
# This is in order to keep backwards compatibility with Ubuntu 22.04 which does not support abi/4.0.
# In that case, we just skip installing the profile since the app runs fine without it on 22.04.
#
# Those apparmor_parser flags are akin to performing a dry run of loading a profile.
# https://wiki.debian.org/AppArmor/HowToUse#Dumping_profiles
#
# Unfortunately, at the moment AppArmor doesn't have a good story for backwards compatibility.
# https://askubuntu.com/questions/1517272/writing-a-backwards-compatible-apparmor-profile
if apparmor_status --enabled > /dev/null 2>&1; then
  APPARMOR_PROFILE_SOURCE='/opt/${sanitizedProductName}/resources/apparmor-profile'
  APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"

    # Updating the current AppArmor profile is not possible and probably not meaningful in a chroot'ed environment.
    # Use cases are for example environments where images for clients are maintained.
    # There, AppArmor might correctly be installed, but live updating makes no sense.
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      # Extra flags taken from dh_apparmor:
      # > By using '-W -T' we ensure that any abstraction updates are also pulled in.
      # https://wiki.debian.org/AppArmor/Contribute/FirstTimeProfileImport
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
    fi
  else
    echo "Skipping the installation of the AppArmor profile as this version of AppArmor does not seem to support the bundled profile"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# MindsHub additions below this line. Everything above is electron-builder's
# after-install.tpl verbatim — `deb.afterInstall` REPLACES that script rather
# than adding to it, so dropping it would cost the /usr/bin symlink, the
# chrome-sandbox mode Electron needs to start, and the AppArmor profile.
# deb-postinst.invariant.test.ts fails if upstream's copy changes.
#
# Keep this block LAST and in a subshell: its early exits then end the block,
# never the steps above. Note electron-builder text-substitutes dollar-brace
# NAME placeholders in this file and throws on an unknown one; only `executable`
# and `sanitizedProductName` are defined. Comments are not exempt, so every
# other such reference here contains `_` or `:-`, which its matcher skips.
# ─────────────────────────────────────────────────────────────────────────────

# Moves the OAuth credentials out of root-owned /opt, where the app could never
# delete them, into a private copy in the installing user's home. Without this
# the plaintext secrets sit world-readable forever and every launch logs a
# failed cleanup. Never fails the install: if staging doesn't happen, the app
# still reads the packaged copy via getCandidateStagingPaths()'s fallback.
stage_cowork_credentials() (
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
  # logs a failed cleanup on every launch. Tracked as a follow-up.
  exit 0
)

stage_cowork_credentials || true
