# Retiro de Vende Facil y consolidacion en BetterP Commerce

Vende Facil se conserva exclusivamente como identidad historica. La oferta comercial vigente,
los planes y las nuevas suscripciones pertenecen a `tienda_facil`, cuyo nombre publico es
BetterP Commerce.

## Contrato

- No se eliminan capas, suscripciones, eventos ni datos historicos.
- Los planes `vende_*` permanecen inactivos y nunca vuelven a ser predeterminados.
- Las vistas corrientes de backoffice omiten la solucion retirada.
- Los enlaces antiguos de Vende Facil siguen resolviendo hacia BetterP Commerce.
- Una suscripcion legacy con referencias de Stripe no se consolida automaticamente.
- Cada consolidacion queda sellada por `scope_hash` y genera evidencia de billing local.

## Ejecucion

Primero se obtiene el alcance sin modificar datos:

```bash
python manage.py retire_vende_facil
```

La aplicacion exige que el hash siga vigente:

```bash
python manage.py retire_vende_facil --apply \
  --confirmation CONSOLIDAR_VENDE_FACIL_EN_COMMERCE \
  --expected-scope-hash sha256:...
```

Si el destino es ambiguo, existe un plan sin mapeo, aparece una referencia Stripe o cambia el
alcance, el comando aborta sin aplicar cambios.
