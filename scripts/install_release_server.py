"""Install a server release with its own reviewed dependency selection."""

from __future__ import annotations

import argparse
from dataclasses import dataclass, replace
from email.parser import Parser
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.request import urlopen
import zipfile


REPOSITORY = "https://github.com/mindsdb/cowork-server.git"
CONTRACT_MEMBER = "cowork/release-requirements.txt"
MAX_DOWNLOAD = 64 * 1024 * 1024


@dataclass(frozen=True)
class Release:
    source: str
    contract: str
    version: str | None = None
    commit: str | None = None
    anton_commit: str | None = None


@dataclass
class InstallState:
    # Unknown prior state is unsafe to restart until the tool directory is read.
    changed: bool = True


def download(url: str) -> bytes:
    if not url.startswith("https://"):
        raise ValueError("Release downloads require HTTPS")
    with urlopen(url, timeout=60) as response:
        if not response.url.startswith("https://"):
            raise ValueError("Release download redirected away from HTTPS")
        data = response.read(MAX_DOWNLOAD + 1)
    if len(data) > MAX_DOWNLOAD:
        raise ValueError("Release download exceeds the size limit")
    return data


def requirement_lines(contract: str) -> list[str]:
    lines = []
    for line in contract.splitlines():
        if not line or line.startswith("#"):
            continue
        if line.startswith(" ") and re.fullmatch(r"\s+--hash=sha256:[0-9a-f]{64}(?: \\)?", line):
            continue
        requirement = line.removesuffix(" \\")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*==[A-Za-z0-9.!+_-]+(?: ; .+)?", requirement):
            raise ValueError(f"Release contract contains an unpinned requirement: {line}")
        lines.append(requirement)
    if not lines or not any(line.startswith("anton-agent==") for line in lines):
        raise ValueError("Release contract must include the exact Anton selection")
    return lines


def without_anton(contract: str) -> str:
    lines = []
    skip = False
    for line in contract.splitlines():
        if line and not line.startswith((" ", "#")):
            skip = line.startswith("anton-agent==")
        if not skip:
            lines.append(line)
    return "\n".join(lines) + "\n"


def git_commit(repository: str, ref: str) -> str:
    if re.fullmatch(r"[0-9a-fA-F]{40}", ref):
        return ref.lower()
    output = subprocess.check_output(
        ["git", "ls-remote", repository, f"refs/heads/{ref}", f"refs/tags/{ref}", f"refs/tags/{ref}^{{}}"],
        text=True,
    )
    refs = dict(line.split()[::-1] for line in output.splitlines())
    selected = refs.get(f"refs/tags/{ref}^{{}}") or refs.get(f"refs/tags/{ref}")
    head = refs.get(f"refs/heads/{ref}")
    if head and selected and head != selected:
        raise ValueError("Release ref is ambiguous between a branch and tag")
    commit = head or selected or ""
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError(f"Cannot resolve release ref {ref}")
    return commit


def cached_contract(cache: Path | None, identity: str) -> str:
    if cache:
        path = cache / (hashlib.sha256(identity.encode()).hexdigest() + ".txt")
        if path.is_file():
            return path.read_text()
    raise ValueError("Selected release has no reviewed dependency contract or prior installed snapshot")


def wheel_release(version: str, directory: Path, cache: Path | None) -> tuple[Path, str]:
    """Retain verified release bytes so rollback does not need another HTTP lookup."""
    saved = cache / hashlib.sha256(f"cowork-server=={version}".encode()).hexdigest() if cache and version else None
    if saved and (saved / "pypi.json").is_file():
        metadata = json.loads((saved / "pypi.json").read_text())
    else:
        endpoint = f"https://pypi.org/pypi/cowork-server/{version + '/' if version else ''}json"
        metadata = json.loads(download(endpoint))
    selected = metadata["info"]["version"]
    if not re.fullmatch(r"[0-9][0-9A-Za-z.!+_-]*", selected) or (version and selected != version):
        raise ValueError("PyPI metadata does not match the selected server version")
    files = [item for item in metadata["urls"] if item["filename"].endswith("-py3-none-any.whl") and not item.get("yanked")]
    if len(files) != 1:
        raise ValueError("Expected one non-yanked universal server wheel")
    artifact = files[0]
    filename = artifact["filename"]
    if Path(filename).name != filename or "\\" in filename:
        raise ValueError("Invalid wheel filename")
    saved = cache / hashlib.sha256(f"cowork-server=={selected}".encode()).hexdigest() if cache else None
    data = (saved / filename).read_bytes() if saved and (saved / filename).is_file() else download(artifact["url"])
    if hashlib.sha256(data).hexdigest() != artifact["digests"]["sha256"]:
        raise ValueError("Server wheel hash does not match PyPI")
    expected_metadata = f"cowork_server-{selected}.dist-info/METADATA"
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if archive.namelist().count(expected_metadata) != 1:
            raise ValueError("Server wheel identity does not match the selected version")
        details = Parser().parsestr(archive.read(expected_metadata).decode())
        name = re.sub(r"[-_.]+", "-", details.get("Name", "")).lower()
        if name != "cowork-server" or details.get("Version") != selected:
            raise ValueError("Server wheel identity does not match the selected release")
    wheel = directory / filename
    wheel.write_bytes(data)
    if saved:
        saved.mkdir(parents=True, exist_ok=True)
        (saved / filename).write_bytes(data)
        (saved / "pypi.json").write_text(json.dumps(metadata))
    return wheel, selected


