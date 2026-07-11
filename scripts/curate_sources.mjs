#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const VERIFIED_AT = "2026-07-12";
const PHASES_PATH = new URL("../data/phases.json", import.meta.url);

const OUT_OF_SCOPE_DRIVE_IDS = new Set([
  // Andalucía curricula, calls and school documents that do not apply in Murcia.
  "1JLLcNZgvl_p4465oXUOgaod952SyNA-C",
  "15ul5IxbGgAfHoglHgjEHlbXGVP24sUbf",
  "1jmUJWfpnso-BvQfnhsfFeoY_swNHG2nQ",
  "1Tn4xkBHthjB_5VyyRsaq00Z_1lpzupXy",
  "1ronaJyxX8DOItmMrYGgSsKRlBZJi2rmz",
  "1XBeg4hosSTb6UDYLhT_cIKJ9_N6EfYHq",
  "15fKGduz-6oObwrbtRYdXZWu05ysqyex3",
  "1qgzZq_togHLVw_5TKmqXxsNSKH47Yzg7",
  "1r3jPVP5d3Myk8tCXNrOtSulbzdNJcG1a",
  "1Qecw7iQYN2Ez6pq2gbIH2IdqJfSPzWH4",
  "1ImHAunXeYXVCkOOwcxpZCv1gmOJiu-ma",
  "1FWkhMQJEUGoT1bAYogTUoU8kBEpR22TW",
  "1LPAVDhi-1_L33i5L9Xzg4GD7gNBBHPSt",
  "1ssnBF6w1OcDFuJyfavSWnS2NlEJ-i-hL",
  "19KLnAetMh1pgdXI8673-BcG-k_QIfPI1",
  "1O-7jjUr8M13cd-JItvfJMdIGEb-KlF5Q",
  "1UG_mOPwWIrzuqRK18H-gTKmTCx24CxPw",
  "1aFXmSzV-7Gz9boJJFZVHUuMfugH36Hm2",
  "1F_Zjji-WJgKbYqltfFo2oIX-xgkKl1Md",
  "1tOaV8uRecrIB3Z2Np-9eDYZVWCG_mRJH",
  "15zUW9TboCR4pRTyxwqOIMa3MM0E2Du78",
  "1GEMzvxJrSuOS-ZOzTVBSxwaCdss2gx1H",
  "1Vm1UoTk3mbK_7aCdLlgZPyKbcrWhQb-Z",
  "1r6Vfjj5tTS87M65Ke2-gpeBVuNzT2PyP",
]);

const DUPLICATE_DRIVE_IDS = new Set([
  "1FuLicarWVj20AD00jcHoNtp52e7mON4V",
  "1A-gUDZZFB6_uFALPVV2PKtUxLZrFH2cE",
  "1YJlccdCw-P13h1c78LhMBK707M3E0Lzd",
]);

