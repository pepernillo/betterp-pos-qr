#!/usr/bin/env bash
set -Eeuo pipefail

readonly PLATFORM_ROOT="${PLATFORM_ROOT:-/opt/betterp}"
readonly COMPOSE_ROOT="$PLATFORM_ROOT/compose"
readonly CONFIG_ROOT="$PLATFORM_ROOT/config"
readonly RELEASE_ROOT="$PLATFORM_ROOT/releases"
readonly ACTIVE_ENV="$CONFIG_ROOT/release-images.env"
readonly STATE_ROOT="$PLATFORM_ROOT/state/releases"
readonly LOCK_FILE="/run/lock/betterp-release-deploy.lock"

app=""
commit=""
confirmation=""
apply="false"
allow_migrations="false"

while (($#)); do
  case "$1" in
    --app) app="${2:-}"; shift 2 ;;
    --commit) commit="${2:-}"; shift 2 ;;
    --confirmation) confirmation="${2:-}"; shift 2 ;;
    --apply) apply="true"; shift ;;
    --allow-migrations) allow_migrations="true"; shift ;;
    *) echo "deploy_release=failed|reason=unknown_argument" >&2; exit 2 ;;
  esac
done

case "$app" in betterp|vendefacil|tienda-facil) ;; *) echo "deploy_release=failed|reason=invalid_app" >&2; exit 2 ;; esac
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "deploy_release=failed|reason=invalid_commit" >&2; exit 2; }
[[ -r "$ACTIVE_ENV" ]] || { echo "deploy_release=failed|reason=missing_active_env" >&2; exit 1; }

case "$app" in
  betterp)
    commit_key="BETTERP_COMMIT"; image_key="BETTERP_IMAGE"; image_repository="local/betterp-backend"
    prepare_service="betterp-prepare"
    services=(betterp-api betterp-scheduler betterp-background-worker) ;;
  vendefacil)
    commit_key="VENDEFACIL_COMMIT"; image_key="VENDEFACIL_IMAGE"; image_repository="local/vendefacil-backend"
    prepare_service="vendefacil-prepare"; services=(vendefacil-api) ;;
  tienda-facil)
    commit_key="TIENDA_FACIL_COMMIT"; image_key="TIENDA_FACIL_IMAGE"; image_repository="local/tienda-facil-backend"
    prepare_service="tienda-facil-prepare"
    services=(tienda-facil-api tienda-facil-marketplace-worker tienda-facil-marketplace-outbox-worker tienda-facil-marketplace-webhook-worker) ;;
esac

image="$image_repository:$commit"
release_path="$RELEASE_ROOT/$app/$commit"
[[ -d "$release_path" ]] || { echo "deploy_release=failed|reason=release_not_staged" >&2; exit 1; }
[[ -f "$release_path/.release-metadata.env" ]] || { echo "deploy_release=failed|reason=release_not_sealed" >&2; exit 1; }
grep -qx "COMMIT=$commit" "$release_path/.release-metadata.env" || { echo "deploy_release=failed|reason=release_commit_mismatch" >&2; exit 1; }
docker image inspect "$image" >/dev/null 2>&1 || { echo "deploy_release=failed|reason=image_not_staged" >&2; exit 1; }

exec 9>"$LOCK_FILE"
flock -n 9 || { echo "deploy_release=failed|reason=deploy_locked" >&2; exit 1; }
"$CONFIG_ROOT/platform_health_check.sh" >/dev/null

mkdir -p "$STATE_ROOT"
candidate="$(mktemp "$STATE_ROOT/release-images.candidate.XXXXXX")"
cleanup_candidate() { rm -f -- "$candidate"; }
trap cleanup_candidate EXIT

current_commit="$(awk -F= -v key="$commit_key" '$1==key {print $2}' "$ACTIVE_ENV")"
current_image="$(awk -F= -v key="$image_key" '$1==key {print $2}' "$ACTIVE_ENV")"
previous_deploy_id="$(awk -F= '$1=="BETTERP_DEPLOY_ID" {print $2}' "$ACTIVE_ENV")"
current_betterp_commit="$(awk -F= '$1=="BETTERP_COMMIT" {print $2}' "$ACTIVE_ENV")"

awk -v ck="$commit_key" -v cv="$commit" -v ik="$image_key" -v iv="$image" '
  BEGIN {commit_seen=0; image_seen=0}
  $0 ~ "^" ck "=" {$0=ck "=" cv; commit_seen=1}
  $0 ~ "^" ik "=" {$0=ik "=" iv; image_seen=1}
  {print}
  END {if (!commit_seen || !image_seen) exit 3}
' "$ACTIVE_ENV" >"$candidate" || { echo "deploy_release=failed|reason=active_env_keys" >&2; exit 1; }

upsert_env_key() {
  local file="$1" key="$2" value="$3" temporary
  temporary="$(mktemp "$STATE_ROOT/release-env.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN {seen=0}
    $0 ~ "^" key "=" {$0=key "=" value; seen=1}
    {print}
    END {if (!seen) print key "=" value}
  ' "$file" >"$temporary"
  mv "$temporary" "$file"
}

deployment_id="$(date -u +%Y%m%dT%H%M%SZ)-$app-${commit:0:12}"
if [[ "$app" == "betterp" ]]; then
  candidate_deploy_id="$deployment_id"
