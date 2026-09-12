import hashlib
from dataclasses import dataclass

import boto3
from django.conf import settings
from django.utils import timezone
from django.utils.text import slugify

from .models import BackupCapaExport, CapaNegocio


@dataclass(frozen=True)
class BackupObject:
    filename: str
    content: bytes
    checksum_sha256: str


def build_backup_object(capa: CapaNegocio, content: bytes) -> BackupObject:
    filename = slugify(capa.nombre) or f"capa-{capa.id}"
    today = timezone.localdate().isoformat()
    archive_name = f"backup-{filename}-{capa.id}-{today}.xlsx"
    return BackupObject(
        filename=archive_name,
        content=content,
        checksum_sha256=hashlib.sha256(content).hexdigest(),
    )


def backup_bucket_name() -> str:
    return (
        getattr(settings, "R2_BACKUP_BUCKET_NAME", "")
        or getattr(settings, "AWS_STORAGE_BUCKET_NAME", "")
    )


def backup_prefix() -> str:
    return (getattr(settings, "R2_BACKUP_PREFIX", "backups") or "backups").strip("/")


def build_backup_object_key(capa: CapaNegocio, filename: str) -> str:
    today = timezone.localdate()
    safe_capa = slugify(capa.nombre) or f"capa-{capa.id}"
    return (
        f"{backup_prefix()}/capas/{capa.id}-{safe_capa}/"
        f"{today:%Y/%m/%d}/{filename}"
    )


def create_backup_history(
    *,
    capa: CapaNegocio,
    backup: BackupObject,
    storage_backend: str,
    bucket: str = "",
    object_key: str = "",
    generado_por: str = "",
    metadata: dict | None = None,
) -> BackupCapaExport:
    return BackupCapaExport.objects.create(
        capa_negocio=capa,
        archivo_nombre=backup.filename,
        storage_backend=storage_backend,
        bucket=bucket or None,
        object_key=object_key or None,
        size_bytes=len(backup.content),
        checksum_sha256=backup.checksum_sha256,
        estatus="GENERADO",
        generado_por=generado_por or None,
        metadata=metadata or {},
    )


def upload_backup_to_r2(
    *,
    capa: CapaNegocio,
    backup: BackupObject,
    generado_por: str = "",
    metadata: dict | None = None,
) -> BackupCapaExport:
    bucket = backup_bucket_name()
    if not bucket:
        raise ValueError("Falta configurar R2_BACKUP_BUCKET_NAME o AWS_STORAGE_BUCKET_NAME.")
    endpoint = getattr(settings, "AWS_S3_ENDPOINT_URL", "")
    access_key = getattr(settings, "AWS_ACCESS_KEY_ID", "")
    secret_key = getattr(settings, "AWS_SECRET_ACCESS_KEY", "")
    if not endpoint or not access_key or not secret_key:
        raise ValueError("Faltan credenciales de R2 para subir backups.")

    object_key = build_backup_object_key(capa, backup.filename)
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
    )
    client.put_object(
        Bucket=bucket,
        Key=object_key,
        Body=backup.content,
        ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Metadata={
            "betterp-capa-id": str(capa.id),
            "betterp-checksum-sha256": backup.checksum_sha256,
        },
    )
    return create_backup_history(
        capa=capa,
        backup=backup,
        storage_backend="R2",
        bucket=bucket,
        object_key=object_key,
        generado_por=generado_por,
        metadata=metadata,
    )


def download_backup_from_r2(*, bucket: str, object_key: str) -> bytes:
    endpoint = getattr(settings, "AWS_S3_ENDPOINT_URL", "")
    access_key = getattr(settings, "AWS_ACCESS_KEY_ID", "")
    secret_key = getattr(settings, "AWS_SECRET_ACCESS_KEY", "")
    if not endpoint or not access_key or not secret_key:
        raise ValueError("Faltan credenciales de R2 para descargar backups.")

    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
    )
    response = client.get_object(Bucket=bucket, Key=object_key)
    body = response.get("Body")
    if body is None:
        raise ValueError("R2 no devolvio contenido para el backup solicitado.")
    return body.read()


def delete_backup_from_r2(*, bucket: str, object_key: str) -> None:
    endpoint = getattr(settings, "AWS_S3_ENDPOINT_URL", "")
    access_key = getattr(settings, "AWS_ACCESS_KEY_ID", "")
    secret_key = getattr(settings, "AWS_SECRET_ACCESS_KEY", "")
    if not endpoint or not access_key or not secret_key:
        raise ValueError("Faltan credenciales de R2 para borrar backups.")

    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
    )
    client.delete_object(Bucket=bucket, Key=object_key)
