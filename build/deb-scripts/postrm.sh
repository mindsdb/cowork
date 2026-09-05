#!/bin/bash

# Delete the link to the binary
# update-alternatives --remove <name> <path>: 'path' must be the registered alternative binary,
# not the generic symlink — see https://man7.org/linux/man-pages/man1/update-alternatives.1.html
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove and unload apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  # Unload the profile from the running kernel before deleting the file so the
  # policy is not left enforced until the next reboot.  Mirror the chroot guard
  # used in the after-install script — live AppArmor operations are not
  # meaningful inside a chroot.
  # https://wiki.debian.org/AppArmor/HowToUse
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi
# MindsHub additions below this line. Preserve the upstream prefix: afterRemove replaces electron-builder's template.

# Capture upstream status before anything resets it; cleanup must not change package-removal success.
upstream_status=$?

# Remove staged credentials left by an install that never launched.
# Run only on remove/purge; upgrade cleanup would race the new postinst staging.
case "${1:-}" in
  remove|purge) ;;
  *) exit "$upstream_status" ;;
esac

cleanup_cowork_credentials() (
  set -u

  TARGET_USER=""
  if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
    TARGET_USER="$SUDO_USER"
  elif [ -n "${PKEXEC_UID:-}" ]; then
    TARGET_USER="$(getent passwd "$PKEXEC_UID" | cut -d: -f1)"
  fi
  [ -n "$TARGET_USER" ] || exit 0

  HOME_DIR="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
  [ -n "$HOME_DIR" ] && [ -d "$HOME_DIR" ] || exit 0
  command -v runuser >/dev/null 2>&1 || exit 0

  # Delete as the user to avoid root following planted symlinks in a user-owned home.
  runuser -u "$TARGET_USER" -- /bin/sh -c '
        set -u
        dest_dir="$1/.cowork-provision"
        if [ -L "$dest_dir" ]; then exit 0; fi
        rm -f "$dest_dir/server-credentials.json"
        rmdir "$dest_dir" 2>/dev/null || true
      ' sh "$HOME_DIR" || true

  exit 0
)

cleanup_cowork_credentials || true

exit "$upstream_status"
