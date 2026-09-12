import logging

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path
from ninja import NinjaAPI

from accounts.api import router as accounts_router
from accounts.security import AccessBearerAuth
from billing.api import router as billing_router
from comunicaciones.api import router as comunicaciones_router
from comunicaciones.outbound_api import router as comunicaciones_outbound_router
from crm.api import router as crm_router
from empresas.api import router as empresas_router
from facturacion.api import (
    cargar_certificado_sello_digital_django,
    router as facturacion_router,
)
from finanzas.api import router as finanzas_router
from catalogo.api import router as catalogo_router
from pos.api import router as pos_router

from .health import health_response, warmup_response

api = NinjaAPI(auth=AccessBearerAuth())
logger = logging.getLogger(__name__)
api.add_router("/accounts/", accounts_router)
api.add_router("/billing/", billing_router)
api.add_router("/crm/", crm_router)
api.add_router("/empresas/", empresas_router)
api.add_router("/facturacion/", facturacion_router)
api.add_router("/finanzas/", finanzas_router)
api.add_router("/comunicaciones/", comunicaciones_router)
api.add_router("/comunicaciones/", comunicaciones_outbound_router)
api.add_router("/catalogo/", catalogo_router)
api.add_router("/pos/", pos_router)


@api.exception_handler(Exception)
def api_unhandled_exception(request, exc):
    logger.exception("Unhandled API error", exc_info=exc)
    return api.create_response(
        request,
        {"detail": "No se pudo procesar la solicitud. Intenta de nuevo o contacta soporte."},
        status=500,
    )


urlpatterns = [
    path("", health_response),
    path("health/", health_response),
    path("api/warmup/", warmup_response),
    path("admin/", admin.site.urls),
    path("api/facturacion/emisor/csd/", cargar_certificado_sello_digital_django),
    path("api/", api.urls),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
