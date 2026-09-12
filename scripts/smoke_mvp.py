from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API_BASE = os.getenv("BETTERP_API_BASE", "https://api.betterp.net/api").rstrip("/")
APP_BASE = os.getenv("BETTERP_APP_BASE", "https://betterp.net").rstrip("/")
HEALTH_URL = os.getenv("BETTERP_HEALTH_URL", "https://api.betterp.net/").rstrip("/")
WARMUP_URL = os.getenv("BETTERP_WARMUP_URL", f"{API_BASE}/warmup/").strip()
EMAIL = os.getenv("BETTERP_SMOKE_EMAIL", "").strip()
PASSWORD = os.getenv("BETTERP_SMOKE_PASSWORD", "").strip()
CAPA_ID = os.getenv("BETTERP_SMOKE_CAPA_ID", "").strip()
PORTAL_TOKEN = os.getenv("BETTERP_SMOKE_PORTAL_TOKEN", "").strip()
WRITE_ENABLED = os.getenv("BETTERP_SMOKE_WRITE", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "si",
}
WRITE_CONFIRM = os.getenv("BETTERP_SMOKE_WRITE_CONFIRM", "").strip()
WRITE_CONFIRMED = WRITE_ENABLED and WRITE_CONFIRM == "SMOKE_WRITE_OK"
WRITE_ALLOWED_CAPA_ID = os.getenv("BETTERP_SMOKE_WRITE_ALLOWED_CAPA_ID", "").strip()
WRITE_ALLOW_UNPINNED = os.getenv(
    "BETTERP_SMOKE_WRITE_ALLOW_UNPINNED",
    "",
).strip().lower() in {"1", "true", "yes", "si"}
E2E_ENABLED = os.getenv("BETTERP_SMOKE_E2E", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "si",
}
TIMEOUT = int(os.getenv("BETTERP_SMOKE_TIMEOUT", "25"))
USER_AGENT = os.getenv(
    "BETTERP_SMOKE_USER_AGENT",
    "Mozilla/5.0 (compatible; BetterP-MVP-Smoke/1.0; +https://betterp.net)",
)
REPORT_JSON = os.getenv("BETTERP_SMOKE_REPORT_JSON", "").strip()
HISTORY_JSONL = os.getenv("BETTERP_SMOKE_HISTORY_JSONL", "").strip()
REPORT_API_URL = os.getenv(
    "BETTERP_SMOKE_REPORT_URL",
    f"{API_BASE}/billing/operational/smoke-report/",
).strip()
REPORT_API_TOKEN = (
    os.getenv("BETTERP_SMOKE_REPORT_TOKEN", "").strip()
    or os.getenv("SMOKE_REPORT_TOKEN", "").strip()
)
REPORT_API_REQUIRED = os.getenv(
    "BETTERP_SMOKE_REPORT_REQUIRED",
    "",
).strip().lower() in {"1", "true", "yes", "si"}
SMOKE_SOURCE = os.getenv("BETTERP_SMOKE_SOURCE", "production_smoke").strip()
SMOKE_WORKFLOW = os.getenv("GITHUB_WORKFLOW", "").strip()
_REQUIRED_BACKEND_FEATURES_RAW = os.getenv("BETTERP_SMOKE_REQUIRED_BACKEND_FEATURES")
if _REQUIRED_BACKEND_FEATURES_RAW is None:
    _REQUIRED_BACKEND_FEATURES_RAW = "crm_portal_link,capa_backup_streaming_export"
REQUIRED_BACKEND_FEATURES = tuple(
    item.strip()
    for item in _REQUIRED_BACKEND_FEATURES_RAW.split(",")
    if item.strip()
)
if _REQUIRED_BACKEND_FEATURES_RAW.strip().lower() in {
    "",
    "0",
    "false",
    "no",
    "none",
    "off",
    "disabled",
}:
    REQUIRED_BACKEND_FEATURES = ()
DEPLOY_COMMIT = (
    os.getenv("BETTERP_DEPLOY_COMMIT", "").strip()
    or os.getenv("GITHUB_SHA", "").strip()
    or os.getenv("CF_PAGES_COMMIT_SHA", "").strip()
)
GIT_COMMIT = os.getenv("GITHUB_SHA", "").strip()
DEPLOY_COMMIT_STRICT = os.getenv(
    "BETTERP_SMOKE_REQUIRE_DEPLOY_COMMIT",
    "",
).strip().lower() in {"1", "true", "yes", "si"}
PRODUCTION_TARGET = (
    "api.betterp.net" in API_BASE
    or "api.betterp.net" in HEALTH_URL
    or "betterp.net" in APP_BASE
)


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str
    status: int | None = None
    duration_ms: int = 0


