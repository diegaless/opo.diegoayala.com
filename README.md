# Temario PES Informatica

Sitio estatico para consultar el temario de la especialidad de Informatica de
Profesorado de Ensenanza Secundaria.

Fuente principal:

- BOE-A-1996-3102: Orden de 1 de febrero de 1996.

Dominio previsto:

- https://opo.diegoayala.com/

## Auditoria antes de publicar

Comprobacion local rapida:

```bash
python3 scripts/audit_data.py
```

Comprobacion completa de enlaces y permisos de Drive:

```bash
python3 scripts/audit_data.py --check-links
```

La auditoria falla si hay recursos pendientes, IDs duplicados dentro de una
misma vista, enlaces Drive no accesibles con `rclone`, enlaces externos rotos
o contadores de temas/materiales/fases descuadrados.
