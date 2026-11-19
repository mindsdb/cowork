# Supplied server dependency contract

Place `requirements.lock` and `sources.json` in this directory, then build with
`--build-arg COWORK_SERVER_LOCK=true`. Without that argument the Dockerfile uses
its normal version/ref installer.

The requirements file contains only exact registry pins with SHA-256 hashes,
including every transitive dependency. Each version needs a wheel compatible
with the image's platform and Python. Include PyJWT at or above 2.13.0.

The source metadata identifies the two Git projects independently:

```json
{
  "sources": {
    "cowork-server": {"version": "<exact version>", "commit": "<full commit>"},
    "anton-agent": {"version": "<exact version>", "commit": "<full commit>"}
  }
}
```

These source identities replace `COWORK_SERVER_REF`, `COWORK_SERVER_VERSION`,
and `ANTON_REF` selection for this build. The installer rejects source, version,
dependency, or inventory mismatches before importing the app. It never resolves
replacement application dependencies. The files are build inputs; they are not
automatically updated by a build.

The two Git projects are built from those commits. Their isolated build-backend
dependencies are outside the registry lock. Builds still need network access to
download the exact artifacts and sources.
