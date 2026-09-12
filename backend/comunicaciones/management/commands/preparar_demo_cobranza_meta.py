from django.core.management.base import BaseCommand, CommandError

from comunicaciones.demo_cobranza import (
    DEFAULT_AMOUNT,
    DEFAULT_CAPA_NAME,
    DEFAULT_CLIENT_EMAIL,
    DEFAULT_CLIENT_NAME,
    DemoCobranzaMetaError,
    prepare_demo_cobranza_meta,
)


class Command(BaseCommand):
    help = (
        "Prepara un cliente y CxC demo de cobranza para grabar/pruebas Meta "
        "sin tocar cartera real."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--capa-nombre",
            default=DEFAULT_CAPA_NAME,
            help=f"Capa destino. Default: {DEFAULT_CAPA_NAME}.",
        )
        parser.add_argument(
            "--entidad-nombre",
            help="Entidad destino. Obligatorio si la capa tiene varias entidades activas.",
        )
        parser.add_argument(
            "--entidad-id",
            type=int,
            help="ID de la entidad destino. Recomendado cuando la capa tiene varias entidades.",
        )
        parser.add_argument(
            "--telefono",
            help="Numero mexicano de prueba. Acepta 10 digitos o 52 + 10 digitos.",
        )
        parser.add_argument(
            "--cliente-nombre",
            default=DEFAULT_CLIENT_NAME,
            help=f"Nombre del cliente demo. Default: {DEFAULT_CLIENT_NAME}.",
        )
        parser.add_argument(
            "--correo",
            default=DEFAULT_CLIENT_EMAIL,
            help=f"Correo del cliente demo. Default: {DEFAULT_CLIENT_EMAIL}.",
        )
        parser.add_argument(
            "--monto",
            help=f"Monto base de la CxC demo. Default: {DEFAULT_AMOUNT}.",
        )
        parser.add_argument(
            "--fecha-referencia",
            help="Fecha base YYYY-MM-DD para calcular vencimientos demo.",
        )
        parser.add_argument(
            "--sin-consentimiento",
            action="store_true",
            help="Deja pendiente el consentimiento de cobranza del cliente demo.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Muestra lo que haria sin crear ni actualizar registros.",
        )

    def handle(self, *args, **options):
        try:
            result = prepare_demo_cobranza_meta(
                capa_name=options["capa_nombre"],
                entidad_nombre=options.get("entidad_nombre"),
                entidad_id=options.get("entidad_id"),
                telefono=options.get("telefono"),
                cliente_nombre=options["cliente_nombre"],
                correo=options["correo"],
                monto=options.get("monto"),
                fecha_referencia=options.get("fecha_referencia"),
                consent_accepted=not bool(options.get("sin_consentimiento")),
                dry_run=bool(options.get("dry_run")),
            )
        except DemoCobranzaMetaError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write("Preparando demo controlado de cobranza Meta")
        self.stdout.write(f"Capa: {result['capa']['id']} | {result['capa']['nombre']}")
        self.stdout.write(
            f"Entidad: {result['entidad']['id']} | {result['entidad']['nombre']}"
        )
        self.stdout.write(
            "Cliente: "
            f"{options['cliente_nombre']} | "
            f"{result['telefono']['codigo_pais']} {result['telefono']['nacional']}"
        )
        for cuenta in result["cuentas"]:
            self.stdout.write(
                " - "
                f"{cuenta['referencia_unica']}: "
                f"{cuenta.get('escenario') or cuenta['concepto']} | "
                f"vence {cuenta['fecha_vencimiento']} | "
                f"periodo {cuenta['fecha_periodo_inicio']} a {cuenta['fecha_periodo_fin']} | "
                f"${cuenta['monto_total_texto']}"
            )

        if result["dry_run"]:
            self.stdout.write(self.style.WARNING("Dry-run: no se hicieron cambios."))
            return

        self.stdout.write(self.style.SUCCESS("Demo de cobranza Meta listo."))
        client = result["cliente"]
        self.stdout.write(
            f"Cliente demo: {client['id']} | {client['nombre']} | {client['telefono']}"
        )
        for cuenta in result["cuentas"]:
            action = "creada" if cuenta["creada"] else "actualizada"
            self.stdout.write(
                f"CxC {action}: {cuenta['id']} | {cuenta['referencia_unica']} | "
                f"vence {cuenta['fecha_vencimiento']} | "
                f"${cuenta['monto_total_texto']} | {cuenta['estatus_adeudo']}"
            )
        self.stdout.write("")
        self.stdout.write("Siguiente validacion sugerida:")
        self.stdout.write(
            "python manage.py procesar_recordatorios "
            f"--capa-id {result['capa']['id']} "
            "--dry-run --require-whatsapp-ready"
        )
