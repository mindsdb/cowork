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
# ─────────────────────────────────────────────────────────────────────────────
# MindsHub additions below this line. Everything above is electron-builder's
# after-remove.tpl verbatim — `deb.afterRemove` REPLACES that script rather than
# adding to it, so dropping it would leave the /usr/bin alternative and the
# AppArmor profile behind. deb-maintainer-scripts.invariant.test.ts fails if
# upstream's copy changes.
# ─────────────────────────────────────────────────────────────────────────────

# Captured before anything below runs — a function definition alone would
# already have reset it. Everything after this point is best-effort and must
# not change whether dpkg considers the removal successful.
upstream_status=$?

# The postinst stages server-credentials.json into the installing user's home.
# The app deletes it once the values reach the secure store, so it is normally
# gone by now — but an install that was never launched leaves real OAuth
# secrets sitting in a home directory after the package is gone.
#
# Only on remove/purge: dpkg also calls this with `upgrade`, where the new
# version's postinst re-stages the file and deleting it here would race that.
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

  # As the user, for the same reason the postinst stages as the user: root
  # following a path under a user-writable home would delete through a
  # pre-planted ~/.cowork-provision symlink.
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
