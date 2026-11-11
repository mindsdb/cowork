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
// not offered rather than offered and rejected. The exception is an OAuth
// method: it never reaches the datasource route, cloud runs it through its own
// path, so it stays beside the cloud form (Supabase has both). A connector
// with no cloud block anywhere is returned untouched.

import i18n from '../../lib/i18n';

export function isCloudDatasourceSpec(spec) {
  const methods = Array.isArray(spec?.methods) ? spec.methods : [];
  return methods.some((m) => m && m.cloud);
}

// An edit re-opens this form: the relay requires the password on every edit,
// and nothing on the connections page can pre-fill it, so the user retypes it
// beside the values they are changing. The connection's id and the version
// they opened travel with the spec; the version is what lets the server tell
// this edit from one made somewhere else in the meantime.
export function toCloudSpec(spec, connection = null) {
  if (!isCloudDatasourceSpec(spec)) return spec;

  const methods = spec.methods
    // An edit form edits a saved database connection, so it offers no OAuth.
    .filter((m) => m?.cloud?.available || (m?.oauth && !connection))
    .map((m) => {
      if (!m.cloud) return m;
      const { cloud, ...rest } = m;
      return {
        ...rest,
        fields: Array.isArray(cloud.fields) ? cloud.fields : [],
        // Unconditional, because the block is a replacement: a cloud method
        // that omits its copy shows none, rather than inheriting desktop text
        // that documents optional TLS and a local server.
        description: cloud.description ?? null,
        how_to: cloud.how_to ?? null,
      };
    });

  const editing = connection
    ? {
        _datasource_edit: { id: connection.datasourceId, expectedRevision: connection.revision },
        // Everything but the password, which only auth holds.
        name: connection.name,
        user_label: connection.name,
        title: i18n.t('messages.cloudConnector.editTitle', { ns: 'projects', name: connection.name }),
        methods: methods.map((m) => ({
          ...m,
          fields: (m.fields || []).map((f) => {
            if (f.secret || f.type === 'password') return f;
            const prior = {
              host: connection.hostMasked?.includes('*') ? '' : connection.hostMasked,
              port: connection.port,
              database: connection.database,
              schema: connection.dbSchema,
              username: connection.username,
              tls_mode: connection.tlsMode,
              // A boolean field takes its state from `default`, and the line
              // below skips an empty one, so an unverified connection simply
              // leaves the box as it starts: unchecked.
              tls_verify: connection.tlsMode === 'system' ? true : '',
            }[f.name];
            if (prior == null || prior === '') return f;
            // A boolean keeps its type: stringifying it renders the box
            // checked while the submitted value no longer reads as true.
            return { ...f, default: typeof prior === 'boolean' ? prior : String(prior) };
          }),
        })),
      }
    : {};

  return {
    ...spec,
    methods,
    // Read by the form: this one publishes no snapshot of its values, because
    // the chat layer appends that snapshot to the next message the user sends.
    _cloud_datasource: true,
    ...editing,
  };
}