const legalSources = [
  {
    nivel: "Estado actual de convocatoria",
    norma: "Portal oficial de oposiciones docentes de la CARM",
    relevancia:
      "A 12/07/2026, el portal oficial muestra convocatorias 2026 para Maestros y Catedráticos de Música, pero no una nueva convocatoria de PES/Informática. La última localizada para 590107 sigue siendo la de 2025.",
    url: "https://www.carm.es/web/pagina?IDCONTENIDO=3977&IDTIPO=100&RASTRO=c798%24m",
    sourceKind: "official-murcia",
    officialDate: "Revisado 12/07/2026",
    status: "Sin nueva convocatoria PES publicada",
    statusKind: "verified",
  },
  {
    nivel: "Convocatoria autonómica Murcia",
    norma: "Orden de 20 de noviembre de 2024, BORM n.º 272 de 22/11/2024",
    relevancia:
      "Bases de la convocatoria de Secundaria y otros cuerpos celebrada en 2025. Es referencia histórica y no una convocatoria abierta.",
    url: "https://www.borm.es/services/anuncio/ano/2024/numero/5838/pdf?id=831952",
    sourceKind: "official-murcia",
    officialDate: "Publicado 22/11/2024",
    status: "Convocatoria 2025 cerrada",
    statusKind: "historical",
  },
  {
    nivel: "Criterios oficiales Murcia - Informática 590107",
    norma: "Criterios de valoración y actuación de Informática 590107 (2025)",
    relevancia:
      "Últimos criterios oficiales localizados para la especialidad. Concretan tiempos, material, ponderaciones y rúbricas de la convocatoria 2025; deben revisarse cuando se publique otra convocatoria.",
    url: "https://www.carm.es/web/pagina?IDCONTENIDO=74501&IDTIPO=100&RASTRO=c798%24m3977%2C74131%2C74447%2C74448",
    sourceKind: "official-murcia",
    officialDate: "Publicado 11/06/2025",
    status: "Últimos criterios localizados (2025)",
    statusKind: "verified",
  },
  {
    nivel: "Reglamento estatal de ingreso",
    norma: "Real Decreto 276/2007, de 23 de febrero - texto consolidado",
    relevancia: "Marco estatal de ingreso, accesos y adquisición de nuevas especialidades docentes.",
    url: "https://www.boe.es/buscar/act.php?id=BOE-A-2007-4372",
    sourceKind: "official-state",
    officialDate: "Texto consolidado consultado 12/07/2026",
    status: "Marco estatal",
    statusKind: "verified",
  },
  {
    nivel: "Temario estatal",
    norma: "Orden de 1 de febrero de 1996 - temario de Informática (74 temas)",
    relevancia:
      "Fuente primaria del listado de 74 temas de la especialidad de Informática utilizado por la convocatoria de Murcia 2025.",
    url: "https://www.boe.es/buscar/doc.php?id=BOE-A-1996-3102",
    sourceKind: "official-state",
    officialDate: "Publicado 13/02/1996",
    status: "Temario aplicado en 2025",
    statusKind: "verified",
  },
  {
    nivel: "Ordenación estatal de FP",
    norma: "Ley Orgánica 3/2022 y Real Decreto 659/2023",
    relevancia:
      "Marco estatal del sistema de Formación Profesional para contextualizar resultados de aprendizaje, evaluación y formación en empresa.",
    url: "https://www.boe.es/buscar/act.php?id=BOE-A-2023-16889",
    sourceKind: "official-state",
    officialDate: "Texto consolidado consultado 12/07/2026",
    status: "Marco estatal",
    statusKind: "verified",
  },
  {
    nivel: "Título DAW - estatal",
    norma: "Real Decreto 686/2010, de 20 de mayo",
    relevancia: "Establece el título de Técnico Superior en Desarrollo de Aplicaciones Web y sus enseñanzas mínimas.",
    url: "https://www.boe.es/buscar/doc.php?id=BOE-A-2010-9269",
    sourceKind: "official-state",
    officialDate: "Publicado 12/06/2010",
    status: "Norma del título",
    statusKind: "verified",
  },
  {
    nivel: "Actualización estatal DAW",
    norma: "Real Decreto 405/2023, de 29 de mayo",
    relevancia: "Actualiza el título de DAW y sus enseñanzas mínimas.",
    url: "https://www.boe.es/buscar/doc.php?id=BOE-A-2023-13221",
    sourceKind: "official-state",
    officialDate: "Publicado 03/06/2023",
    status: "Actualización del título",
    statusKind: "verified",
  },
  {
    nivel: "Atribución docente DAW",
    norma: "Real Decreto 500/2024, de 21 de mayo",
    relevancia:
      "Actualiza el anexo de atribución docente de DAW y asigna el módulo 0373 a la especialidad de Informática del cuerpo de Secundaria.",
    url: "https://www.boe.es/buscar/doc.php?id=BOE-A-2024-10685",
    sourceKind: "official-state",
    officialDate: "Publicado 28/05/2024",
    status: "Atribución docente actualizada",
    statusKind: "verified",
  },
  {
    nivel: "Currículo Murcia - DAW",
    norma: "Orden de 12 de marzo de 2013 - currículo DAW en Murcia",
    relevancia: "Currículo autonómico base del ciclo DAW; debe leerse junto con sus modificaciones posteriores.",
    url: "https://www.borm.es/services/anuncio/ano/2013/numero/4800/pdf?id=562568",
    sourceKind: "official-murcia",
    officialDate: "Publicado 01/04/2013",
    status: "Norma base, modificada",
    statusKind: "verified",
  },
  {
    nivel: "Actualización curricular Murcia - Informática",
    norma: "Orden de 10 de septiembre de 2022, BORM n.º 217",
    relevancia: "Modifica los currículos de Informática y Comunicaciones en Murcia, incluido el contenido del módulo 0373.",
    url: "https://www.borm.es/services/anuncio/ano/2022/numero/4674/pdf?id=810699",
    sourceKind: "official-murcia",
    officialDate: "Publicado 19/09/2022",
    status: "Modificación curricular",
    statusKind: "verified",
  },
  {
    nivel: "Organización curricular Murcia - DAW 2025/2026",
    norma: "Tablas horarias de Grado Superior - versión noviembre de 2025",
    relevancia:
      "La tabla de organización de FP de Murcia sitúa 0373 en 1.º de DAW, con 135 horas totales y 4 horas semanales. Es una referencia organizativa de 2025/2026, no una norma publicada en BORM, y debe revisarse para el curso aplicable.",
    url: "https://www.llegarasalto.com/wp-content/uploads/2025/11/TABLAS-HORARIAS-GS-NOVIEMBRE_2025.pdf",
    sourceKind: "regional-guide",
    officialDate: "Versión noviembre 2025 · revisado 12/07/2026",
    status: "Referencia organizativa 2025/2026",
    statusKind: "historical",
  },
];