def prepare(spec: str, directory: Path, cache: Path | None = None) -> Release:
    git_prefix = f"git+{REPOSITORY}@"
    if spec.startswith(git_prefix):
        commit = git_commit(REPOSITORY, spec[len(git_prefix):])
        source = f"{git_prefix}{commit}"
        try:
            contract = cached_contract(cache, source)
        except ValueError:
            contract = download(f"https://raw.githubusercontent.com/mindsdb/cowork-server/{commit}/{CONTRACT_MEMBER}").decode()
        release = Release(source, contract, commit=commit)
    elif re.fullmatch(r"cowork-server(?:==[0-9][0-9A-Za-z.!+_-]*)?", spec):
        wheel, version = wheel_release(spec.partition("==")[2], directory, cache)
        with zipfile.ZipFile(wheel) as archive:
            count = archive.namelist().count(CONTRACT_MEMBER)
            if count > 1 or (count == 1 and archive.getinfo(CONTRACT_MEMBER).file_size > 4 * 1024 * 1024):
                raise ValueError("Invalid release dependency contract in wheel")
            if count == 0:
                contract = cached_contract(cache, f"cowork-server=={version}")
            else:
                contract = archive.read(CONTRACT_MEMBER).decode()
                # Keep only an explicitly installed official Anton Git identity
                # from a snapshot. Registry pins always come from the artifact.
                try:
                    prior = cached_contract(cache, f"cowork-server=={version}")
                except ValueError:
                    prior = ""
                anton = re.search(r"^# anton-commit: [0-9a-f]{40}$", prior, re.MULTILINE)
                if anton:
                    contract += "\n" + anton[0] + "\n"
        release = Release(str(wheel), contract, version=version)
    else:
        raise ValueError("Select an exact server release or an official Git ref with a reviewed dependency contract")
    requirement_lines(release.contract)
    preserved_anton = re.search(r"^# anton-commit: ([0-9a-f]{40})$", release.contract, re.MULTILINE)
    if preserved_anton:
        release = replace(release, anton_commit=preserved_anton[1])
    return release


VERIFY = r'''
import importlib.metadata as metadata
import json
from pathlib import Path
import re
import sys
from packaging.requirements import Requirement

expected = json.loads(sys.argv[1])
requirements = [Requirement(line) for line in expected["requirements"]]
normalize = lambda name: re.sub(r"[-_.]+", "-", name).lower()
installed = {normalize(d.metadata["Name"]): d for d in metadata.distributions()}
selected = {normalize(r.name): r for r in requirements if not r.marker or r.marker.evaluate()}
if set(installed) != set(selected) | {"cowork-server"}:
    raise SystemExit("Installed inventory differs from the reviewed release contract")
for name, requirement in selected.items():
    if name == "anton-agent" and expected["anton_commit"]:
        direct = json.loads(installed[name].read_text("direct_url.json") or "{}")
        if direct.get("vcs_info", {}).get("commit_id") != expected["anton_commit"]:
            raise SystemExit("Installed Anton differs from the selected commit")
        continue
    if not requirement.specifier.contains(installed[name].version, prereleases=True):
        raise SystemExit(f"Installed {name} differs from the reviewed release contract")
server = installed["cowork-server"]
if expected["version"] and server.version != expected["version"]:
    raise SystemExit("Installed server version differs from the selected release")
if expected["commit"]:
    direct = json.loads(server.read_text("direct_url.json") or "{}")
    if direct.get("vcs_info", {}).get("commit_id") != expected["commit"]:
        raise SystemExit("Installed server commit differs from the selected release")
'''


def verify(python: Path, release: Release) -> None:
    expected = {"requirements": requirement_lines(release.contract), "version": release.version, "commit": release.commit, "anton_commit": release.anton_commit}
    subprocess.run([str(python), "-I", "-c", VERIFY, json.dumps(expected)], check=True)