class SmokeClient:
    def __init__(self) -> None:
        self.access_token = ""
        self.selected_capa_id = CAPA_ID

    def request(
        self,
        method: str,
        url: str,
        *,
        json_body: dict[str, Any] | None = None,
        auth: bool = False,
        selected_capa: bool = False,
    ) -> tuple[int, dict[str, Any] | list[Any] | str]:
        headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
        data = None
        if json_body is not None:
            data = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if auth:
            headers["Authorization"] = f"Bearer {self.access_token}"
        if selected_capa and self.selected_capa_id:
            headers["X-BettERP-Capa-ID"] = self.selected_capa_id

        request = Request(url, data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=TIMEOUT) as response:
                status = response.status
                raw = response.read().decode("utf-8", errors="replace")
                content_type = response.headers.get("content-type", "")
        except HTTPError as exc:
            status = exc.code
            raw = exc.read().decode("utf-8", errors="replace")
            content_type = exc.headers.get("content-type", "")
        except URLError as exc:
            raise RuntimeError(str(exc.reason)) from exc

        if "application/json" in content_type:
            try:
                return status, json.loads(raw or "{}")
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"Respuesta JSON invalida: {exc}") from exc
        return status, raw[:500]

    def login(self) -> CheckResult:
        if not EMAIL or not PASSWORD:
            return CheckResult(
                "login",
                True,
                "omitido: define BETTERP_SMOKE_EMAIL y BETTERP_SMOKE_PASSWORD para validar APIs autenticadas",
            )
        start = time.time()
        status, body = self.request(
            "POST",
            f"{API_BASE}/accounts/auth/login/",
            json_body={"email": EMAIL, "password": PASSWORD},
        )
        duration = int((time.time() - start) * 1000)
        if status == 202:
            return CheckResult("login", False, "requiere 2FA; usa una cuenta smoke sin 2FA", status, duration)
        if status != 200 or not isinstance(body, dict):
            return CheckResult("login", False, _detail(body), status, duration)
        tokens = body.get("tokens") or {}
        self.access_token = tokens.get("access_token") or ""
        membership = body.get("current_membership") or {}
        capa = membership.get("capa_negocio") or {}
        if not self.selected_capa_id and capa.get("id"):
            self.selected_capa_id = str(capa["id"])
        return CheckResult("login", bool(self.access_token), "sesion autenticada", status, duration)


def _detail(body: dict[str, Any] | list[Any] | str) -> str:
    if isinstance(body, dict):
        return str(body.get("detail") or body.get("mensaje") or body)[:240]
    return str(body)[:240]


def _validate_health_contract(
    body: dict[str, Any],
    *,
    headers,
) -> tuple[bool, str]:
    if body.get("status") != "ok":
        return False, _detail(body)

    detail_parts = [_detail(body)]
    features = body.get("features") or {}
    if REQUIRED_BACKEND_FEATURES:
        missing_features = [
            feature
            for feature in REQUIRED_BACKEND_FEATURES
            if not isinstance(features, dict) or not features.get(feature)
        ]
        if missing_features:
            return (
                False,
                "backend no expone features esperadas: "
                f"{', '.join(missing_features)}. Produccion puede estar sirviendo una version anterior.",
            )
        detail_parts.append(
            f"features OK: {', '.join(REQUIRED_BACKEND_FEATURES)}"
        )

    expected_commit = DEPLOY_COMMIT[:7]
    if expected_commit:
        deployment = body.get("deployment") or {}
        served_commit = ""
        if isinstance(deployment, dict):
            served_commit = str(
                deployment.get("git_commit")
                or deployment.get("git_commit_short")
                or ""
            ).strip()
        served_commit = served_commit or str(
            headers.get("X-BettERP-API-Commit") or ""
        ).strip()
        served_commit_short = served_commit[:7]
        if served_commit_short and served_commit_short != expected_commit:
            return (
                False,
                f"backend sirve commit {served_commit_short}, esperado {expected_commit}",
            )
        if served_commit_short:
            detail_parts.append(f"commit OK: {served_commit_short}")
        elif DEPLOY_COMMIT_STRICT:
            return (
                False,
                "backend no expone commit; define BETTERP_GIT_COMMIT "
                "en el runtime o desactiva BETTERP_SMOKE_REQUIRE_DEPLOY_COMMIT",
            )
        else:
            detail_parts.append("commit no expuesto")

    return True, "; ".join(detail_parts)


def check_public_page(path: str) -> CheckResult:
    url = f"{APP_BASE}{path}"
    start = time.time()
    try:
        with urlopen(
            Request(url, headers={"Accept": "text/html", "User-Agent": USER_AGENT}),
            timeout=TIMEOUT,
        ) as response:
            raw = response.read(300).decode("utf-8", errors="replace")
            ok = response.status < 500 and "<html" in raw.lower()
            return CheckResult(f"page {path}", ok, "HTML disponible", response.status, int((time.time() - start) * 1000))
    except Exception as exc:
        return CheckResult(f"page {path}", False, str(exc), None, int((time.time() - start) * 1000))


