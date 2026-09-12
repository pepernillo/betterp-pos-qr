import re
from typing import Any

from django.db.models import QuerySet

from empresas.models import CapaNegocio

from .models import (
    Bodega,
    Categoria,
    CalidadIncidencia,
    InventarioItem,
    InventarioMovimiento,
    Orden,
    OrdenItem,
    Producto,
)


IDENTIFIER_FIELDS = {"GTIN", "EAN", "UPC", "ISBN"}
MISSING_FIELD_PATTERNS = [
    re.compile(r"Faltan requeridos:\s*(?P<fields>[^.]+)", re.IGNORECASE),
    re.compile(r"faltan atributos requeridos:\s*(?P<fields>[^.]+)", re.IGNORECASE),
    re.compile(r"missing required attributes?:\s*(?P<fields>[^.]+)", re.IGNORECASE),
    re.compile(r"missing fields?:\s*(?P<fields>[^.]+)", re.IGNORECASE),
]
EXTERNAL_CODE_PATTERN = re.compile(r"\[(?P<code>[A-Z]{2,}[A-Z0-9_-]{2,})\]")


def catalogo_categorias_for_capa(capa: CapaNegocio) -> QuerySet[Categoria]:
    return Categoria.objects.filter(capa_negocio=capa)


def catalogo_productos_for_capa(capa: CapaNegocio) -> QuerySet[Producto]:
    return Producto.objects.filter(capa_negocio=capa)


def catalogo_calidad_incidencias_for_capa(
    capa: CapaNegocio,
) -> QuerySet[CalidadIncidencia]:
    return CalidadIncidencia.objects.filter(capa_negocio=capa)






def catalogo_bodegas_for_capa(capa: CapaNegocio) -> QuerySet[Bodega]:
    return Bodega.objects.filter(capa_negocio=capa)


def catalogo_inventario_items_for_capa(capa: CapaNegocio) -> QuerySet[InventarioItem]:
    return InventarioItem.objects.filter(capa_negocio=capa)


def catalogo_inventario_movimientos_for_capa(
    capa: CapaNegocio,
) -> QuerySet[InventarioMovimiento]:
    return InventarioMovimiento.objects.filter(capa_negocio=capa)


def catalogo_ordenes_for_capa(capa: CapaNegocio) -> QuerySet[Orden]:
    return Orden.objects.filter(capa_negocio=capa)


def catalogo_orden_items_for_capa(capa: CapaNegocio) -> QuerySet[OrdenItem]:
    return OrdenItem.objects.filter(capa_negocio=capa)


def normalize_missing_fields(raw_error: str = "", metadata: dict[str, Any] | None = None) -> list[str]:
    fields: list[str] = []
    metadata = metadata if isinstance(metadata, dict) else {}
    metadata_candidates = (
        metadata.get("missing")
        or metadata.get("missing_fields")
        or metadata.get("required")
        or metadata.get("required_attributes")
        or metadata.get("faltantes")
    )
    if isinstance(metadata_candidates, list):
        fields.extend(str(item) for item in metadata_candidates)
    elif isinstance(metadata_candidates, str):
        fields.extend(split_missing_fields(metadata_candidates))

    for pattern in MISSING_FIELD_PATTERNS:
        match = pattern.search(raw_error or "")
        if match:
            fields.extend(split_missing_fields(match.group("fields")))

    normalized = []
    seen = set()
    for field in fields:
        clean = str(field or "").strip().strip("[]'\"").upper()
        if not clean:
            continue
        if clean.startswith("CODIGO ") or clean.startswith("CODE "):
            continue
        if clean not in seen:
            seen.add(clean)
            normalized.append(clean)
    return normalized


def split_missing_fields(value: str) -> list[str]:
    return [
        part.strip()
        for part in re.split(r"[,;|\n]+", value or "")
        if part.strip()
    ]


def extract_external_code(raw_error: str = "", explicit_code: str = "") -> str:
    clean_code = (explicit_code or "").strip()
    if clean_code:
        return clean_code[:120]
    match = EXTERNAL_CODE_PATTERN.search(raw_error or "")
    if not match:
        return ""
    return match.group("code")[:120]