SNAPSHOT = r'''
import importlib.metadata as metadata
import json
from pathlib import Path
import re
distributions = list(metadata.distributions())
normalize = lambda name: re.sub(r"[-_.]+", "-", name).lower()
server = next(d for d in distributions if normalize(d.metadata["Name"]) == "cowork-server")
direct = json.loads(server.read_text("direct_url.json") or "{}")
commit = direct.get("vcs_info", {}).get("commit_id")
if direct.get("vcs_info") and (direct.get("url") != "https://github.com/mindsdb/cowork-server.git" or not re.fullmatch(r"[0-9a-f]{40}", commit or "")):
    raise SystemExit("Cannot snapshot a custom server source for release rollback")
if direct.get("dir_info"):
    raise SystemExit("Cannot snapshot a local development server as a release")
identity = f"git+{direct['url']}@{commit}" if commit else f"cowork-server=={server.version}"
lines = []
for distribution in distributions:
    name = normalize(distribution.metadata["Name"])
    if name == "cowork-server":
        continue
    source = json.loads(distribution.read_text("direct_url.json") or "{}")
    if source:
        commit = source.get("vcs_info", {}).get("commit_id", "")
        if name != "anton-agent" or source.get("url") != "https://github.com/mindsdb/anton.git" or not re.fullmatch(r"[0-9a-f]{40}", commit):
            raise SystemExit("Cannot snapshot a custom dependency source for registry rollback")
        lines.append(f"# anton-commit: {commit}")
    lines.append(f"{name}=={distribution.version}")
packaged = Path(server.locate_file("cowork/release-requirements.txt"))
contract = packaged.read_text() if packaged.is_file() else "\n".join(sorted(lines)) + "\n"
if packaged.is_file():
    contract += "\n" + "\n".join(line for line in lines if line.startswith("# anton-commit:")) + "\n"
print(json.dumps({"identity": identity, "contract": contract}))
'''


def snapshot_installed(uv: str, tools_dir: Path) -> Path:
    """Retain the actual legacy environment solely for repair and rollback."""
    cache = tools_dir / ".cowork-release-contracts"
    if (cache / "install-incomplete").exists():
        return cache
    python = tools_dir / "cowork-server" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.is_file():
        return cache
    checked = subprocess.run([uv, "pip", "check", "--python", str(python)], capture_output=True)
    if checked.returncode:
        return cache  # A broken environment cannot replace a known-good snapshot.
    result = subprocess.run([str(python), "-I", "-c", SNAPSHOT], capture_output=True, text=True)
    if result.returncode:
        raise ValueError("Cannot preserve the installed environment for rollback: " + result.stderr.strip())
    snapshot = json.loads(result.stdout)
    requirement_lines(snapshot["contract"])
    cache.mkdir(exist_ok=True)
    path = cache / (hashlib.sha256(snapshot["identity"].encode()).hexdigest() + ".txt")
    temporary = path.with_suffix(".tmp")
    temporary.write_text(snapshot["contract"])
    temporary.replace(path)
    # Cache the old wheel before any replacement. Git sources already live in
    # uv's repository cache; their exact commit and contract are retained above.
    if snapshot["identity"].startswith("cowork-server=="):
        with tempfile.TemporaryDirectory(prefix="cowork-rollback-") as directory:
            prepare(snapshot["identity"], Path(directory), cache)
    return cache


def preflight(uv: str, release: Release, directory: Path, contract: Path, environment: dict[str, str]) -> None:
    """Reject missing wheels, incompatible metadata and extra dependencies before installation."""
    artifact = directory / "artifact.txt"
    artifact.write_text(release.source + "\n")
    if release.anton_commit:
        # A direct source keeps the server's original Anton version constraint.
        # UV_OVERRIDE would erase that constraint and hide incompatible pairs.
        artifact.write_text(release.source + "\n" + Path(environment["UV_OVERRIDE"]).read_text())
        contract = directory / "preflight-requirements.txt"
        contract.write_text(without_anton(release.contract))
        environment = {**environment, "UV_OVERRIDE": ""}
    common = [uv, "pip", "compile", "--python", sys.executable, "--no-config", "--no-header", "--no-annotate", "--no-emit-package", "cowork-server", "--quiet"]
    if release.anton_commit:
        common.extend(["--no-emit-package", "anton-agent"])
    expected = subprocess.check_output([*common, "--no-deps", str(contract)], text=True, env=environment)
    binary = ["--only-binary", ":all:"]
    if release.commit or release.anton_commit:
        # uv 0.7 cannot exempt a Git project from --only-binary :all:.
        # Keep every registry requirement wheel-only; permit the selected sources.
        registry = {line.split("==", 1)[0] for line in requirement_lines(release.contract)} | {"cowork-server"}
        if release.commit:
            registry.discard("cowork-server")
        if release.anton_commit:
            registry.discard("anton-agent")
        binary = [argument for name in sorted(registry) for argument in ("--only-binary", name)]
    actual = subprocess.check_output([*common, *binary, str(artifact), str(contract)], text=True, env=environment)
    packages = lambda output: [line.strip() for line in output.splitlines() if line.strip() and not line.startswith("#")]
    if packages(expected) != packages(actual):
        raise ValueError("Release metadata requires packages outside its reviewed contract")


