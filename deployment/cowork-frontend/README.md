# cowork-frontend

This helm chart is just using a subchart of our standardized deployment helm charts.

It deploys the static cowork SPA (built by `Dockerfile.frontend`, served by
nginx on port 8080). It has no backend, no database, and no secrets: the SPA
talks to cowork-server same-origin at `/api/v1/*`.

## Introduction

This chart bootstraps a highly available deployment on a [Kubernetes](http://kubernetes.io) cluster using the [Helm](https://helm.sh) package manager.

## Prerequisites

- Kubernetes 1.10+ with Beta APIs enabled
- The kubectl binary
- The helm binary
- Helm diff plugin installed

## Installing the Chart

```bash
# dev
export SERVICE_NAME="cowork-frontend"
export CI_ENVIRONMENT_SLUG="dev"
export K8S_NAMESPACE="dev"
export HELM_CHART=$SERVICE_NAME
export CURRENT_HELM_CHART=$SERVICE_NAME
export HELM_IMG_TAG="latest" # Change this to the tag of the image you want to deploy


# Go into our deployment folder
cd deployment
# Update our helm subchart (fetches the pinned deployment subchart into charts/)...
helm dependencies update $SERVICE_NAME/
# View the diff of what you want to do
helm diff upgrade --namespace $K8S_NAMESPACE --allow-unreleased $CURRENT_HELM_CHART $HELM_CHART     -f $CURRENT_HELM_CHART/values.yaml     -f $CURRENT_HELM_CHART/values-${CI_ENVIRONMENT_SLUG}.yaml --set global.namespace="$K8S_NAMESPACE" --set global.image.tag="$HELM_IMG_TAG"
# Actually do it...
helm upgrade --namespace $K8S_NAMESPACE --install $CURRENT_HELM_CHART $HELM_CHART     -f $CURRENT_HELM_CHART/values.yaml     -f $CURRENT_HELM_CHART/values-${CI_ENVIRONMENT_SLUG}.yaml  --set global.namespace="$K8S_NAMESPACE" --set global.image.tag="$HELM_IMG_TAG"
```

Swap `CI_ENVIRONMENT_SLUG` / `K8S_NAMESPACE` for `staging` or `prod` to target those environments.

## Ingress topology

The SPA and cowork-server share the host `cowork.<env>.mindshub.ai`:

- `/`         -> this chart's `cowork-frontend` Service (static SPA)
- `/api/v1/*` -> the `cowork-server` chart's Service

Each chart owns its own Ingress resource on that host, split by path. The
cowork-server chart's per-env ingress path is `/api` (narrowed from `/` when
this chart was added); nginx routes the more specific `/api` prefix to
cowork-server and everything else to the SPA. Keep the two in sync when adding
an environment.

## Required cluster secrets

None. The chart deploys a static asset server only.

## Configuration

For configuration options possible, please see our [helm-charts](#todo) repository.
