#!/usr/bin/env bash
set -Eeuo pipefail

readonly PLATFORM_ROOT="${PLATFORM_ROOT:-/opt/betterp}"
readonly COMPOSE_ROOT="$PLATFORM_ROOT/compose"
readonly CONFIG_ROOT="$PLATFORM_ROOT/config"
readonly RELEASE_ROOT="$PLATFORM_ROOT/releases"
readonly RELEASE_ENV="${RELEASE_ENV:-$CONFIG_ROOT/release-images.env}"

compose() {
  docker compose \
    --env-file "$RELEASE_ENV" \
    -f "$COMPOSE_ROOT/compose.yaml" \
    -f "$COMPOSE_ROOT/compose.release.yaml" \
    -f "$COMPOSE_ROOT/compose.edge.yaml" \
    -f "$COMPOSE_ROOT/compose.saas-scheduler.yaml" \
    --profile edge --profile scheduled --profile workers "$@"
}

fail() {
  echo "release_preflight=failed|reason=$1" >&2
  exit 1
}

container_has_env() {
  local container="$1" expected="$2"
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" 2>/dev/null \
    | grep -Fqx -- "$expected"
}

[[ -r "$RELEASE_ENV" ]] || fail "missing_release_env"
set -a
# shellcheck disable=SC1090
source "$RELEASE_ENV"
set +a

for variable in BETTERP_COMMIT BETTERP_IMAGE BETTERP_DEPLOY_ID TIENDA_FACIL_COMMIT TIENDA_FACIL_IMAGE; do
  [[ -n "${!variable:-}" ]] || fail "missing_$variable"
done
[[ "$BETTERP_DEPLOY_ID" =~ ^[A-Za-z0-9._-]{8,96}$ ]] || fail "invalid_BETTERP_DEPLOY_ID"

declare -A commits=(
  [betterp]="$BETTERP_COMMIT"
  [tienda-facil]="$TIENDA_FACIL_COMMIT"
)
declare -A images=(
  [betterp]="$BETTERP_IMAGE"
  [tienda-facil]="$TIENDA_FACIL_IMAGE"
)
declare -A containers=(
  [betterp]="betterp-platform-betterp-api-1 betterp-platform-betterp-scheduler-1 betterp-platform-betterp-background-worker-1"
  [tienda-facil]="betterp-platform-tienda-facil-api-1 betterp-platform-tienda-facil-marketplace-worker-1 betterp-platform-tienda-facil-marketplace-outbox-worker-1 betterp-platform-tienda-facil-marketplace-webhook-worker-1"
)

for app in betterp tienda-facil; do
  commit="${commits[$app]}"
  image_name="${images[$app]}"
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || fail "invalid_commit_$app"
  [[ "$image_name" =~ ^local/[a-z0-9-]+-backend:[0-9a-f]{7,40}$ ]] || fail "invalid_image_$app"
  release_path="$(readlink -f "$RELEASE_ROOT/$app/current" 2>/dev/null || true)"
  [[ "$release_path" == "$RELEASE_ROOT/$app/$commit" ]] || fail "release_link_mismatch_$app"
  [[ -f "$release_path/Dockerfile.vultr" ]] || fail "missing_dockerfile_$app"
  docker image inspect "$image_name" >/dev/null 2>&1 || fail "missing_image_$app"

  for container in ${containers[$app]}; do
    actual_image="$(docker inspect --format '{{.Config.Image}}' "$container" 2>/dev/null || true)"
    [[ "$actual_image" == "$image_name" ]] || fail "container_image_mismatch_$container"
  done
done

for container in \
  betterp-platform-betterp-api-1 \
  betterp-platform-betterp-scheduler-1 \
  betterp-platform-betterp-background-worker-1; do
  container_has_env "$container" "BETTERP_GIT_COMMIT=$BETTERP_COMMIT" || fail "commit_identity_$container"
  container_has_env "$container" "BETTERP_DEPLOY_ID=$BETTERP_DEPLOY_ID" || fail "deploy_identity_$container"
  container_has_env "$container" "BETTERP_PLATFORM=vultr" || fail "platform_identity_$container"
  container_has_env "$container" "BETTERP_RUNTIME=docker" || fail "runtime_identity_$container"
  container_has_env "$container" "BETTERP_LOG_BACKEND=docker-json-file" || fail "log_backend_identity_$container"
done

compose config --quiet || fail "compose_config"
[[ -r "$CONFIG_ROOT/betterp.saas.cron" ]] || fail "missing_saas_cron_manifest"
[[ "$(grep -Ec '^[0-9*]' "$CONFIG_ROOT/betterp.saas.cron")" == "6" ]] \
  || fail "invalid_saas_cron_job_count"
if grep -Eiq 'render|vende[ _-]?facil|keepalive|payment_reminders' \
    "$CONFIG_ROOT/betterp.saas.cron"; then
  fail "retired_scheduler_expectation"
fi
docker exec betterp-platform-betterp-scheduler-1 test -x /usr/bin/flock \
  || fail "scheduler_flock_missing"
host_cron_hash="$(sha256sum "$CONFIG_ROOT/betterp.saas.cron" | awk '{print $1}')"
container_cron_hash="$(
  docker exec betterp-platform-betterp-scheduler-1 sha256sum /etc/cron.d/betterp \
    | awk '{print $1}'
)"
[[ "$host_cron_hash" == "$container_cron_hash" ]] || fail "scheduler_manifest_mismatch"
"$CONFIG_ROOT/platform_health_check.sh" >/dev/null || fail "platform_health"

for mode_container in \
  "betterp:betterp-platform-betterp-api-1" \
  "tienda-facil:betterp-platform-tienda-facil-api-1"; do
  mode="${mode_container%%:*}"
  container="${mode_container#*:}"
  if ! docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" \
      | python3 "$CONFIG_ROOT/verify-runtime-safety.py" "$mode" >/dev/null; then
    fail "runtime_safety_$mode"
  fi
done

if [[ "${PUBLIC_SMOKE:-true}" == "true" ]]; then
  "$CONFIG_ROOT/public_smoke.sh" >/dev/null || fail "public_smoke"
fi

echo "release_preflight=ok|apps=2|services=7|identity=verified|public_smoke=${PUBLIC_SMOKE:-true}|values_disclosed=no"