def check_json(client: SmokeClient, name: str, path: str, *, auth: bool = True, selected_capa: bool = True) -> CheckResult:
    start = time.time()
    try:
        status, body = client.request(
            "GET",
            f"{API_BASE}{path}",
            auth=auth,
            selected_capa=selected_capa,
        )
    except Exception as exc:
        return CheckResult(name, False, str(exc), None, int((time.time() - start) * 1000))
    ok = 200 <= status < 300
    return CheckResult(name, ok, "OK" if ok else _detail(body), status, int((time.time() - start) * 1000))


def check_json_url(name: str, url: str) -> CheckResult:
    start = time.time()
    try:
        with urlopen(
            Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT}),
            timeout=TIMEOUT,
        ) as response:
            raw = response.read().decode("utf-8", errors="replace")
            body = json.loads(raw or "{}")
            ok = 200 <= response.status < 300
            return CheckResult(name, ok, "OK" if ok else _detail(body), response.status, int((time.time() - start) * 1000))
    except Exception as exc:
        return CheckResult(name, False, str(exc), None, int((time.time() - start) * 1000))


def check_download(
    client: SmokeClient,
    name: str,
    path: str,
    *,
    auth: bool = True,
    selected_capa: bool = True,
) -> CheckResult:
    start = time.time()
    try:
        headers = {"Accept": "*/*", "User-Agent": USER_AGENT}
        if auth:
            headers["Authorization"] = f"Bearer {client.access_token}"
        if selected_capa and client.selected_capa_id:
            headers["X-BettERP-Capa-ID"] = client.selected_capa_id
        request = Request(f"{API_BASE}{path}", headers=headers, method="GET")
        with urlopen(request, timeout=TIMEOUT) as response:
            status = response.status
            content_type = response.headers.get("content-type", "")
            content = response.read()
    except HTTPError as exc:
        status = exc.code
        detail = exc.read().decode("utf-8", errors="replace")[:240]
        return CheckResult(name, False, detail, status, int((time.time() - start) * 1000))
    except Exception as exc:
        return CheckResult(name, False, str(exc), None, int((time.time() - start) * 1000))
    ok = (
        200 <= status < 300
        and len(content) > 1000
        and "spreadsheetml.sheet" in content_type
    )
    detail = f"descarga {len(content)} bytes" if ok else f"{content_type} {len(content)} bytes"
    return CheckResult(name, ok, detail, status, int((time.time() - start) * 1000))


def _audit_actions_for_resource(
    client: SmokeClient,
    *,
    resource_type: str,
    resource_id: int,
    expected_actions: set[str],
) -> tuple[bool, str, int | None]:
    status, body = client.request(
        "GET",
        f"{API_BASE}/accounts/auditoria/?"
        + urlencode(
            {
                "limit": 50,
                "recurso_tipo": resource_type,
                "recurso_id": str(resource_id),
            }
        ),
        auth=True,
        selected_capa=True,
    )
    if status < 200 or status >= 300:
        return False, _detail(body), status
    items = _extract_items(body)
    actions = {str(item.get("accion") or "") for item in items}
    missing = sorted(expected_actions - actions)
    if missing:
        return False, f"auditoria incompleta; faltan acciones: {', '.join(missing)}", status
    return True, f"auditoria OK: {', '.join(sorted(expected_actions))}", status


def _extract_items(body: dict[str, Any] | list[Any] | str) -> list[dict[str, Any]]:
    if isinstance(body, dict) and isinstance(body.get("items"), list):
        return [item for item in body["items"] if isinstance(item, dict)]
    if isinstance(body, list):
        return [item for item in body if isinstance(item, dict)]
    return []


def _first_entity_id(client: SmokeClient) -> tuple[int | None, str, int | None]:
    status, body = client.request(
        "GET",
        f"{API_BASE}/empresas/lista/",
        auth=True,
        selected_capa=True,
    )
    if status < 200 or status >= 300:
        return None, _detail(body), status
    entities = _extract_items(body)
    if not entities:
        return None, "no hay entidades disponibles para escritura controlada", status
    try:
        return int(entities[0]["id"]), "entidad smoke lista", status
    except (KeyError, TypeError, ValueError):
        return None, "la entidad smoke no devolvio id valido", status


def _extract_portal_token(body: dict[str, Any] | list[Any] | str) -> str:
    if not isinstance(body, dict):
        return ""
    portal = body.get("portal") or {}
    if not isinstance(portal, dict):
        return ""
    token = str(portal.get("token") or "").strip()
    if token:
        return token
    url = str(portal.get("url") or "").strip()
    if not url:
        return ""
    return url.rstrip("/").rsplit("/", 1)[-1]


