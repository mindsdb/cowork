// Copied verbatim from the genie-mcp method in cowork-server's databricks connector spec.
export const GENIE_METHOD = {
  "id": "genie-mcp",
  "name_from": [
    "client_id",
    "workspace_url"
  ],
  "label": "Databricks Genie",
  "description": "Ask Databricks Genie questions about your data in plain language, using a service principal's OAuth client ID and secret.",
  "recommended": false,
  "how_to": "## Connect Databricks Genie with a service principal\n\nGenie answers questions about your data through its own MCP server. Anton signs in as a service principal, so access follows that principal's permissions.\n\n### 1 — Find your workspace URL\n\nCopy the workspace address from your browser, for example `https://adb-1234567890123456.7.azuredatabricks.net`. A pasted address with `?o=` at the end works too.\n\n### 2 — Create a service principal and its secret\n\n1. Go to **Settings → Identity & access → Service principals → Add service principal**.\n2. Note its **Application (client) ID**.\n3. Open the service principal → **Secrets** tab → **Generate secret**, and copy the secret. It is shown only once.\n\n### 3 — Grant access\n\n1. On the SQL warehouse Genie uses, give the service principal **Can use**.\n2. On the Genie Agent, give the service principal **Can run**.\n3. Grant it read access in Unity Catalog to the tables Genie answers from.\n\n### 4 — Optional: one Genie space\n\nLeave **Genie space ID** blank to use every space the service principal can run. To use one space, paste the 32 character ID from the space's address.\n\n### Notes\n\n- The secret is checked once when you save: Anton signs in and lists Genie's tools.\n- Rotate the secret under the service principal's **Secrets** tab, then update this connector.",
  "help_url": "https://docs.databricks.com/en/dev-tools/auth/oauth-m2m.html",
  "fields": [
    {
      "name": "workspace_url",
      "label": "Workspace URL",
      "type": "url",
      "required": true,
      "placeholder": "https://adb-1234567890123456.7.azuredatabricks.net",
      "description": "The address of your Databricks workspace. A URL copied from the browser works."
    },
    {
      "name": "client_id",
      "label": "Service Principal Client ID",
      "type": "text",
      "required": true,
      "placeholder": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "description": "The Application (client) ID of the service principal."
    },
    {
      "name": "client_secret",
      "label": "Service Principal Secret",
      "type": "password",
      "required": true,
      "secret": true,
      "placeholder": "dose…",
      "description": "Generated under the service principal's Secrets tab. Shown only once."
    },
    {
      "name": "genie_space_id",
      "label": "Genie space ID",
      "type": "text",
      "required": false,
      "placeholder": "01f0a1b2c3d4e5f60718293a4b5c6d7e",
      "description": "Optional. Leave blank to use every Genie space the service principal can run."
    }
  ]
};