def infer_quality_issue_type(
    *,
    raw_error: str = "",
    missing_fields: list[str] | None = None,
    requested_type: str = "",
) -> str:
    allowed = {choice[0] for choice in CalidadIncidencia.ISSUE_TYPE_CHOICES}
    requested = (requested_type or "").strip().upper()
    if requested in allowed and requested != "PUBLICACION_RECHAZADA":
        return requested

    clean_error = (raw_error or "").lower()
    if missing_fields:
        return "ATRIBUTO_FALTANTE"
    if "categor" in clean_error or "category" in clean_error:
        return "CATEGORIA"
    if "imagen" in clean_error or "image" in clean_error or "picture" in clean_error:
        return "IMAGEN"
    if "precio" in clean_error or "price" in clean_error:
        return "PRECIO"
    if "descripcion" in clean_error or "description" in clean_error or "copy" in clean_error:
        return "COPY"
    return requested if requested in allowed else "PUBLICACION_RECHAZADA"


def infer_quality_priority(issue_type: str, missing_fields: list[str] | None = None) -> str:
    if issue_type in {"ATRIBUTO_FALTANTE", "CATEGORIA", "IMAGEN"}:
        return "BLOCKER"
    if missing_fields:
        return "BLOCKER"
    if issue_type in {"COPY", "PRECIO"}:
        return "WARN"
    return "WARN"


def build_quality_assistance(
    *,
    product: Producto | None,
    issue_type: str,
    raw_error: str = "",
    missing_fields: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    missing_fields = missing_fields or []
    metadata = metadata if isinstance(metadata, dict) else {}
    protected_missing = [field for field in missing_fields if field.upper() in IDENTIFIER_FIELDS]
    fillable_missing = [field for field in missing_fields if field.upper() not in IDENTIFIER_FIELDS]
    actions: list[dict[str, Any]] = []

    if issue_type == "CATEGORIA":
        actions.append(
            {
                "tipo": "mapear_categoria",
                "campo": "categoria",
                "mensaje": "Mapea la categoria manualmente antes de volver a publicar.",
                "requiere_usuario": True,
            }
        )

    for field in fillable_missing:
        actions.append(
            {
                "tipo": "capturar_atributo",
                "campo": field,
                "mensaje": f"Completa el atributo {field} con informacion real del producto.",
                "requiere_usuario": True,
            }
        )

    for field in protected_missing:
        actions.append(
            {
                "tipo": "capturar_identificador",
                "campo": field,
                "mensaje": f"{field} requiere captura o confirmacion humana; no se debe inventar.",
                "requiere_usuario": True,
                "protegido": True,
            }
        )

    if not actions and raw_error:
        actions.append(
            {
                "tipo": "revisar_rechazo",
                "campo": "",
                "mensaje": "Revisa el mensaje del canal y ajusta ficha, permisos o cuenta conectada.",
                "requiere_usuario": True,
            }
        )

    product_context = {}
    if product:
        product_context = {
            "id": product.id,
            "internal_sku": product.internal_sku,
            "nombre": product.nombre,
            "marca": product.marca,
            "categoria_id": product.categoria_id,
            "atributos_actuales": product.master_attributes or {},
        }

    return {
        "summary": build_quality_summary(issue_type, missing_fields),
        "campos_faltantes": missing_fields,
        "campos_autocompletables": [],
        "campos_requieren_usuario": sorted(set(missing_fields)),
        "campos_protegidos_no_inventar": sorted(IDENTIFIER_FIELDS),
        "acciones_recomendadas": actions,
        "producto": product_context,
        "metadata_origen": metadata,
        "nota_ia": (
            "La asistencia puede sugerir acciones y estructura, pero no inventa GTIN, EAN, "
            "UPC, ISBN ni otros identificadores del fabricante."
        ),
    }


def build_quality_summary(issue_type: str, missing_fields: list[str]) -> str:
    if issue_type == "ATRIBUTO_FALTANTE" and missing_fields:
        return f"Faltan atributos requeridos: {', '.join(missing_fields)}."
    if issue_type == "CATEGORIA":
        return "La categoria requiere mapeo manual antes de publicar."
    if issue_type == "IMAGEN":
        return "La imagen requiere revision para cumplir reglas del canal."
    if issue_type == "COPY":
        return "El texto comercial requiere ajuste antes de publicar."
    if issue_type == "PRECIO":
        return "El precio requiere revision antes de publicar."
    return "El canal rechazo o detuvo la publicacion; requiere revision operativa."