def _validate_write_target(client: SmokeClient, check_name: str, start: float) -> CheckResult | None:
    if not client.selected_capa_id:
        return CheckResult(
            check_name,
            False,
            "no hay capa seleccionada para ejecutar escritura controlada",
            None,
            int((time.time() - start) * 1000),
        )
    if not WRITE_CONFIRMED:
        return CheckResult(
            check_name,
            False,
            "define BETTERP_SMOKE_WRITE=1 y BETTERP_SMOKE_WRITE_CONFIRM=SMOKE_WRITE_OK",
            None,
            int((time.time() - start) * 1000),
        )
    if WRITE_ALLOWED_CAPA_ID and client.selected_capa_id != WRITE_ALLOWED_CAPA_ID:
        return CheckResult(
            check_name,
            False,
            "capa seleccionada no coincide con BETTERP_SMOKE_WRITE_ALLOWED_CAPA_ID "
            f"({client.selected_capa_id} != {WRITE_ALLOWED_CAPA_ID})",
            None,
            int((time.time() - start) * 1000),
        )
    if PRODUCTION_TARGET and not WRITE_ALLOWED_CAPA_ID and not WRITE_ALLOW_UNPINNED:
        return CheckResult(
            check_name,
            False,
            "produccion exige BETTERP_SMOKE_WRITE_ALLOWED_CAPA_ID para anclar escrituras a la capa smoke",
            None,
            int((time.time() - start) * 1000),
        )
    return None


def _portal_payload_ready(body: dict[str, Any] | list[Any] | str) -> tuple[bool, str]:
    if not isinstance(body, dict):
        return False, "respuesta no es JSON de portal"
    required = ["cliente", "resumen", "cuentas", "facturacion", "datos_fiscales"]
    missing = [key for key in required if key not in body]
    if missing:
        return False, f"faltan bloques: {', '.join(missing)}"
    cuentas = body.get("cuentas")
    if not isinstance(cuentas, list):
        return False, "cuentas no es lista"
    cliente = body.get("cliente") or {}
    nombre = cliente.get("nombre") if isinstance(cliente, dict) else None
    return True, f"portal OK para {nombre or 'cliente smoke'} con {len(cuentas)} cuenta(s)"


def check_portal_cliente(client: SmokeClient) -> CheckResult:
    start = time.time()
    try:
        token = PORTAL_TOKEN
        if not token:
            status, body = client.request(
                "GET",
                f"{API_BASE}/crm/lista/?" + urlencode({"page": 1, "page_size": 1}),
                auth=True,
                selected_capa=True,
            )
            if status < 200 or status >= 300:
                return CheckResult("portal cliente", False, _detail(body), status, int((time.time() - start) * 1000))
            items = _extract_items(body)
            if not items:
                return CheckResult(
                    "portal cliente",
                    False,
                    "no hay clientes activos para generar preview del portal",
                    status,
                    int((time.time() - start) * 1000),
                )
            client_id = items[0].get("id")
            status, body = client.request(
                "GET",
                f"{API_BASE}/crm/cliente/{client_id}/portal-link/",
                auth=True,
                selected_capa=True,
            )
            portal_source = "link de portal"
            if status == 404:
                status, body = client.request(
                    "GET",
                    f"{API_BASE}/crm/cliente/{client_id}/portal-preview/",
                    auth=True,
                    selected_capa=True,
                )
                portal_source = "preview"
            if status < 200 or status >= 300:
                return CheckResult("portal cliente", False, _detail(body), status, int((time.time() - start) * 1000))
            token = _extract_portal_token(body)
            if not token:
                return CheckResult(
                    "portal cliente",
                    False,
                    f"{portal_source} no devolvio token",
                    status,
                    int((time.time() - start) * 1000),
                )

        status, body = client.request(
            "GET",
            f"{API_BASE}/comunicaciones/portal/{token}/",
            auth=False,
            selected_capa=False,
        )
        if status < 200 or status >= 300:
            return CheckResult("portal cliente", False, _detail(body), status, int((time.time() - start) * 1000))
        ok, detail = _portal_payload_ready(body)
        return CheckResult("portal cliente", ok, detail, status, int((time.time() - start) * 1000))
    except Exception as exc:
        return CheckResult("portal cliente", False, str(exc), None, int((time.time() - start) * 1000))


