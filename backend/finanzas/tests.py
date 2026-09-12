import json
import os
import tempfile
from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.models import EventoAuditoria
from accounts.security import PLAN_OVERRIDE_METADATA_KEY
from accounts.test_utils import create_api_auth_context
from billing.background_jobs import run_due_jobs
from billing.models import PlanSaaS, SuscripcionCapa
from comunicaciones.models import (
    ConfiguracionComunicacion,
    HistorialEnvio,
    PlantillaMensaje,
    ReglaAutomatizacionMensaje,
)
from crm.models import Cliente
from empresas.models import CapaNegocio, EntidadNegocio, ReglaMarcoNegocio, ReglaNegocio
from facturacion.models import FacturaEmitida
from finanzas.bank_statement_parser import (
    ParsedBankStatement,
    parse_bbva_statement_pages,
    parse_generic_statement_pages,
)
from finanzas.eventos import (
    analyze_event_candidate,
    auto_match_event_for_transaction,
    build_receivable_candidate_context,
    build_events_dashboard,
    resolve_best_receivable_for_partida,
)
from finanzas.models import (
    CargaConciliacion,
    CuentaBancaria,
    CuentaPorCobrar,
    CuentaPorPagar,
    EventoFinanciero,
    EventoFinancieroPartida,
    PagoCuentaPorCobrar,
    PagoCuentaPorPagar,
    ProgramacionCuentaPorPagar,
    SaldoCliente,
    Transaccion,
)
from finanzas.services import (
    analyze_payment_candidate,
    build_bank_transaction_detail,
    build_cxc_row,
    build_payable_suggestion_candidate_pool,
    build_receivable_suggestion_candidate_pool,
    compute_transaction_hash,
    import_bank_transactions,
    list_receivable_candidates_for_transaction,
    match_payable_payment_for_transaction,
    match_receivable_payment_for_transaction,
    resolve_interest_rules_for_entities,
    serialize_transaction,
    sync_generated_cxc_if_open,
    update_transaction_reconciliation_status,
    validate_receivable_payment,
)

TEST_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}




