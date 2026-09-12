from django.contrib import admin

from .models import (
    AcuerdoUsoComunicacion,
    CanalWhatsappOficial,
    ConfiguracionComunicacion,
    EvidenciaPago,
    HistorialEnvio,
    MensajeEntrante,
    PlantillaMensaje,
    ReglaAutomatizacionMensaje,
    WebhookEntrante,
)

admin.site.register(ConfiguracionComunicacion)
admin.site.register(CanalWhatsappOficial)
admin.site.register(AcuerdoUsoComunicacion)
admin.site.register(PlantillaMensaje)
admin.site.register(ReglaAutomatizacionMensaje)
admin.site.register(HistorialEnvio)
admin.site.register(WebhookEntrante)
admin.site.register(MensajeEntrante)
admin.site.register(EvidenciaPago)
