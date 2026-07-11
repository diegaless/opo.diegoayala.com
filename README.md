# Temario PES Informatica

Sitio estatico para consultar el temario de la especialidad de Informatica de
Profesorado de Ensenanza Secundaria.

Fuente principal:

- BOE-A-1996-3102: Orden de 1 de febrero de 1996.

Las fuentes del proceso selectivo se limitan a BOE, BORM, CARM/Educarm y a
una guia curricular identificada expresamente como no oficial. Los documentos
privados del preparador se muestran como archivo, sin atribuirles vigencia.

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
misma vista, enlaces Drive no accesibles con `rclone`, enlaces externos rotos,
fuentes sin procedencia o fecha de revision, material de otra comunidad en la
vista normativa, titulos del temario distintos al BOE o contadores
descuadrados. Un mismo archivo puede aparecer de forma intencionada en varias
vistas; esa reutilizacion se informa, pero no se considera un duplicado.

En la comprobacion completa, `rclone` lee tambien los metadatos de permisos y
falla si un archivo enlazado tiene acceso publico, de dominio o de otra cuenta:
solo se admite la cuenta propietaria configurada con `--drive-owner`.

## Curacion de fuentes

La normalizacion reproducible de Normativa, Novedades y estados historicos se
ejecuta con:

```bash
node scripts/curate_sources.mjs
```

Despues debe ejecutarse siempre la auditoria completa antes de publicar.