function sourceSection(source) {
  if (/convocatoria|criterios|estado actual/i.test(source.nivel)) {
    return "Fuentes verificadas/Proceso selectivo";
  }
  if (/temario|reglamento/i.test(source.nivel)) {
    return "Fuentes verificadas/Temario y acceso";
  }
  return "Fuentes verificadas/DAW y módulo 0373";
}

function sourceType(source) {
  if (/criterios/i.test(source.nivel)) return "criterios oficiales";
  if (/convocatoria/i.test(source.nivel)) return "convocatoria oficial";
  if (/estado actual/i.test(source.nivel)) return "estado oficial";
  if (/temario/i.test(source.nivel)) return "temario oficial";
  if (source.sourceKind === "regional-guide") return "guía curricular";
  return "normativa oficial";
}

function sourceAcademy(source) {
  if (source.sourceKind === "official-state") return "BOE";
  if (source.sourceKind === "official-murcia") return "CARM/BORM";
  return "Guía FP Murcia";
}

function sourceResource(source) {
  const isPdf = /(?:\.pdf|\/pdf(?:\?|$)|services\/anuncio)/i.test(source.url);
  return {
    title: source.norma,
    phase: "00_Normativa_y_orden_legal",
    section: sourceSection(source),
    type: sourceType(source),
    academy: sourceAcademy(source),
    topic: "General",
    area: /DAW|FP|curricular|0373/i.test(`${source.nivel} ${source.norma}`)
      ? "DAW · Lenguajes de marcas 0373"
      : "PES 590 · Informática 107",
    officialDate: source.officialDate,
    status: source.status,
    statusKind: source.statusKind,
    note: source.relevancia,
    sourceKind: source.sourceKind,
    verifiedAt: VERIFIED_AT,
    hasPublicLink: true,
    url: source.url,
    urlMode: isPdf ? "official-pdf" : "official-page",
    clickLabel: isPdf ? "PDF" : "Oficial",
  };
}

function inferOfficialSource(url = "") {
  if (/\b(?:boe\.es)\b/i.test(url)) return "official-state";
  if (/\b(?:carm\.es|borm\.es|educarm\.es)\b/i.test(url)) return "official-murcia";
  if (/llegarasalto\.com/i.test(url)) return "regional-guide";
  return null;
}

function normalizeHistoricalStatus(resource) {
  if (resource.sourceKind === "archive-private") return;

  const status = resource.status || "";

  if (status === "Vigente 2025") {
    resource.status = "Convocatoria 2025";
    resource.statusKind = "historical";
  }

  if (/históric|anterior publicada/i.test(status)) {
    resource.statusKind = "historical";
  }

  if (status === "Último oficial localizado") {
    resource.status = "Último localizado (2025)";
    resource.statusKind = "verified";
  }

  if (status === "Última publicada") {
    resource.status = "Última publicada (2025)";
    resource.statusKind = "verified";
  }

  if (resource.officialDate === "2025/2026" && status === "Vigente") {
    resource.status = "Curso 2025/2026";
    resource.statusKind = "historical";
  }
}

