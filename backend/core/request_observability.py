from __future__ import annotations


EXPLORATORY_404_PREFIXES = (
    "/.env",
    "/.git",
    "/actuator",
    "/boaform",
    "/cgi-bin",
    "/config.json",
    "/phpmyadmin",
    "/server-status",
    "/vendor/phpunit",
    "/wordpress",
    "/wp-admin",
    "/wp-content",
    "/wp-includes",
    "/xmlrpc.php",
)


def is_exploratory_not_found_path(path: str) -> bool:
    normalized = f"/{str(path or '').strip().lstrip('/')}".lower()
    if normalized.endswith((".asp", ".aspx", ".cgi", ".php")):
        return True
    return any(
        normalized == prefix or normalized.startswith(f"{prefix}/")
        for prefix in EXPLORATORY_404_PREFIXES
    )


def classify_http_request(*, status_code: int | None, path: str) -> str:
    status = int(status_code or 0)
    if status >= 500:
        return "server_error"
    if status in {401, 403}:
        return "access_denied"
    if status == 404:
        return (
            "exploratory_not_found"
            if is_exploratory_not_found_path(path)
            else "not_found"
        )
    if status >= 400:
        return "client_error"
    return "success"