def install(uv: str, arguments: list[str], python: Path | None = None, state: InstallState | None = None) -> None:
    state = state or InstallState()
    if arguments[:2] != ["tool", "install"]:
        raise ValueError("Only tool install is supported")
    positions = [index for index, value in enumerate(arguments) if value == "cowork-server" or value.startswith(("cowork-server==", f"git+{REPOSITORY}@"))]
    if len(positions) != 1:
        raise ValueError("Expected one exact server install target")
    position = positions[0]
    cache = None
    if not python:
        tools_dir = Path(subprocess.check_output([uv, "tool", "dir"], text=True).strip())
        state.changed = (tools_dir / ".cowork-release-contracts/install-incomplete").exists()
        cache = snapshot_installed(uv, tools_dir)
    with tempfile.TemporaryDirectory(prefix="cowork-release-") as temporary:
        directory = Path(temporary)
        release = prepare(arguments[position], directory, cache)
        contract = directory / "requirements.txt"
        contract.write_text(release.contract)
        # Direct requirements also allow the exact rc recorded in the lock.
        # Bind an explicit Anton source override once; other packages stay pinned.
        environment = {**os.environ, "UV_OVERRIDE": "", "UV_CONSTRAINT": ""}
        commit = release.anton_commit
        if os.environ.get("UV_OVERRIDE"):
            override = Path(os.environ["UV_OVERRIDE"]).read_text().strip()
            prefix = "anton-agent @ git+https://github.com/mindsdb/anton.git@"
            if not override.startswith(prefix) or "\n" in override:
                raise ValueError("Only an explicit official Anton Git override is supported")
            commit = git_commit("https://github.com/mindsdb/anton.git", override[len(prefix):])
        if commit:
            prefix = "anton-agent @ git+https://github.com/mindsdb/anton.git@"
            override_file = directory / "override.txt"
            override_file.write_text(prefix + commit + "\n")
            environment["UV_OVERRIDE"] = str(override_file)
            release = replace(release, anton_commit=commit)
        preflight(uv, release, directory, contract, environment)
        if python:
            # Native source installs are explicit below. Keep Git overrides out
            # of the separate registry phase, which requires wheel hashes.
            environment["UV_OVERRIDE"] = ""
            if release.anton_commit:
                contract.write_text(without_anton(release.contract))
            subprocess.run([uv, "venv", "--python", sys.executable, str(python.parent.parent)], check=True, env=environment)
            subprocess.run([uv, "pip", "install", "--python", str(python), "--no-config", "--no-deps", "--require-hashes", "--only-binary", ":all:", "-r", str(contract)], check=True, env=environment)
            sources = [release.source]
            if release.anton_commit:
                sources.append(f"anton-agent @ git+https://github.com/mindsdb/anton.git@{release.anton_commit}")
            subprocess.run([uv, "pip", "install", "--python", str(python), "--no-config", "--no-deps", *sources], check=True, env=environment)
        else:
            arguments = list(arguments)
            arguments[position] = release.source
            if "--python" in arguments:
                arguments[arguments.index("--python") + 1] = sys.executable
            else:
                arguments.extend(["--python", sys.executable])
            arguments.extend(["--no-config", "--with-requirements", str(contract)])
            if release.version and not release.anton_commit:
                arguments.append("--no-build")
            cache.mkdir(parents=True, exist_ok=True)
            state.changed = True
            (cache / "install-incomplete").touch()
            subprocess.run([uv, *arguments], check=True, env=environment)
            python = tools_dir / "cowork-server" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        subprocess.run([uv, "pip", "check", "--python", str(python)], check=True, env=environment)
        verify(python, release)
    if cache:
        (cache / "install-incomplete").unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uv", default="uv")
    parser.add_argument("--venv-python", type=Path)
    parser.add_argument("arguments", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    arguments = args.arguments[1:] if args.arguments[:1] == ["--"] else args.arguments
    state = InstallState()
    try:
        install(args.uv, arguments, args.venv_python, state)
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        print(f"Locked server install failed: {exc}", file=sys.stderr)
        # Exit 2 proves no replacement occurred and no prior incomplete install exists.
        return 1 if state.changed else 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