function updateNewsResource(resource) {
  const title = resource.title || "";
  if (/criterios de (?:valoración|actuación) oficiales 2025/i.test(title)) {
    resource.status = "Últimos criterios localizados (2025)";
    resource.statusKind = "verified";
  } else if (/prueba práctica 2025|examen práctico oficial/i.test(title)) {
    resource.status = "Última prueba publicada (2025)";
    resource.statusKind = "verified";
  } else if (/Oposición 2025|Publicaciones de tribunales OPOSEC25/i.test(title)) {
    resource.status = "Histórico del proceso 2025";
    resource.statusKind = "historical";
  } else if (/fase de prácticas 2025/i.test(title)) {
    resource.officialDate = "Revisado 12/07/2026";
    resource.status = "Sin resolución final localizada";
    resource.statusKind = "pending";
    resource.note =
      "La página oficial conserva nombramientos e informes de la fase de prácticas 2025/2026, pero no muestra una resolución final de aptos a fecha 12/07/2026.";
  } else if (/página oficial de criterios, turno y documentos/i.test(title)) {
    resource.status = "Archivo oficial 2025";
    resource.statusKind = "historical";
  } else if (/turno 5 y adquisición de nuevas especialidades/i.test(title)) {
    resource.status = "Referencia de 2025";
    resource.statusKind = "historical";
  }
}

function countBy(resources, key, fallback = "General") {
  const counts = new Map();
  for (const resource of resources) {
    const value = String(resource[key] || fallback);
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }));
}

function refreshPhaseCounts(phase) {
  phase.resourceCount = phase.resources.length;
  phase.publicLinkCount = phase.resources.filter((resource) => resource.url).length;
  phase.sections = countBy(phase.resources, "section");
  phase.academies = countBy(phase.resources, "academy");
  phase.types = countBy(phase.resources, "type");
}