def check_controlled_write(client: SmokeClient) -> CheckResult:
    start = time.time()
    rule_id: int | None = None
    bank_account_id: int | None = None
    cxp_program_id: int | None = None
    write_target_error = _validate_write_target(client, "write controlado", start)
    if write_target_error:
        return write_target_error

    base_payload = {
        "nombre": f"Smoke MVP {int(time.time())}",
        "tipo_calculo": "FIJO",
        "valor": "1.00",
        "periodicidad": "MENSUAL",
        "aplica_a_todos": False,
        "dias_condicion": None,
        "activo": False,
    }
    try:
        status, body = client.request(
            "POST",
            f"{API_BASE}/empresas/capas/{client.selected_capa_id}/reglas/",
            json_body=base_payload,
            auth=True,
            selected_capa=True,
        )
        if status < 200 or status >= 300 or not isinstance(body, dict) or not body.get("id"):
            return CheckResult(
                "write controlado",
                False,
                _detail(body),
                status,
                int((time.time() - start) * 1000),
            )
        rule_id = int(body["id"])

        updated_payload = {
            **base_payload,
            "nombre": f"{base_payload['nombre']} validado",
            "valor": "2.00",
        }
        status, body = client.request(
            "PUT",
            f"{API_BASE}/empresas/capas/reglas/{rule_id}/",
            json_body=updated_payload,
            auth=True,
            selected_capa=True,
        )
        if status < 200 or status >= 300:
            return CheckResult(
                "write controlado",
                False,
                _detail(body),
                status,
                int((time.time() - start) * 1000),
            )

        status, body = client.request(
            "DELETE",
            f"{API_BASE}/empresas/capas/reglas/{rule_id}/",
            auth=True,
            selected_capa=True,
        )
        if status < 200 or status >= 300:
            return CheckResult(
                "write controlado",
                False,
                _detail(body),
                status,
                int((time.time() - start) * 1000),
            )
        rule_id = None

        bank_payload = {
            "nombre": f"Smoke conciliacion {int(time.time())}",
            "alias": "Temporal smoke",
            "banco": "SMOKE",
            "numero_cuenta": f"99{int(time.time()) % 100000000:08d}",
            "clabe": "",
            "ultima_4": "",
            "moneda": "MXN",
            "activa": True,
        }
        status, body = client.request(
            "POST",
            f"{API_BASE}/finanzas/conciliacion/cuentas-bancarias/",
            json_body=bank_payload,
            auth=True,
            selected_capa=True,
        )
        if status < 200 or status >= 300 or not isinstance(body, dict) or not body.get("id"):
            return CheckResult(
                "write controlado",
                False,
                _detail(body),
                status,
                int((time.time() - start) * 1000),
            )
        bank_account_id = int(body["id"])

        status, body = client.request(
            "PUT",
            f"{API_BASE}/finanzas/conciliacion/cuentas-bancarias/{bank_account_id}/",
            json_body={**bank_payload, "alias": "Temporal smoke validado"},
            auth=True,
            selected_capa=True,
        )
        if status < 200 or status >= 300:
            return CheckResult(
                "write controlado",
                False,
                _detail(body),
                status,
                int((time.time() - start) * 1000),
            )

        status, body = client.request(
            "DELETE",
            f"{API_BASE}/finanzas/conciliacion/cuentas-bancarias/{bank_account_id}/",
            auth=True,
            selected_capa=True,
        )
        if status < 200 or status >= 300:
            return CheckResult(
                "write controlado",
                False,
                _detail(body),
                status,
                int((time.time() - start) * 1000),
            )
        bank_account_id = None

        entity_id, entity_detail, entity_status = _first_entity_id(client)
        if not entity_id:
            return CheckResult(
                "write controlado",
                False,
                entity_detail,
                entity_status,
                int((time.time() - start) * 1000),
            )
        today = datetime.now(timezone.utc).date().isoformat()
        suffix = int(time.time())
        cxp_program_payload = {
            "nombre": f"Smoke CxP recurrente {suffix}",
            "categoria": "OTROS",
            "naturaleza": "OPERATIVO",
            "proveedor_nombre": "Proveedor Smoke",
            "banco_pago": "",
            "cuenta_pago": "",
            "clabe_pago": "",
            "prioridad": "BAJA",
            "periodicidad": "MENSUAL",
            "fecha_inicio": today,
            "fecha_fin": None,
            "dia_vencimiento": 1,
            "monto_base": "1.00",
            "dias_gracia": 0,
            "genera_recargo": False,
            "prorrateable": False,
            "activo": False,
            "observaciones": "Smoke reversible; no activar ni generar cargos.",
        }
        status, body = client.request(
            "POST",
            f"{API_BASE}/finanzas/entidades/{entity_id}/cxp/programaciones/",
            json_body=cxp_program_payload,
            auth=True,
            selected_capa=True,
        )
        if status < 200 or status >= 300 or not isinstance(body, dict) or not body.get("id"):
            return CheckResult(
                "write controlado",
                False,
                _detail(body),
                status,
                int((time.time() - start) * 1000),
            )
        cxp_program_id = int(body["id"])

        status, body = client.request(
            "PUT",
            f"{API_BASE}/finanzas/cxp/programaciones/{cxp_program_id}/",
            json_body={
                **cxp_program_payload,
                "nombre": f"{cxp_program_payload['nombre']} validada",
                "monto_base": "2.00",
            },
            auth=True,
            selected_capa=True,
        )
        if status < 200 or status >= 300:
            return CheckResult(
                "write controlado",
                False,
                _detail(body),
                status,
                int((time.time() - start) * 1000),
            )

        status, body = client.request(
            "DELETE",
            f"{API_BASE}/finanzas/cxp/programaciones/{cxp_program_id}/",
            auth=True,
            selected_capa=True,
        )
        if status < 200 or status >= 300:
            return CheckResult(
                "write controlado",
                False,
                _detail(body),
                status,
                int((time.time() - start) * 1000),
            )
        created_cxp_program_id = cxp_program_id
        cxp_program_id = None
        audit_ok, audit_detail, audit_status = _audit_actions_for_resource(
            client,
            resource_type="ProgramacionCuentaPorPagar",
            resource_id=created_cxp_program_id,
            expected_actions={
                "CXP_PROGRAMACION_CREADA",
                "CXP_PROGRAMACION_ACTUALIZADA",
                "CXP_PROGRAMACION_ELIMINADA",
            },
        )
        if not audit_ok:
            return CheckResult(
                "write controlado",
                False,
                audit_detail,
                audit_status,
                int((time.time() - start) * 1000),
            )
        return CheckResult(
            "write controlado",
            True,
            "regla marco, cuenta bancaria y programacion CxP temporales creadas, actualizadas, eliminadas y auditadas",
            audit_status,
            int((time.time() - start) * 1000),
        )
    except Exception as exc:
        return CheckResult(
            "write controlado",
            False,
            str(exc),
            None,
            int((time.time() - start) * 1000),
        )
    finally:
        if rule_id:
            try:
                client.request(
                    "DELETE",
                    f"{API_BASE}/empresas/capas/reglas/{rule_id}/",
                    auth=True,
                    selected_capa=True,
                )
            except Exception:
                pass
        if bank_account_id:
            try:
                client.request(
                    "DELETE",
                    f"{API_BASE}/finanzas/conciliacion/cuentas-bancarias/{bank_account_id}/",
                    auth=True,
                    selected_capa=True,
                )
            except Exception:
                pass
        if cxp_program_id:
            try:
                client.request(
                    "DELETE",
                    f"{API_BASE}/finanzas/cxp/programaciones/{cxp_program_id}/",
                    auth=True,
                    selected_capa=True,
                )
            except Exception:
                pass


