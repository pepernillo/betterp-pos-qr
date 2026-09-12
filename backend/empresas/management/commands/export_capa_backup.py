from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from empresas.backup_export import build_capa_backup_workbook
from empresas.backup_storage import (
    build_backup_object,
    create_backup_history,
    upload_backup_to_r2,
)
from empresas.models import CapaNegocio


class Command(BaseCommand):
    help = "Genera backups operativos MVP por capa en archivos Excel."

    def add_arguments(self, parser):
        parser.add_argument(
            "--capa-id",
            type=int,
            help="ID de la capa a respaldar.",
        )
        parser.add_argument(
            "--all-active",
            action="store_true",
            help="Exporta todas las capas activas.",
        )
        parser.add_argument(
            "--output-dir",
            default="",
            help="Carpeta donde se escribiran los archivos .xlsx.",
        )
        parser.add_argument(
            "--upload-r2",
            action="store_true",
            help="Sube el backup a Cloudflare R2 y registra historial.",
        )
        parser.add_argument(
            "--record-local",
            action="store_true",
            help="Registra historial tambien para archivos locales.",
        )
        parser.add_argument(
            "--generated-by",
            default="management-command",
            help="Etiqueta operativa del responsable o proceso que genero el backup.",
        )

    def handle(self, *args, **options):
        capa_id = options.get("capa_id")
        all_active = options.get("all_active")
        output_dir_value = (options.get("output_dir") or "").strip()
        upload_r2 = bool(options.get("upload_r2"))
        record_local = bool(options.get("record_local"))
        generated_by = (options.get("generated_by") or "").strip()
        output_dir = Path(output_dir_value) if output_dir_value else None

        if not output_dir and not upload_r2:
            raise CommandError("Define --output-dir, --upload-r2 o ambos.")

        if bool(capa_id) == bool(all_active):
            raise CommandError("Usa exactamente una opcion: --capa-id o --all-active.")

        if capa_id:
            try:
                capas = [CapaNegocio.objects.get(id=capa_id)]
            except CapaNegocio.DoesNotExist as exc:
                raise CommandError(f"No existe la capa {capa_id}.") from exc
        else:
            capas = list(CapaNegocio.objects.filter(activo=True).order_by("id"))

        if not capas:
            raise CommandError("No hay capas activas para respaldar.")

        if output_dir:
            output_dir.mkdir(parents=True, exist_ok=True)
        written_files = []
        uploaded_records = []

        for capa in capas:
            content = build_capa_backup_workbook(capa)
            backup = build_backup_object(capa, content)
            if output_dir:
                path = output_dir / backup.filename
                path.write_bytes(backup.content)
                written_files.append(path)
                self.stdout.write(f"Backup capa {capa.id}: {path}")
                if record_local:
                    create_backup_history(
                        capa=capa,
                        backup=backup,
                        storage_backend="LOCAL",
                        object_key=str(path),
                        generado_por=generated_by,
                    )
            if upload_r2:
                try:
                    record = upload_backup_to_r2(
                        capa=capa,
                        backup=backup,
                        generado_por=generated_by,
                    )
                except ValueError as exc:
                    raise CommandError(str(exc)) from exc
                uploaded_records.append(record)
                self.stdout.write(
                    f"Backup R2 capa {capa.id}: {record.bucket}/{record.object_key}"
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"Backups locales: {len(written_files)} | Backups R2: {len(uploaded_records)}"
            )
        )