async function main() {
  const phasesData = JSON.parse(await readFile(PHASES_PATH, "utf8"));

  phasesData.generatedAt = `${VERIFIED_AT} 00:00:00`;
  phasesData.verifiedAt = VERIFIED_AT;
  phasesData.access =
    "Los archivos de Drive son privados y requieren la cuenta autorizada; las fuentes oficiales externas son públicas.";
  phasesData.verification = {
    scope: "Temario BOE, criterios y convocatoria CARM/BORM, estado de convocatoria, enlaces y procedencia de recursos.",
    officialSources: ["BOE", "BORM", "CARM"],
    note: "Las soluciones Codex y los archivos del preparador se muestran como material no oficial.",
    driveAccess:
      "Todos los archivos enlazados se auditan con metadatos de permisos; las carpetas raíz se contrastan aparte.",
  };
  phasesData.legalSources = legalSources.map((source) => ({ ...source, verifiedAt: VERIFIED_AT }));

  Object.assign(phasesData.selectedModule, {
    course: "1.º curso",
    weekly_hours: "4 horas semanales, según las tablas horarias de Murcia de noviembre de 2025.",
    old_curriculum_hours:
      "125 horas y 6 horas semanales en 2.º curso en el Anexo III de la Orden de 12/03/2013",
    hours_note:
      "Para una programación contextualizada en 2025/2026, usar 1.º curso, 135 horas y 4 horas semanales, citando la tabla organizativa de noviembre de 2025. Volver a comprobar la distribución al publicarse las instrucciones del curso aplicable.",
  });

  const normativa = phasesData.phases.find((phase) => phase.id === "00_Normativa_y_orden_legal");
  normativa.title = "Normativa verificada y archivo de referencia";
  normativa.legal = "Fuentes oficiales separadas del archivo del preparador.";
  normativa.description =
    "Primero se muestran las fuentes oficiales aplicables. El material privado restante queda marcado como archivo sin vigencia verificada.";
  const archiveResources = normativa.resources
    .filter(
      (resource) =>
        resource.driveFileId &&
        !OUT_OF_SCOPE_DRIVE_IDS.has(resource.driveFileId) &&
        !DUPLICATE_DRIVE_IDS.has(resource.driveFileId),
    )
    .map((resource) => ({
      ...resource,
      section: resource.section.includes("Web XML")
        ? "Archivo del preparador/Web XML y scripts"
        : "Archivo del preparador/Material auxiliar",
      sourceKind: "archive-private",
      status: "Archivo · vigencia no verificada",
      statusKind: "archive",
      reviewedAt: VERIFIED_AT,
      note:
        "Material privado conservado como referencia. No sustituye la fuente oficial y puede estar desactualizado.",
    }));
  normativa.resources = [...legalSources.map(sourceResource), ...archiveResources];

  const writtenTopic = phasesData.phases.find(
    (phase) => phase.id === "01_Primera_prueba_B_Tema_escrito",
  );
  writtenTopic.title = "Primera prueba - Parte B: Desarrollo por escrito de un tema";

  const trends = phasesData.phases.find((phase) => phase.id === "97_Que_cae_mas");
  for (const source of trends.sourceYears || []) {
    const isLatest = source.year === "2025";
    Object.assign(source, {
      sourceKind: "official-murcia",
      officialDate: `Publicado ${source.year} · fecha exacta no visible en CARM`,
      status: isLatest ? "Última prueba publicada (2025)" : "Prueba oficial histórica",
      statusKind: isLatest ? "verified" : "historical",
      verifiedAt: VERIFIED_AT,
    });
  }

  const news = phasesData.phases.find((phase) => phase.id === "98_Novedades_y_publicaciones");
  news.title = "Novedades PES 590 · Informática 107 · Murcia";
  news.legal = "Estado oficial verificado y archivo de la convocatoria 2025.";
  news.description =
    "Seguimiento exclusivo de PES 590 e Informática 107 en Murcia, con fecha de comprobación y alcance explícitos.";
  news.resources = news.resources.filter(
    (resource) =>
      resource.title !==
      "Situación actual PES/Informática en Murcia: sin nueva convocatoria publicada",
  );
  news.resources.forEach((resource) => {
    updateNewsResource(resource);
    if (resource.section === "Novedades/Informática 590107") {
      resource.section = "Última convocatoria PES/Informática 2025";
    } else if (resource.section === "Novedades/Oposición 2025 PES") {
      resource.section = "Histórico 2025/Proceso y resultados";
    } else if (resource.section === "Novedades/Normativa base PES") {
      resource.section = "Histórico 2025/Convocatoria";
    }
  });
  news.resources.unshift({
    title: "Situación actual PES/Informática en Murcia: sin nueva convocatoria publicada",
    phase: news.id,
    section: "Estado actual/Convocatoria PES",
    type: "estado oficial",
    academy: "CARM/BORM",
    topic: "General",
    area: "PES 590 · Informática 107",
    officialDate: "Revisado 12/07/2026",
    status: "Sin plazo de instancia abierto",
    statusKind: "verified",
    note:
      "El portal oficial de oposiciones de Murcia muestra en 2026 Maestros y Catedráticos de Música, pero no una nueva convocatoria de PES/Informática. La última localizada para 590107 es la de 2025; esto no predice la fecha de la siguiente.",
    sourceKind: "official-murcia",
    verifiedAt: VERIFIED_AT,
    hasPublicLink: true,
    url: "https://www.carm.es/web/pagina?IDCONTENIDO=3977&IDTIPO=100&RASTRO=c798%24m",
    urlMode: "official-page",
    clickLabel: "CARM",
  });

  const practices = phasesData.phases.find((phase) => phase.id === "06_Fase_practicas");
  const finalPracticeResolution = practices.resources.find((resource) =>
    /Cierre de la fase de prácticas|resolución final/i.test(resource.title || ""),
  );
  if (finalPracticeResolution) {
    Object.assign(finalPracticeResolution, {
      title: "Seguimiento de la resolución final de la fase de prácticas 2025/2026",
      officialDate: "Revisado 12/07/2026",
      status: "Sin resolución final localizada",
      statusKind: "pending",
      note:
        "La sección oficial consultada conserva nombramientos e informes, pero no muestra una resolución final de aptos a fecha 12/07/2026.",
    });
  }

  for (const phase of phasesData.phases) {
    for (const resource of phase.resources || []) {
      const sourceKind = inferOfficialSource(resource.url);
      if (sourceKind) {
        resource.sourceKind = sourceKind;
        resource.verifiedAt = VERIFIED_AT;
      }
      normalizeHistoricalStatus(resource);
    }
    refreshPhaseCounts(phase);
  }

  phasesData.totalResources = phasesData.phases.reduce(
    (total, phase) => total + phase.resources.length,
    0,
  );
  phasesData.publicLinkCount = phasesData.phases.reduce(
    (total, phase) => total + phase.resources.filter((resource) => resource.url).length,
    0,
  );

  await writeFile(PHASES_PATH, `${JSON.stringify(phasesData, null, 2)}\n`);
}

await main();
