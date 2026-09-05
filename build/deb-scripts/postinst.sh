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

# MindsHub additions below this line. Preserve the upstream prefix: afterInstall replaces electron-builder's template.
# Keep best-effort additions last and in a subshell; retain upstream exit status.
# electron-builder substitutes dollar-brace names even in comments; only executable/sanitizedProductName exist.
# Other references need an underscore or :- to avoid matching.

# Capture upstream status before any function definition resets it; staging must not change install success.
upstream_status=$?

# Move credentials out of root-owned /opt so the app can delete them after provisioning.
# Staging is best-effort; getCandidateStagingPaths retains a packaged-file fallback.
stage_cowork_credentials() (
  set -u

  log() {
    echo "[cowork-postinst] $*" >&2
  }

  # Use only this package's file list; an /opt glob could copy and delete another app's credentials.
  SRC_FILE=""
  if [ -n "${DPKG_MAINTSCRIPT_PACKAGE:-}" ] && command -v dpkg-query >/dev/null 2>&1; then
    SRC_FILE=$(dpkg-query -L "$DPKG_MAINTSCRIPT_PACKAGE" 2>/dev/null \
      | grep -x '/opt/.*/resources/server-credentials\.json' \
      | head -n 1)
  fi

  # Do not glob-fallback when ownership cannot be established.
  if [ -z "$SRC_FILE" ] || [ ! -f "$SRC_FILE" ]; then
    log "no server-credentials.json in this package's payload — nothing to stage"
    exit 0
  fi

  # sudo/pkexec identify an installing user; PackageKit daemons and unattended installs may provide neither.
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

  # Stage as the target user with umask 077; root writes through user-owned paths could follow planted symlinks.
  if runuser -u "$TARGET_USER" -- /bin/sh -c '
        set -u
        umask 077
        dest_dir="$1/.cowork-provision"
        if [ -L "$dest_dir" ]; then exit 1; fi
        mkdir -p "$dest_dir" || exit 1
        cp "$2" "$dest_dir/server-credentials.json"
      ' sh "$HOME_DIR" "$SRC_FILE"; then
    # Delete the root-owned original only after confirming a private staged copy.
    rm -f "$SRC_FILE"
    log "staged credentials for ${TARGET_USER} and removed the packaged copy"
  else
    log "failed to stage for ${TARGET_USER} — leaving the packaged copy for the app to read"
  fi

  # PackageKit installs may leave credentials world-readable in /opt because no target user is known.
  exit 0
)

stage_cowork_credentials || true

exit "$upstream_status"