elif [[ -n "$previous_deploy_id" ]]; then
  candidate_deploy_id="$previous_deploy_id"
else
  candidate_deploy_id="legacy-betterp-${current_betterp_commit:0:12}"
fi
upsert_env_key "$candidate" "BETTERP_DEPLOY_ID" "$candidate_deploy_id"

compose_candidate() {
  docker compose \
    --env-file "$candidate" \
    -f "$COMPOSE_ROOT/compose.yaml" \
    -f "$COMPOSE_ROOT/compose.release.yaml" \
    -f "$COMPOSE_ROOT/compose.edge.yaml" \
    -f "$COMPOSE_ROOT/compose.saas-scheduler.yaml" \
    --profile edge --profile scheduled --profile workers "$@"
}

compose_candidate config --quiet
if [[ "$apply" != "true" ]]; then
  echo "deploy_release=preview|app=$app|from_commit=$current_commit|to_commit=$commit|image=$image|deploy_id=$candidate_deploy_id|migrations=not_evaluated|writes=no"
  exit 0
fi

[[ "$confirmation" == "DESPLEGAR_RELEASE_VULTR" ]] || { echo "deploy_release=failed|reason=confirmation_required" >&2; exit 1; }
[[ "$current_commit" != "$commit" ]] || { echo "deploy_release=noop|app=$app|commit=$commit"; exit 0; }

migration_plan="$(compose_candidate run --rm --no-deps "$prepare_service" python manage.py showmigrations --plan)"
pending_migrations="$(grep -c '^\[ \]' <<<"$migration_plan" || true)"
if ((pending_migrations > 0)) && [[ "$allow_migrations" != "true" ]]; then
  echo "deploy_release=blocked|reason=pending_migrations|count=$pending_migrations" >&2
  exit 1
fi

deployment_state="$STATE_ROOT/$deployment_id"
mkdir -p "$deployment_state"
cp "$ACTIVE_ENV" "$deployment_state/release-images.before.env"
printf '%s\n' "$current_commit" >"$deployment_state/previous-commit"
printf '%s\n' "$current_image" >"$deployment_state/previous-image"
printf '%s\n' "$pending_migrations" >"$deployment_state/pending-migrations"

OFFSITE_UPLOAD_ENABLED=true "$CONFIG_ROOT/postgres_backup_to_r2.sh" | tee "$deployment_state/backup.log"

migrations_applied="false"
if ((pending_migrations > 0)); then
  compose_candidate run --rm --no-deps "$prepare_service" | tee "$deployment_state/migrate.log"
  migrations_applied="true"
fi

ln -sfn "$release_path" "$RELEASE_ROOT/$app/current"
install -m 0644 "$candidate" "$ACTIVE_ENV"

rollback_application() {
  rollback_deploy_id="$previous_deploy_id"
  [[ -n "$rollback_deploy_id" ]] || rollback_deploy_id="legacy-betterp-${current_betterp_commit:0:12}"
  cp "$deployment_state/release-images.before.env" "$candidate"
  upsert_env_key "$candidate" "BETTERP_DEPLOY_ID" "$rollback_deploy_id"
  install -m 0644 "$candidate" "$ACTIVE_ENV"
  ln -sfn "$RELEASE_ROOT/$app/$current_commit" "$RELEASE_ROOT/$app/current"
  compose_candidate up -d --no-build --no-deps "${services[@]}" >/dev/null
  PUBLIC_SMOKE=true "$CONFIG_ROOT/release_preflight.sh" >/dev/null
  echo "deploy_release=rolled_back|app=$app|restored_commit=$current_commit" >&2
}

set +e
compose_candidate up -d --no-build --no-deps "${services[@]}" >"$deployment_state/compose-up.log" 2>&1
deploy_status=$?
if ((deploy_status == 0)); then
  deadline=$((SECONDS + 180))
  for service in "${services[@]}"; do
    container="betterp-platform-$service-1"
    state=""
    while ((SECONDS < deadline)); do
      state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
      [[ "$state" == "healthy" || "$state" == "running" ]] && break
      sleep 3
    done
    [[ "$state" == "healthy" || "$state" == "running" ]] || { deploy_status=1; break; }
  done
fi
if ((deploy_status == 0)); then
  "$CONFIG_ROOT/public_smoke.sh" >"$deployment_state/public-smoke.log" 2>&1
  deploy_status=$?
fi
set -e

if ((deploy_status != 0)); then
  if [[ "$migrations_applied" == "false" ]]; then
    rollback_application
  else
    echo "deploy_release=failed|reason=post_migration_smoke|automatic_rollback=no|state=$deployment_state" >&2
  fi
  exit 1
fi

printf 'status=complete\napp=%s\ncommit=%s\ndeploy_id=%s\nmigrations_applied=%s\ncompleted_at_utc=%s\n' \
  "$app" "$commit" "$candidate_deploy_id" "$migrations_applied" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$deployment_state/result.env"
trap - EXIT
rm -f -- "$candidate"
echo "deploy_release=ok|app=$app|commit=$commit|deploy_id=$candidate_deploy_id|migrations_applied=$migrations_applied|state=$deployment_state"