def check_controlled_e2e(client: SmokeClient) -> CheckResult:
    start = time.time()
    client_id: int | None = None
    write_target_error = _validate_write_target(client, "qa e2e controlado", start)
    if write_target_error:
        return write_target_error
    try:
        entity_id, entity_detail, entity_status = _first_entity_id(client)
        if not entity_id:
            return CheckResult(
                "qa e2e controlado",
                False,
                entity_detail,
                entity_status,
                int((time.time() - start) * 1000),
            )
        suffix = int(time.time())
        base_payload = {
            "entidad_relacionada_id": entity_id,
            "es_persona_moral": False,
            "nombre_comercial": f"Smoke E2E {suffix}",
            "razon_social": f"Smoke E2E Cliente {suffix}",
            "rfc": "XAXX010101000",
            "regimen_fiscal": "616",
            "identificador": f"SMOKE-E2E-{suffix}",
            "condiciones_pago": "Smoke reversible",
            "correo_principal": f"smoke-e2e-{suffix}@betterp.net",
            "codigo_pais": "+52",
            "telefono": "5599999999",
            "pais": "Mexico",
            "estado": "Yucatan",
            "ciudad": "Merida",
            "colonia": "Centro",
            "calle": "Calle Smoke",
            "numero_exterior": "1",
            "numero_interior": "",
            "codigo_postal": "97000",
            "agente_cobranza": "Smoke",
            "dia_corte_individual": 5,
            "dias_gracia": 1,
            "activo": True,
        }
        status, body = client.request(
            "POST",
            f"{API_BASE}/crm/crear/",
            json_body=base_payload,
            auth=True,
            selected_capa=True,
        )
        if status < 200 or status >= 300 or not isinstance(body, dict) or not body.get("id"):
            return CheckResult("qa e2e controlado", False, _detail(body), status, int((time.time() - start) * 1000))
        client_id = int(body["id"])

        steps = [
            ("GET", f"{API_BASE}/crm/cliente/{client_id}/", None),
            ("GET", f"{API_BASE}/crm/cliente/{client_id}/portal-preview/", None),
            (
                "PUT",
                f"{API_BASE}/crm/cliente/{client_id}/",
                {**base_payload, "nombre_comercial": f"Smoke E2E {suffix} validado"},
            ),
            ("GET", f"{API_BASE}/crm/lista/?" + urlencode({"search": f"SMOKE-E2E-{suffix}", "estatus": "todos"}), None),
        ]
        for method, url, payload in steps:
            status, body = client.request(
                method,
                url,
                json_body=payload,
                auth=True,
                selected_capa=True,
            )
            if status < 200 or status >= 300:
                return CheckResult("qa e2e controlado", False, _detail(body), status, int((time.time() - start) * 1000))

        status, body = client.request(
            "DELETE",
            f"{API_BASE}/crm/cliente/{client_id}/",
            auth=True,
            selected_capa=True,
        )
        if status < 200 or status >= 300:
            return CheckResult("qa e2e controlado", False, _detail(body), status, int((time.time() - start) * 1000))
        created_client_id = client_id
        client_id = None
        audit_ok, audit_detail, audit_status = _audit_actions_for_resource(
            client,
            resource_type="Cliente",
            resource_id=created_client_id,
            expected_actions={
                "CLIENTE_CREADO",
                "CLIENTE_ACTUALIZADO",
                "CLIENTE_ELIMINADO",
            },
        )
        if not audit_ok:
            return CheckResult(
                "qa e2e controlado",
                False,
                audit_detail,
                audit_status,
                int((time.time() - start) * 1000),
            )
        return CheckResult(
            "qa e2e controlado",
            True,
            f"cliente temporal creado, consultado, portal-preview validado, actualizado, buscado, eliminado y auditado ({audit_detail})",
            audit_status,
            int((time.time() - start) * 1000),
        )
    except Exception as exc:
        return CheckResult("qa e2e controlado", False, str(exc), None, int((time.time() - start) * 1000))
    finally:
        if client_id:
            try:
                client.request(
                    "DELETE",
                    f"{API_BASE}/crm/cliente/{client_id}/",
                    auth=True,
                    selected_capa=True,
                )
            except Exception:
                pass


