"""Release artifacts and preflight failures must preserve the reviewed selection."""

import hashlib
import importlib.metadata
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile


spec = importlib.util.spec_from_file_location("install_release_server", Path(__file__).with_name("install_release_server.py"))
installer = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = installer
spec.loader.exec_module(installer)
CONTRACT = "anton-agent==1.0.0\nfixture-dependency==1.0.0\n"


def wheel(name="cowork_server", version="1.0.0", requirements=(), contract=CONTRACT, extra_files=None):
    archive = io.BytesIO()
    prefix = f"{name}-{version}.dist-info"
    with zipfile.ZipFile(archive, "w") as output:
        output.writestr(prefix + "/METADATA", f"Metadata-Version: 2.3\nName: {name}\nVersion: {version}\n" + "".join(f"Requires-Dist: {r}\n" for r in requirements))
        output.writestr(prefix + "/WHEEL", "Wheel-Version: 1.0\nGenerator: fixture\nRoot-Is-Purelib: true\nTag: py3-none-any\n")
        if name == "cowork_server":
            output.writestr(prefix + "/entry_points.txt", "[console_scripts]\ncowork-server = fixture_server:main\n")
            output.writestr("fixture_server.py", "def main(): print('fixture server')\n")
        for filename, data in (extra_files or {}).items():
            output.writestr(filename, data)
        if contract is not None:
            output.writestr(installer.CONTRACT_MEMBER, contract)
        output.writestr(prefix + "/RECORD", "".join(f"{filename},,\n" for filename in [*output.namelist(), prefix + "/RECORD"]))
    return archive.getvalue()


def metadata(data):
    return json.dumps({"info": {"version": "1.0.0"}, "urls": [{"filename": "cowork_server-1.0.0-py3-none-any.whl", "url": "https://files.pythonhosted.org/server.whl", "digests": {"sha256": hashlib.sha256(data).hexdigest()}}]}).encode()


def source_project(directory, name, requirements=()):
    """A real PEP 517 source project whose backend needs only the standard library."""
    project = directory / name
    project.mkdir()
    (project / "pyproject.toml").write_text(
        '[build-system]\nrequires = []\nbuild-backend = "fixture_backend"\nbackend-path = ["."]\n'
    )
    prefix = name.replace("-", "_") + "-1.0.0.dist-info"
    metadata_text = f"Metadata-Version: 2.3\nName: {name}\nVersion: 1.0.0\n" + "".join(f"Requires-Dist: {requirement}\n" for requirement in requirements)
    (project / "PKG-INFO").write_text(metadata_text)
    (project / "fixture_backend.py").write_text(
        "from pathlib import Path\nimport zipfile\n"
        f"METADATA = {metadata_text!r}\nPREFIX = {prefix!r}\n"
        "def prepare_metadata_for_build_wheel(metadata_directory, config_settings=None):\n"
        "    target = Path(metadata_directory) / PREFIX\n"
        "    target.mkdir()\n"
        "    (target / 'METADATA').write_text(METADATA)\n"
        "    return PREFIX\n"
        "def build_wheel(wheel_directory, config_settings=None, metadata_directory=None):\n"
        "    filename = PREFIX.removesuffix('.dist-info') + '-py3-none-any.whl'\n"
        "    with zipfile.ZipFile(Path(wheel_directory) / filename, 'w') as archive:\n"
        "        archive.writestr(PREFIX + '/METADATA', METADATA)\n"
        "        archive.writestr(PREFIX + '/WHEEL', 'Wheel-Version: 1.0\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n')\n"
        "        archive.writestr(PREFIX + '/RECORD', '')\n"
        "    return filename\n"
    )
    return project


def source_archive(directory, name):
    project = source_project(directory, name)
    archive = directory / f"{name}-1.0.0.tar.gz"
    with tarfile.open(archive, "w:gz") as output:
        output.add(project, arcname=f"{name}-1.0.0")
    return archive


