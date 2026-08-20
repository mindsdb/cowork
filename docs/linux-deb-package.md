# Linux Debian package

`npm run dist:linux` builds a `.deb` for the **host architecture** via
electron-builder into `release/`, named `mindshub-cowork_<version>_<arch>.deb`.

## Build on Linux only, one arch per host

The deb target must be built on a Linux host (CI runner, VM, or container),
and only for that host's architecture:

- Cross-building from macOS appears to succeed but fpm falls back to BSD `ar`
  and emits corrupt ~96-byte archives.
- Cross-building the other Linux arch breaks native modules: `keytar`
  (keychain-service) must be compiled/rebuilt for the target arch, which
  node-gyp can't cross-compile. CI therefore runs one job per arch
  (`ubuntu-latest` for amd64, `ubuntu-24.04-arm` for arm64) — see
  `.github/workflows/build-linux-deb.yml`.

To build from a Mac, use a container (arm64 on Apple Silicon):

```bash
docker run --rm \
  -v "$PWD":/work -v /work/node_modules -v /work/release \
  -v "$PWD/release-linux":/out \
  -w /work node:20-bullseye \
  bash -c 'npm ci && npm run dist:linux -- --config.directories.output=/out'
```

The anonymous volumes keep the container's Linux `node_modules` and build
output from clobbering the host's.

## Package behavior

- Installs to `/opt/MindsHub Cowork/`, with `mindshub-cowork` on `PATH` via
  `update-alternatives`, plus a desktop entry and hicolor icon.
- Declares `git` and `curl` as dependencies: `curl` for the first-run `uv`
  bootstrap (`curl | sh`), and `git` for the per-task worktrees coding mode
  creates inside a project folder. Neither is guaranteed on a minimal Debian.
  `libsecret-1-0` (keytar's runtime dependency) is part of
  electron-builder's default deb depends and is kept in the list.
- The deb is unsigned, unlike the signed mac/windows installers; there is no
  apt repository yet, so distribution is a direct `.deb` download installed
  with `sudo apt install ./mindshub-cowork_<version>_<arch>.deb`.

## CI

`.github/workflows/build-linux-deb.yml` builds each arch natively and is
wired into the same orchestrators as mac/windows: label a PR
`build-linux-deb` to build `preview` (one label, both arches — the upload job
publishes into the production installer bucket, so it opts in like the signed
mac/windows installers do), pushes to `staging` build `stable` (against the
staging server ref and API), releases build `prod` with the CalVer tag baked
in. Uploads go through
`upload-installer-to-s3.yml` with
platforms `linux-amd64` / `linux-arm64` — one call per arch, because the
uploader's stable/prod alias objects (`mindshub-cowork-staging.deb`,
`mindshub-cowork-latest.deb`) are keyed only by platform prefix and the two
architectures would otherwise overwrite each other.

As with local Windows/macOS builds, `server-credentials.json` (Google OAuth
client IDs baked in by CI) is absent locally, so local debs skip the bundled
credentials — the runtime treats that as dev mode.
