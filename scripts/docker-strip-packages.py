#!/usr/bin/env python3
"""Build-time allowlist strip: remove every RPM the runtime doesn't need.

Why: customer image-intake scanners block on any
HIGH/CRITICAL CVE physically present in the image — fixable or not,
triage notes notwithstanding. Red Hat regularly has no patch for new
CVEs on base packages the app never executes (gnutls, libacl/libattr,
curl-minimal, ...). Enumerating packages to *remove* is whack-a-mole:
every new advisory on an unused package fails the next intake scan.

So this script inverts the model. KEEP_ROOTS declares what the runtime
genuinely needs; their dependency closure (computed live against the
rpm database, so it adapts across base-image bumps) is kept, and every
other package is removed in one rpm transaction. A package that isn't
in the image can't fail a scan.

DENY lists packages that appear in the closure only through
install-time scriptlet dependencies (ca-certificates %post runs sed,
openssl-fips-provider %post runs coreutils, ...). Those scriptlets
already ran during microdnf install; nothing re-runs them in an
immutable image, so the closure must not expand through them —
otherwise sed would drag in libacl (no-fix HIGH CVEs) and friends.

The final transaction removes rpm itself. That removes the *tool*, not
the *database*: /var/lib/rpm/rpmdb.sqlite survives, so scanners
still enumerate every remaining package honestly.

Run as root in the runtime stage, after all microdnf installs and
useradd, before USER anton. Requires only python3.12 + rpm (both
present at that point).
"""
import subprocess
import sys

KEEP_ROOTS = {
    # The application runtime: interpreter the venv links against.
    "python3.12", "python3.12-libs", "python3.12-pip-wheel",
    # manylinux wheels in the venv (pydantic-core, etc.) link libstdc++.
    "libstdc++",
    # Interactive shell for `docker exec` debugging. Nothing in the
    # image *requires* it (entrypoint/healthcheck are python).
    "bash",
    # TLS trust store for outbound HTTPS to the LLM gateway.
    "ca-certificates", "p11-kit-trust",
    "openssl", "openssl-libs",
    "openssl-fips-provider", "openssl-fips-provider-so",
    "crypto-policies",
    # Base plumbing: libc, filesystem layout, timezone data, the
    # /usr/bin/python3 alternatives symlinks, RPM signing keys.
    "glibc", "glibc-common", "glibc-minimal-langpack",
    "setup", "filesystem", "basesystem", "redhat-release",
    "tzdata", "alternatives", "gpg-pubkey",
}

# Reachable from KEEP_ROOTS only via install-time scriptlet deps —
# do not expand the closure through these, and remove them.
DENY = {
    "coreutils-single", "sed", "grep", "findutils", "gawk",
    "krb5-libs", "libacl", "libattr", "shadow-utils", "libarchive",
    "rpm", "rpm-libs", "libsolv",
}


def rpm_lines(*args: str) -> list[str]:
    out = subprocess.run(["rpm", *args], capture_output=True, text=True)
    return [line.strip() for line in out.stdout.splitlines() if line.strip()]


def main() -> None:
    installed = set(rpm_lines("-qa", "--qf", "%{NAME}\n"))

    keep: set[str] = set()
    todo = [p for p in KEEP_ROOTS if p in installed]
    while todo:
        pkg = todo.pop()
        if pkg in keep or pkg in DENY:
            continue
        keep.add(pkg)
        for req in rpm_lines("-qR", pkg):
            cap = req.split()[0]
            if cap.startswith(("rpmlib(", "config(")):
                continue
            for prov in rpm_lines("-q", "--qf", "%{NAME}\n", "--whatprovides", cap):
                name = prov.split()[0] if prov.split() else ""
                if name in installed and name not in keep and name not in DENY:
                    todo.append(name)

    remove = sorted(installed - keep)
    missing_roots = sorted(p for p in KEEP_ROOTS if p not in installed)
    if missing_roots:
        print(f"strip: WARNING roots not installed: {' '.join(missing_roots)}",
              file=sys.stderr)

    print(f"strip: keeping {len(keep)}: {' '.join(sorted(keep))}", file=sys.stderr)
    print(f"strip: removing {len(remove)}: {' '.join(remove)}", file=sys.stderr)

    result = subprocess.run(["rpm", "-e", "--nodeps", *remove])
    if result.returncode != 0:
        sys.exit(result.returncode)

    # Cache cleanup in Python — coreutils' rm no longer exists.
    import shutil
    for cache in ("/var/cache/dnf", "/var/lib/dnf", "/var/cache/yum"):
        shutil.rmtree(cache, ignore_errors=True)

    # Belt-and-braces: the interpreter and TLS must survive the strip.
    import ssl  # noqa: F401
    import sqlite3  # noqa: F401
    import uuid
    uuid.uuid4()
    print("strip: post-strip sanity OK (ssl, sqlite3, uuid)", file=sys.stderr)


if __name__ == "__main__":
    main()
