# Temario PES Informatica

Sitio estatico para consultar el temario de la especialidad de Informatica de
Profesorado de Ensenanza Secundaria.

Fuente principal:

- BOE-A-1996-3102: Orden de 1 de febrero de 1996.

Las fuentes del proceso selectivo se limitan a BOE, BORM, CARM/Educarm y a
una guia curricular identificada expresamente como no oficial. Los documentos
privados del preparador se muestran como material privado, sin atribuirles
vigencia tecnica.

La Parte B integra primero el temario oficial compacto de 74 temas y deja al
final solo criterios, introducciones y esquemas que no estan ya en los
selectores de academias. El resto de fases y el seguimiento personal se
mantienen como vistas independientes. Las vistas con mucho
material incluyen filtros por area, tema relacionado, procedencia, tipo, caracter, ano
y existencia de solucion. El estado de estudio, la nota personal, la ultima
vista, los filtros y la posicion de lectura se guardan solo en `localStorage`.
Las relaciones con el temario distinguen coincidencias exactas de asociaciones
por bloque o area; no se presentan estas ultimas como ejercicios especificos.

Hay un Google Doc privado de ejemplo completo para un tema representativo de
cada bloque: 1, 15, 27, 40, 48 y 65. Los enlaces se registran de forma
reproducible en `scripts/curate_sources.mjs` y siguen siendo accesibles solo
para la cuenta propietaria de Drive.

Dominio previsto:

- https://opo.diegoayala.com/

## Auditoria antes de publicar

Comprobacion local estricta, incluida la antiguedad de la revision oficial:

```bash
python3 scripts/audit_data.py --max-review-age 14 --fail-on-warning --strict-global-drive-ids
```

Comprobacion completa de enlaces y permisos de Drive:

```bash
python3 scripts/audit_data.py --check-links --http-timeout 20 --max-review-age 14 --fail-on-warning --strict-global-drive-ids
```

La auditoria falla si hay recursos pendientes, IDs duplicados dentro de una
misma vista, enlaces Drive no accesibles con `rclone`, enlaces externos rotos,
fuentes sin procedencia o fecha de revision, material de otra comunidad en la
vista normativa, titulos del temario distintos al BOE, metadatos de curacion
incompletos, relaciones tematicas fuera del rango 1-74 o contadores
descuadrados o archivos del temario reutilizados de forma redundante en otras
vistas.

En la comprobacion completa, `rclone` lee tambien los metadatos de permisos y
falla si un archivo enlazado tiene acceso publico, de dominio o de otra cuenta:
solo se admite la cuenta propietaria configurada con `--drive-owner`.

El workflow `.github/workflows/content-audit.yml` repite semanalmente la
auditoria estricta y la comprobacion HTTP. Si pasan mas de 14 dias sin actualizar
`verifiedAt`, falla deliberadamente para obligar a revisar CARM/BORM.

## Curacion de fuentes

La normalizacion reproducible de Normativa, Novedades y estados historicos se
ejecuta con:

```bash
node scripts/curate_sources.mjs
```

Despues debe ejecutarse siempre la auditoria completa antes de publicar.