def main() -> int:
    client = SmokeClient()
    checks: list[CheckResult] = []
    started_at = datetime.now(timezone.utc)

    checks.append(check_json(client, "api health", HEALTH_URL.replace(API_BASE, ""), auth=False, selected_capa=False) if HEALTH_URL.startswith(API_BASE) else _check_health())
    if WARMUP_URL:
        checks.append(check_json(client, "api warmup", WARMUP_URL.replace(API_BASE, ""), auth=False, selected_capa=False) if WARMUP_URL.startswith(API_BASE) else check_json_url("api warmup", WARMUP_URL))
    checks.extend(
        [
            check_public_page("/login"),
            check_public_page("/onboarding"),
            check_public_page("/cxc"),
            check_public_page("/cobranza"),
            check_public_page("/pago/exito"),
        ]
    )

    login = client.login()
    checks.append(login)
    if client.access_token:
        checks.extend(
            [
                check_json(client, "perfil actual", "/accounts/auth/me/", selected_capa=False),
                check_json(client, "permisos", "/accounts/permisos/"),
                check_json(client, "billing actual", "/billing/suscripcion/actual/"),
                check_json(client, "entidades lista", "/empresas/lista/"),
                check_json(client, "onboarding", "/empresas/onboarding/"),
                check_json(client, "cxc", "/finanzas/cxc/?" + urlencode({"page": 1, "page_size": 10})),
                check_json(client, "cxp", "/finanzas/cxp/?" + urlencode({"page": 1, "page_size": 10})),
                check_json(client, "pagos cxc", "/finanzas/cxc/pagos/"),
                check_json(client, "pagos cxp", "/finanzas/cxp/pagos/"),
                check_json(client, "comprobantes", "/comunicaciones/evidencias/"),
                check_json(client, "cobranza config", "/comunicaciones/configuracion/"),
                check_json(client, "cobranza automatizaciones preview", "/comunicaciones/automatizaciones-preview/"),
                check_json(client, "cobranza automatizaciones monitoreo", "/comunicaciones/automatizaciones-monitoreo/"),
                check_json(client, "conciliacion cuentas", "/finanzas/conciliacion/cuentas-bancarias/"),
                check_json(client, "conciliacion sugerencias", "/finanzas/conciliacion/sugerencias/"),
                check_json(client, "conciliacion eventos", "/finanzas/conciliacion/eventos/"),
                check_json(client, "cambios de plan", "/billing/suscripcion/cambios-plan/"),
                check_json(client, "auditoria", "/accounts/auditoria/"),
                check_json(client, "auditoria resumen", "/accounts/auditoria/resumen/"),
                check_portal_cliente(client),
                check_download(client, "backup capa", "/empresas/capas/backup/exportar/"),
            ]
        )
        if WRITE_ENABLED:
            checks.append(check_controlled_write(client))
        if E2E_ENABLED:
            checks.append(check_controlled_e2e(client))

    failures = [item for item in checks if not item.ok]
    report = _build_report(client, checks, failures, generated_at=started_at)
    _write_report(report)
    _append_history(report)
    publish_ok = _publish_report(report)
    for item in checks:
        status = item.status if item.status is not None else "-"
        marker = "OK" if item.ok else "FAIL"
        print(f"[{marker}] {item.name} status={status} time={item.duration_ms}ms - {item.detail}")

    if REPORT_API_REQUIRED and not publish_ok:
        print("\nSmoke fallido: no se pudo publicar evidencia operativa.", file=sys.stderr)
        return 1
    if failures:
        print(f"\nSmoke fallido: {len(failures)} check(s) requieren revision.", file=sys.stderr)
        return 1
    print("\nSmoke MVP OK.")
    return 0


