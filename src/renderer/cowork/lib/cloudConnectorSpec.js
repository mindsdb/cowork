// Shape a connector spec for the hosted path.
//
// A connector method may carry a `cloud` block. It is a COMPLETE replacement
// for that method in cloud, not a delta on it: the desktop copy documents
// choices the hosted path refuses (disabling TLS, pointing at localhost), and
// the desktop field list names things the relay will not accept, so rendering
// either to a cloud user describes a form that cannot be submitted.
//
// A method without the block cannot be submitted in cloud at all — the server
// supports one method per database connector and refuses the rest — so it is
// not offered rather than offered and rejected. A connector with no cloud
// block anywhere is returned untouched; that is every OAuth connector, and
// cloud already runs those through their own path.

export function isCloudDatasourceSpec(spec) {
  const methods = Array.isArray(spec?.methods) ? spec.methods : [];
  return methods.some((m) => m && m.cloud);
}

export function toCloudSpec(spec) {
  if (!isCloudDatasourceSpec(spec)) return spec;

  const methods = spec.methods
    .filter((m) => m?.cloud?.available)
    .map((m) => {
      const { cloud, ...rest } = m;
      return {
        ...rest,
        fields: Array.isArray(cloud.fields) ? cloud.fields : [],
        ...(cloud.description ? { description: cloud.description } : {}),
        ...(cloud.how_to ? { how_to: cloud.how_to } : {}),
      };
    });

  return {
    ...spec,
    methods,
    // Read by the form: this one publishes no snapshot of its values, because
    // the chat layer appends that snapshot to the next message the user sends.
    _cloud_datasource: true,
  };
}
