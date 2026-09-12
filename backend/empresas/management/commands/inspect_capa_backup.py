from pathlib import Path

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from empresas.backup_inspection import inspect_backup_workbook
from empresas.backup_storage import download_backup_from_r2


class Command(BaseCommand):
    help = "Inspecciona un backup de capa y valida si es candidato para restore."

    def add_arguments(self, parser):
        parser.add_argument("--file", default="", help="Ruta local del archivo .xlsx.")
        parser.add_argument("--r2-bucket", default="", help="Bucket R2 del backup.")
        parser.add_argument("--r2-key", default="", help="Object key R2 del backup.")
        parser.add_argument(
            "--expected-checksum",
            default="",
            help="Checksum SHA256 esperado registrado en historial.",
        )

    def handle(self, *args, **options):
        file_path = (options.get("file") or "").strip()
        r2_bucket = (options.get("r2_bucket") or "").strip()
        r2_key = (options.get("r2_key") or "").strip()
        expected_checksum = (options.get("expected_checksum") or "").strip().lower()

        if bool(file_path) == bool(r2_key):
            raise CommandError("Usa exactamente una fuente: --file o --r2-key.")
        if r2_key and not r2_bucket:
            raise CommandError("Para leer desde R2 define --r2-bucket y --r2-key.")

        if file_path:
            path = Path(file_path)
            if not path.exists():
                raise CommandError(f"No existe el archivo {path}.")
            content = path.read_bytes()
            source = str(path)
        else:
            try:
                content = download_backup_from_r2(bucket=r2_bucket, object_key=r2_key)
            except ValueError as exc:
                raise CommandError(str(exc)) from exc
            source = f"{r2_bucket}/{r2_key}"

        try:
            inspection = inspect_backup_workbook(
                content,
                expected_checksum=expected_checksum,
            )
        except ValidationError as exc:
            raise CommandError(exc.messages[0]) from exc

        self.stdout.write(f"Fuente: {source}")
        self.stdout.write(f"Checksum SHA256: {inspection['checksum_sha256']}")
        for sheet in inspection["hojas"]:
            self.stdout.write(f"{sheet['nombre']}: {sheet['filas']} fila(s)")
        self.stdout.write(self.style.SUCCESS("Backup valido para analisis de restore."))
