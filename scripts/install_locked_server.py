"""Install a supplied registry lock and two immutable Git projects into a new venv.

The lock covers application dependencies, not the Git projects' isolated build
backends. Both source commits and the complete installed environment are checked
before importing the app or recording that the hash-checked install succeeded.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

GIT_PACKAGES = {
    "cowork-server": "https://github.com/mindsdb/cowork-server.git",
    "anton-agent": "https://github.com/mindsdb/anton.git",
}
MARKER_NAME = ".cowork-server-requirements.sha256"
NAME = r"[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?"
VERSION = (r"(?:[0-9]+!)?[0-9]+(?:\.[0-9]+)*(?:(?:a|b|rc)[0-9]+)?"
           r"(?:\.post[0-9]+)?(?:\.dev[0-9]+)?(?:\+[a-z0-9]+(?:\.[a-z0-9]+)*)?")
PIN = re.compile(rf"({NAME})==({VERSION})")
HASH = re.compile(r"--hash=sha256:[0-9a-f]{64}")


@dataclass(frozen=True)
class Package:
    version: str
    url: str | None = None
    commit: str | None = None


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def read_lock(text: str) -> dict[str, str]:
    """Accept exact hashed registry pins only, with no installer flags or URLs."""
    packages: dict[str, str] = {}
    continued = ""
    for number, physical in enumerate(text.splitlines(), 1):
        line = physical.strip()
        if not line or line.startswith("#"):
            continue
        if line.endswith("\\"):
            continued += line[:-1] + " "
            continue
        fields = (continued + line).split()
        continued = ""
        match = PIN.fullmatch(fields[0])
        if not match or len(fields) < 2 or not all(HASH.fullmatch(field) for field in fields[1:]):
            raise ValueError(f"lock line {number}: expected an exact registry pin with SHA-256 hashes")
        name, version = normalize(match[1]), match[2]
        if name in GIT_PACKAGES or name in packages:
            raise ValueError(f"lock line {number}: duplicate or separately pinned Git package {name}")
        packages[name] = version
    if continued or not packages:
        raise ValueError("registry lock is empty or has an unfinished continuation")
    return packages


def check_jwt_floor(version: str) -> None:
    """Compare the normalized release to 2.13.0, rejecting its prereleases too."""
    match = re.fullmatch(r"(?:(\d+)!)?(\d+(?:\.\d+)*)(.*)", version)
    if not match:
        raise ValueError("the registry lock must include PyJWT >=2.13.0")
    epoch, release, suffix = match.groups()
    parts = [int(part) for part in release.split(".")]
    while len(parts) > 3 and parts[-1] == 0:
        parts.pop()
    parts += [0] * max(0, 3 - len(parts))
    if int(epoch or 0) == 0 and (tuple(parts) < (2, 13, 0) or (
        tuple(parts) == (2, 13, 0) and suffix and not suffix.startswith((".post", "+"))
    )):
        raise ValueError(f"PyJWT {version} is below the required security floor 2.13.0")


def expected_packages(lock: str, server_version: str, server_commit: str,
                      anton_version: str, anton_commit: str) -> dict[str, Package]:
    expected = {name: Package(version) for name, version in read_lock(lock).items()}
    check_jwt_floor(expected.get("pyjwt", Package("")).version)
    for name, version, commit in (("cowork-server", server_version, server_commit),
                                   ("anton-agent", anton_version, anton_commit)):
        if not re.fullmatch(VERSION, version) or not re.fullmatch(r"[0-9a-f]{40}", commit):
            raise ValueError(f"{name}: locked installation requires an exact version and full Git commit")
        expected[name] = Package(version, GIT_PACKAGES[name], commit)
    return expected


def verify_packages(expected: dict[str, Package],
                    distributions: Iterable[importlib.metadata.Distribution]) -> None:
    actual: dict[str, Package] = {}
    for distribution in distributions:
        written = distribution.metadata.get("Name", "")
        if not re.fullmatch(NAME, written):
            raise ValueError("installed distribution has an invalid or missing name")
        name = normalize(written)
        if name in actual:
            raise ValueError(f"{name}: duplicate installed distribution")
        url = commit = None
        direct = distribution.read_text("direct_url.json")
        if direct:
            try:
                origin = json.loads(direct)
                vcs = origin["vcs_info"]
                url, commit = origin["url"], vcs["commit_id"]
                if name not in GIT_PACKAGES or url != GIT_PACKAGES[name] or vcs["vcs"] != "git":
                    raise ValueError("unexpected origin")
            except (ValueError, KeyError, TypeError) as error:
                raise ValueError(f"{name}: unexpected installed source") from error
        actual[name] = Package(distribution.version, url, commit)
    failures = [f"{name}: expected {expected.get(name)}, installed {actual.get(name)}"
                for name in sorted(expected.keys() | actual.keys()) if expected.get(name) != actual.get(name)]
    if failures:
        raise ValueError("installed packages differ from the supplied contract:\n" + "\n".join(failures))


def read_sources(path: Path) -> tuple[str, str, str, str]:
    """Read the two exact source identities from the supplied contract metadata."""
    try:
        metadata = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(metadata, dict):
            raise ValueError("source metadata must be an object")
        sources = metadata["sources"]
        if not isinstance(sources, dict) or set(sources) != set(GIT_PACKAGES):
            raise ValueError("expected exactly cowork-server and anton-agent sources")
        result = []
        for name in GIT_PACKAGES:
            source = sources[name]
            if not isinstance(source, dict):
                raise ValueError(f"{name}: source identity must be an object")
            if source.get("url", GIT_PACKAGES[name]) != GIT_PACKAGES[name]:
                raise ValueError(f"{name}: unexpected source repository")
            result.extend((source["version"], source["commit"]))
        if not all(isinstance(value, str) for value in result):
            raise ValueError("source versions and commits must be strings")
        return result[0], result[1], result[2], result[3]
    except (KeyError, TypeError, json.JSONDecodeError) as error:
        raise ValueError("source metadata must identify both pinned Git projects") from error


def install(lock_path: Path, sources_path: Path, venv: Path) -> None:
    lock = lock_path.read_text(encoding="utf-8")
    server_version, server_commit, anton_version, anton_commit = read_sources(sources_path)
    expected = expected_packages(lock, server_version, server_commit, anton_version, anton_commit)
    if venv.exists():
        raise ValueError(f"locked installation requires a new environment: {venv} already exists")
    python = str(venv / "bin/python")
    subprocess.run(["uv", "venv", "--no-config", str(venv)], check=True)
    pip = ["uv", "pip", "install", "--no-config", "--python", python, "--no-deps"]
    subprocess.run([*pip, "--require-hashes", "--only-binary", ":all:", "-r", str(lock_path)], check=True)
    sources = [f"{name} @ git+{package.url}@{package.commit}"
               for name, package in expected.items() if package.url]
    subprocess.run([*pip, *sources], check=True)
    subprocess.run([python, str(Path(__file__).resolve()), "verify", "--lock", str(lock_path),
                    "--sources", str(sources_path)], check=True)
    subprocess.run(["uv", "pip", "check", "--no-config", "--python", python], check=True)
    subprocess.run([python, "-c", "from cowork.server import app; import anton; print('Verified locked cowork-server and anton.')"], check=True)
    marker = venv / MARKER_NAME
    marker.write_text(hashlib.sha256(lock.encode("utf-8")).hexdigest() + "\n", encoding="ascii")
    marker.chmod(0o444)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("install", "verify"))
    parser.add_argument("--lock", required=True, type=Path)
    parser.add_argument("--venv", type=Path, default=Path("/opt/venv"))
    parser.add_argument("--sources", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.command == "install":
            install(args.lock, args.sources, args.venv)
        else:
            expected = expected_packages(args.lock.read_text(encoding="utf-8"), *read_sources(args.sources))
            verify_packages(expected, importlib.metadata.distributions())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"locked server install: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