def git_project(directory, name, requirements=()):
    project = source_project(directory, name, requirements)
    # Git projects need the backend to prepare metadata, as hatch-vcs does.
    # A pre-generated PKG-INFO would bypass the source-build restriction.
    (project / "PKG-INFO").unlink()
    env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
    common = ["git", "-C", str(project), "-c", "user.name=Release fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false"]
    for args in (["init", "-q"], ["add", "."], ["commit", "-qm", "Source fixture"]):
        subprocess.run([*common, *args], check=True, capture_output=True, env=env)
    commit = subprocess.check_output([*common, "rev-parse", "HEAD"], text=True, env=env).strip()
    return "git+" + project.as_uri() + "@" + commit, commit


class ReleaseTests(unittest.TestCase):
    def test_exact_artifact_contract_is_used(self):
        data = wheel()
        with tempfile.TemporaryDirectory() as directory, patch.object(installer, "download", side_effect=[metadata(data), data]):
            release = installer.prepare("cowork-server==1.0.0", Path(directory))
            self.assertEqual(release.contract, CONTRACT)
            self.assertEqual(Path(release.source).read_bytes(), data)
            self.assertEqual(release.version, "1.0.0")

    def test_bad_artifact_hash_fails(self):
        data = wheel()
        with tempfile.TemporaryDirectory() as directory, patch.object(installer, "download", side_effect=[metadata(data), data + b"changed"]):
            with self.assertRaisesRegex(ValueError, "hash"):
                installer.prepare("cowork-server==1.0.0", Path(directory))

    def test_old_release_requires_an_existing_installed_snapshot(self):
        data = wheel(contract=None)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(installer, "download", side_effect=[metadata(data), data]):
                with self.assertRaisesRegex(ValueError, "no reviewed dependency contract"):
                    installer.prepare("cowork-server==1.0.0", root)
            cache = root / "cache"
            cache.mkdir()
            key = hashlib.sha256(b"cowork-server==1.0.0").hexdigest()
            (cache / f"{key}.txt").write_text(CONTRACT)
            with patch.object(installer, "download", side_effect=[metadata(data), data]):
                self.assertEqual(installer.prepare("cowork-server==1.0.0", root, cache).contract, CONTRACT)

    def test_wrong_version_wheel_is_rejected_before_install(self):
        data = wheel(version="2.0.0")
        with tempfile.TemporaryDirectory() as directory, patch.object(installer, "download", side_effect=[metadata(data), data]):
            with self.assertRaisesRegex(ValueError, "identity"):
                installer.prepare("cowork-server==1.0.0", Path(directory))

    def test_incomplete_install_cannot_replace_saved_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / ".cowork-release-contracts"
            cache.mkdir()
            (cache / "install-incomplete").touch()
            python = root / "cowork-server" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            python.parent.mkdir(parents=True)
            python.touch()
            with patch.object(installer.subprocess, "run", side_effect=AssertionError("Rejected environment was inspected for snapshot")):
                self.assertEqual(installer.snapshot_installed("uv", root), cache)

    def test_cli_reports_preflight_failure_without_replacement(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(installer.subprocess, "check_output", return_value=directory), patch.object(installer, "prepare", side_effect=ValueError("missing contract")), patch.object(installer.subprocess, "run") as run, patch.object(sys, "argv", ["installer", "--", "tool", "install", "cowork-server==1.0.0"]):
            self.assertEqual(installer.main(), 2)
            run.assert_not_called()

    def test_contract_rejects_floating_and_external_requirements(self):
        for requirement in ["fixture>=1", "fixture @ https://example.com/f.whl", "--index-url https://example.com", "", "fixture==1.0"]:
            with self.subTest(requirement=requirement), self.assertRaises(ValueError):
                installer.requirement_lines(requirement)

    def test_markers_and_hashes_are_preserved(self):
        contract = 'anton-agent==1.0.0 \\\n    --hash=sha256:' + "a" * 64 + '\nfixture==1.0 ; sys_platform == "win32"\n'
        self.assertEqual(installer.requirement_lines(contract), ["anton-agent==1.0.0", 'fixture==1.0 ; sys_platform == "win32"'])
        self.assertEqual(installer.without_anton(contract), 'fixture==1.0 ; sys_platform == "win32"\n')

    def test_annotated_git_tag_is_bound_to_its_peeled_commit(self):
        output = f"{'a' * 40}\trefs/tags/v1\n{'b' * 40}\trefs/tags/v1^{{}}\n"
        with patch.object(installer.subprocess, "check_output", return_value=output):
            self.assertEqual(installer.git_commit(installer.REPOSITORY, "v1"), "b" * 40)

    def test_extra_dependency_fails_before_venv_creation_or_install(self):
        release = installer.Release("server.whl", CONTRACT, version="1.0.0")
        with patch.object(installer, "prepare", return_value=release), patch.object(installer.subprocess, "check_output", side_effect=[CONTRACT, CONTRACT + "unexpected==2.0\n"]), patch.object(installer.subprocess, "run") as run, patch.dict(os.environ, {"UV_OVERRIDE": ""}):
            with self.assertRaisesRegex(ValueError, "outside its reviewed contract"):
                installer.install("uv", ["tool", "install", "cowork-server==1.0.0"], Path("/unused/bin/python"))
            run.assert_not_called()

    @unittest.skipUnless(shutil.which("uv"), "requires uv")
    def test_real_resolver_keeps_exact_versions_and_refuses_missing_pin(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, version in [("anton_agent", "1.0.0"), ("fixture_dependency", "1.0.0"), ("fixture_dependency", "2.0.0")]:
                (root / f"{name}-{version}-py3-none-any.whl").write_bytes(wheel(name, version, contract=None))
            artifact = root / "cowork_server-1.0.0-py3-none-any.whl"
            artifact.write_bytes(wheel(requirements=["anton-agent>=1", "fixture-dependency>=1"]))
            contract = root / "contract.txt"
            contract.write_text(CONTRACT)
            env = {**os.environ, "UV_NO_INDEX": "true", "UV_FIND_LINKS": str(root), "UV_OVERRIDE": "", "UV_CONSTRAINT": "", "UV_CACHE_DIR": str(root / "cache")}
            actual_output = subprocess.check_output
            def local_output(args, **kwargs):
                return actual_output([*args, "--no-index", "--find-links", str(root)], **kwargs)
            release = installer.Release(str(artifact), CONTRACT)
            with patch.object(installer.subprocess, "check_output", side_effect=local_output):
                installer.preflight(shutil.which("uv"), release, root, contract, env)
                contract.write_text(CONTRACT.replace("fixture-dependency==1.0.0", "fixture-dependency==3.0.0"))
                with self.assertRaises(subprocess.CalledProcessError):
                    installer.preflight(shutil.which("uv"), release, root, contract, env)

    @unittest.skipUnless(shutil.which("uv") and shutil.which("git"), "requires uv and Git")
    def test_real_source_projects_do_not_allow_registry_source_builds(self):
        for server_source, anton_source in [(True, False), (False, True), (True, True)]:
            with self.subTest(server_source=server_source, anton_source=anton_source), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                registry = root / "registry"
                registry.mkdir()
                dependency = registry / "fixture_dependency-1.0.0-py3-none-any.whl"
                dependency.write_bytes(wheel("fixture_dependency", contract=None))
                (registry / "anton_agent-1.0.0-py3-none-any.whl").write_bytes(wheel("anton_agent", contract=None))
                requirements = ["anton-agent>=1", "fixture-dependency>=1"]
                server_commit = anton_commit = None
                if server_source:
                    source, server_commit = git_project(root, "cowork-server", requirements)
                else:
                    artifact = root / "cowork_server-1.0.0-py3-none-any.whl"
                    artifact.write_bytes(wheel(requirements=requirements))
                    source = str(artifact)
                env = {**os.environ, "UV_OFFLINE": "true", "UV_NO_CACHE": "true", "UV_OVERRIDE": "", "UV_CONSTRAINT": "", "UV_CACHE_DIR": str(root / "cache")}
                if anton_source:
                    override = root / "override.txt"
                    anton, anton_commit = git_project(root, "anton-agent")
                    override.write_text("anton-agent @ " + anton + "\n")
                    env["UV_OVERRIDE"] = str(override)
                contract = root / "contract.txt"
                contract.write_text(CONTRACT)
                release = installer.Release(source, CONTRACT, commit=server_commit, anton_commit=anton_commit)
                actual_output = subprocess.check_output
                def local_output(args, **kwargs):
                    return actual_output([*args, "--no-index", "--find-links", str(registry)], stderr=subprocess.PIPE, **kwargs)
                with patch.object(installer.subprocess, "check_output", side_effect=local_output):
                    try:
                        installer.preflight(shutil.which("uv"), release, root, contract, env)
                    except subprocess.CalledProcessError as failure:
                        self.fail("Selected source project was rejected: " + failure.stderr)
                    # The exact same registry version remains available as a valid
                    # source distribution, but only the selected projects may build.
                    dependency.unlink()
                    source_archive(registry, "fixture-dependency")
                    env["UV_CACHE_DIR"] = str(root / "source-only-cache")
                    with self.assertRaises(subprocess.CalledProcessError) as failure:
                        installer.preflight(shutil.which("uv"), release, root, contract, env)
                    self.assertIn("fixture-dependency", failure.exception.stderr)
                    self.assertIn("no usable wheels", failure.exception.stderr)

    def test_cached_wheel_and_snapshot_restore_without_http(self):
        data = wheel(contract=None)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / "cache"
            cache.mkdir()
            key = hashlib.sha256(b"cowork-server==1.0.0").hexdigest()
            (cache / f"{key}.txt").write_text(CONTRACT)
            with patch.object(installer, "download", side_effect=[metadata(data), data]):
                installer.prepare("cowork-server==1.0.0", root, cache)
            with patch.object(installer, "download", side_effect=AssertionError("rollback requested HTTP")):
                restored = installer.prepare("cowork-server==1.0.0", root, cache)
                self.assertEqual(restored.contract, CONTRACT)
                self.assertEqual(Path(restored.source).read_bytes(), data)

    def test_unrecoverable_healthy_install_stops_before_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            python = root / "cowork-server" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            python.parent.mkdir(parents=True)
            python.touch()
            with patch.object(installer.subprocess, "run", side_effect=[subprocess.CompletedProcess([], 0), subprocess.CompletedProcess([], 1, "", "custom dependency source")]):
                with self.assertRaisesRegex(ValueError, "Cannot preserve"):
                    installer.snapshot_installed("uv", root)

    @unittest.skipUnless(shutil.which("uv") and shutil.which("git"), "requires uv, Git and packaging")
    def test_real_tool_install_native_hashes_and_legacy_git_snapshot(self):
        packaging = importlib.metadata.distribution("packaging")
        package_files = {str(file).replace("\\", "/"): file.locate().read_bytes() for file in packaging.files if str(file).startswith("packaging/") and str(file).endswith(".py")}
        packaging_wheel = wheel("packaging", packaging.version, contract=None, extra_files=package_files)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            registry = root / "registry"
            registry.mkdir()
            contract = ""
            for name, version, data in [
                ("anton_agent", "1.0.0", wheel("anton_agent", contract=None)),
                ("fixture_dependency", "1.0.0", wheel("fixture_dependency", contract=None)),
                ("packaging", packaging.version, packaging_wheel),
            ]:
                (registry / f"{name}-{version}-py3-none-any.whl").write_bytes(data)
                contract += f"{name.replace('_', '-')}=={version} \\\n    --hash=sha256:{hashlib.sha256(data).hexdigest()}\n"
            (registry / "fixture_dependency-2.0.0-py3-none-any.whl").write_bytes(wheel("fixture_dependency", "2.0.0", contract=None))
            data = wheel(requirements=["anton-agent>=1", "fixture-dependency>=1", "packaging"], contract=contract)
            local_anton, native_anton_commit = git_project(root, "anton-agent")
            official_anton = f"git+https://github.com/mindsdb/anton.git@{native_anton_commit}"
            local_override = root / "local-override.txt"
            local_override.write_text("anton-agent @ " + local_anton + "\n")
            actual_run, actual_output = subprocess.run, subprocess.check_output
            def command(args):
                args = [arg.replace(official_anton, local_anton) for arg in args]
                for arg in args:
                    if arg.endswith(".txt") and Path(arg).is_file():
                        text = Path(arg).read_text()
                        if official_anton in text:
                            Path(arg).write_text(text.replace(official_anton, local_anton))
                return [*args, "--no-index", "--find-links", str(registry)] if args[1:3] in (["pip", "compile"], ["pip", "install"], ["tool", "install"]) else args
            def run(args, **kwargs):
                environment = kwargs.get("env", os.environ)
                if environment.get("UV_OVERRIDE") and official_anton in Path(environment["UV_OVERRIDE"]).read_text():
                    # Redirect only Git transport. Preserve whether the real
                    # installer passes the override to each actual uv command.
                    kwargs["env"] = {**environment, "UV_OVERRIDE": str(local_override)}
                if "--require-hashes" in args:
                    kwargs["stderr"] = subprocess.PIPE
                return actual_run(command(args), **kwargs)
            def output(args, **kwargs):
                return actual_output(args, **kwargs)
            tools = root / "tools"
            env = {"UV_TOOL_DIR": str(tools), "UV_TOOL_BIN_DIR": str(root / "bin"), "UV_CACHE_DIR": str(root / "uv-cache"), "UV_OFFLINE": "true", "UV_OVERRIDE": "", "UV_CONSTRAINT": ""}
            with patch.dict(os.environ, env), patch.object(installer.subprocess, "run", side_effect=run), patch.object(installer.subprocess, "check_output", side_effect=output), patch.object(installer, "download", side_effect=lambda url: metadata(data) if url.endswith("json") else data):
                installer.install(shutil.which("uv"), ["tool", "install", "--force", "cowork-server==1.0.0"])
                python = tools / "cowork-server" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
                version = actual_output([str(python), "-c", "from importlib.metadata import version; print(version('fixture-dependency'))"], text=True)
                self.assertEqual(version.strip(), "1.0.0")
                # An override must not hide the server's original Anton range:
                # reject the incompatible Git source before touching a working tool.
                candidate = root / "cowork_server-2.0.0-py3-none-any.whl"
                candidate.write_bytes(wheel(version="2.0.0", requirements=["anton-agent>=2,<3", "fixture-dependency>=1", "packaging"], contract=contract))
                rejected = installer.Release(str(candidate), contract, version="2.0.0", anton_commit=native_anton_commit)
                override = root / "official-override.txt"
                override.write_text("anton-agent @ " + official_anton + "\n")
                def tool_files():
                    return {str(path.relative_to(tools)): hashlib.sha256(path.read_bytes()).hexdigest()
                            for path in (tools / "cowork-server").rglob("*") if path.is_file()}
                before = tool_files()
                with patch.dict(os.environ, {"UV_OVERRIDE": str(override)}), patch.object(installer, "prepare", return_value=rejected):
                    state = installer.InstallState()
                    with self.assertRaises(subprocess.CalledProcessError):
                        installer.install(shutil.which("uv"), ["tool", "install", "--force", "--reinstall", "cowork-server==2.0.0"], state=state)
                    self.assertFalse(state.changed, "incompatible source reached live tool replacement")
                    self.assertEqual(tool_files(), before)
                    self.assertFalse((tools / ".cowork-release-contracts/install-incomplete").exists())
                    native_rejected = root / "native-rejected" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
                    with self.assertRaises(subprocess.CalledProcessError):
                        installer.install(shutil.which("uv"), ["tool", "install", "cowork-server==2.0.0"], native_rejected)
                    self.assertFalse(native_rejected.parent.parent.exists())
                # Compatible local drift must not supersede the embedded release contract.
                run([shutil.which("uv"), "pip", "install", "--python", str(python), "--no-deps", "fixture-dependency==2.0.0"], check=True)
                installer.install(shutil.which("uv"), ["tool", "install", "--force", "--reinstall", "cowork-server==1.0.0"])
                version = actual_output([str(python), "-c", "from importlib.metadata import version; print(version('fixture-dependency'))"], text=True)
                self.assertEqual(version.strip(), "1.0.0")
                with patch.object(installer, "verify", side_effect=ValueError("rejected inventory")), patch.object(sys, "argv", ["installer", "--uv", shutil.which("uv"), "--", "tool", "install", "--force", "--reinstall", "cowork-server==1.0.0"]):
                    self.assertEqual(installer.main(), 1)
                marker = tools / ".cowork-release-contracts/install-incomplete"
                self.assertTrue(marker.is_file())
                installer.install(shutil.which("uv"), ["tool", "install", "--force", "--reinstall", "cowork-server==1.0.0"])
                self.assertFalse(marker.exists())
                # Model an existing official Git-channel environment using real
                # installed metadata. Its commit must survive snapshot/prepare.
                site = Path(actual_output([str(python), "-c", "import sysconfig; print(sysconfig.get_paths()['purelib'])"], text=True).strip())
                server_commit, anton_commit = "a" * 40, "b" * 40
                for name, repo, commit in [("cowork_server", "cowork-server", server_commit), ("anton_agent", "anton", anton_commit)]:
                    (site / f"{name}-1.0.0.dist-info" / "direct_url.json").write_text(json.dumps({"url": f"https://github.com/mindsdb/{repo}.git", "vcs_info": {"vcs": "git", "commit_id": commit}}))
                cache = installer.snapshot_installed(shutil.which("uv"), tools)
                with patch.object(installer, "download", side_effect=AssertionError("rollback requested HTTP")):
                    restored = installer.prepare(f"git+{installer.REPOSITORY}@{server_commit}", root, cache)
                self.assertEqual(restored.anton_commit, anton_commit)
                installer.verify(python, restored)
                native = root / "native" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
                installer.install(shutil.which("uv"), ["tool", "install", "cowork-server==1.0.0"], native)
                override = root / "official-override.txt"
                override.write_text("anton-agent @ " + official_anton + "\n")
                with patch.dict(os.environ, {"UV_OVERRIDE": str(override)}):
                    # Desktop resolution must retain the selected Git override;
                    # the later native phases install that source explicitly.
                    installer.install(shutil.which("uv"), ["tool", "install", "--force", "--reinstall", "cowork-server==1.0.0"])
                    desktop_url = json.loads(actual_output([str(python), "-c", "from importlib.metadata import distribution; print(distribution('anton-agent').read_text('direct_url.json'))"], text=True))
                    self.assertEqual(desktop_url["vcs_info"]["commit_id"], native_anton_commit)
                    native_git = root / "native-git" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
                    try:
                        installer.install(shutil.which("uv"), ["tool", "install", "cowork-server==1.0.0"], native_git)
                    except subprocess.CalledProcessError as failure:
                        self.fail(f"Native Git install failed: {failure.stderr}")
                    direct_url = json.loads(actual_output([str(native_git), "-c", "from importlib.metadata import distribution; print(distribution('anton-agent').read_text('direct_url.json'))"], text=True))
                    self.assertEqual(direct_url["vcs_info"]["commit_id"], native_anton_commit)
                    # The Git exception must not bypass registry hash checking.
                    data = wheel(requirements=["anton-agent>=1", "fixture-dependency>=1", "packaging"], contract=contract.replace(hashlib.sha256(packaging_wheel).hexdigest(), "0" * 64))
                    with self.assertRaises(subprocess.CalledProcessError) as failure:
                        installer.install(shutil.which("uv"), ["tool", "install", "cowork-server==1.0.0"], root / "bad-hash" / ("Scripts/python.exe" if os.name == "nt" else "bin/python"))
                    self.assertIn(b"Hash mismatch", failure.exception.stderr)



if __name__ == "__main__":
    unittest.main()