def _build_report(
    client: SmokeClient,
    checks: list[CheckResult],
    failures: list[CheckResult],
    *,
    generated_at: datetime,
) -> dict[str, Any]:
    slowest = sorted(checks, key=lambda item: item.duration_ms, reverse=True)[:5]
    total_duration_ms = sum(item.duration_ms for item in checks)
    return {
        "generated_at": generated_at.isoformat(),
        "ok": not failures,
        "total": len(checks),
        "failures": len(failures),
        "api_base": API_BASE,
        "app_base": APP_BASE,
        "selected_capa_id": client.selected_capa_id,
        "write_enabled": WRITE_ENABLED,
        "write_confirmed": WRITE_CONFIRMED,
        "write_allowed_capa_id": WRITE_ALLOWED_CAPA_ID or None,
        "write_target_pinned": bool(WRITE_ALLOWED_CAPA_ID),
        "production_target": PRODUCTION_TARGET,
        "e2e_enabled": E2E_ENABLED,
        "deploy_commit": DEPLOY_COMMIT or None,
        "git_commit": GIT_COMMIT or None,
        "source": SMOKE_SOURCE or "production_smoke",
        "workflow": SMOKE_WORKFLOW or None,
        "deploy_commit_strict": DEPLOY_COMMIT_STRICT,
        "required_backend_features": list(REQUIRED_BACKEND_FEATURES),
        "total_duration_ms": total_duration_ms,
        "slowest_checks": [asdict(item) for item in slowest],
        "failed_checks": [asdict(item) for item in failures],
        "checks": [asdict(item) for item in checks],
    }


def _write_report(report: dict[str, Any]) -> None:
    if not REPORT_JSON:
        return
    path = Path(REPORT_JSON)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Reporte JSON: {path}")


def _append_history(report: dict[str, Any]) -> None:
    if not HISTORY_JSONL:
        return
    path = Path(HISTORY_JSONL)
    path.parent.mkdir(parents=True, exist_ok=True)
    history_entry = {
        "generated_at": report["generated_at"],
        "ok": report["ok"],
        "total": report["total"],
        "failures": report["failures"],
        "api_base": report["api_base"],
        "app_base": report["app_base"],
        "selected_capa_id": report["selected_capa_id"],
        "write_enabled": report["write_enabled"],
        "write_confirmed": report["write_confirmed"],
        "write_allowed_capa_id": report["write_allowed_capa_id"],
        "write_target_pinned": report["write_target_pinned"],
        "production_target": report["production_target"],
        "e2e_enabled": report["e2e_enabled"],
        "deploy_commit": report["deploy_commit"],
        "git_commit": report["git_commit"],
        "source": report["source"],
        "workflow": report["workflow"],
        "deploy_commit_strict": report["deploy_commit_strict"],
        "required_backend_features": report["required_backend_features"],
        "total_duration_ms": report["total_duration_ms"],
        "slowest_checks": report["slowest_checks"],
        "failed_checks": report["failed_checks"],
    }
    with path.open("a", encoding="utf-8") as history_file:
        history_file.write(json.dumps(history_entry, ensure_ascii=False) + "\n")
    print(f"Historial JSONL: {path}")


def _publish_report(report: dict[str, Any]) -> bool:
    if not REPORT_API_TOKEN:
        if REPORT_API_REQUIRED:
            print(
                "No se pudo publicar evidencia smoke: falta BETTERP_SMOKE_REPORT_TOKEN.",
                file=sys.stderr,
            )
            return False
        return True
    payload = json.dumps(report, ensure_ascii=False).encode("utf-8")
    request = Request(
        REPORT_API_URL,
        data=payload,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
            "X-BettERP-Smoke-Token": REPORT_API_TOKEN,
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=TIMEOUT) as response:
            ok = 200 <= response.status < 300
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:240]
        print(
            f"No se pudo publicar evidencia smoke: HTTP {exc.code} {detail}",
            file=sys.stderr,
        )
        return False
    except URLError as exc:
        print(f"No se pudo publicar evidencia smoke: {exc.reason}", file=sys.stderr)
        return False
    except Exception as exc:
        print(f"No se pudo publicar evidencia smoke: {exc}", file=sys.stderr)
        return False
    if ok:
        print("Evidencia smoke publicada en backoffice.")
    else:
        print("No se pudo publicar evidencia smoke.", file=sys.stderr)
    return ok


def _check_health() -> CheckResult:
    start = time.time()
    try:
        with urlopen(
            Request(HEALTH_URL, headers={"Accept": "application/json", "User-Agent": USER_AGENT}),
            timeout=TIMEOUT,
        ) as response:
            body = json.loads(response.read().decode("utf-8"))
            ok = response.status == 200
            if ok and isinstance(body, dict):
                ok, detail = _validate_health_contract(body, headers=response.headers)
            else:
                detail = _detail(body)
            return CheckResult("api health", ok, detail, response.status, int((time.time() - start) * 1000))
    except Exception as exc:
        return CheckResult("api health", False, str(exc), None, int((time.time() - start) * 1000))


if __name__ == "__main__":
    raise SystemExit(main())
