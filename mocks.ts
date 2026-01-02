
export const CONSALUD_EJEMPLO = {
    "reglas": [
        {
            "PÁGINA ORIGEN": "2",
            "CÓDIGO/SECCIÓN": "IDENTIFICACIÓN DEL PLAN",
            "SUBCATEGORÍA": "NOMBRE Y CÓDIGO",
            "VALOR EXTRACTO LITERAL DETALLADO": "CORE 206 25 | Código: 13-CORE206-25"
        },
        {
            "PÁGINA ORIGEN": "3",
            "CÓDIGO/SECCIÓN": "ARANCEL",
            "SUBCATEGORÍA": "DEFINICIÓN",
            "VALOR EXTRACTO LITERAL DETALLADO": "NOMBRE DEL ARANCEL: AC3 | UNIDAD: PESOS. El Arancel Consalud es una lista valorizada de prestaciones cubierta por tu plan de salud, y este tendrá un Reajuste General el 01 de abril de cada año hasta en un 100% de la variación experimentada por el Indice de Precios al Consumidor (IPC) entre marzo del año anterior a febrero del año de reajuste."
        },
        {
            "PÁGINA ORIGEN": "3",
            "CÓDIGO/SECCIÓN": "TOPE GENERAL ANUAL",
            "SUBCATEGORÍA": "LÍMITE POR BENEFICIARIO",
            "VALOR EXTRACTO LITERAL DETALLADO": "TOPE GENERAL ANUAL POR BENEFICIARIO: 4000 UF (6)"
        },
        {
            "PÁGINA ORIGEN": "4",
            "CÓDIGO/SECCIÓN": "NOTA (1)",
            "SUBCATEGORÍA": "DEFINICIÓN PRESTACIONES",
            "VALOR EXTRACTO LITERAL DETALLADO": "PRESTACIONES: a) Hospitalarias: Son aquellas que requieren de día cama o intervención quirúrgica con pabellón de complejidad igual o mayor a 5. b) Ambulatorias: Son aquellas no consideradas en la definición anterior."
        },
        {
            "PÁGINA ORIGEN": "4",
            "CÓDIGO/SECCIÓN": "NOTA (2)",
            "SUBCATEGORÍA": "MEDICAMENTOS E INSUMOS",
            "VALOR EXTRACTO LITERAL DETALLADO": "MEDICAMENTOS Y MATERIALES CLINICOS HOSPITALARIOS: Son aquellos medicamentos y materiales clínicos recibidos por el beneficiario por causa de prestaciones hospitalarias. Sólo serán objeto de bonificación, aquellos medicamentos y materiales clínicos que el establecimiento hospitalario haya considerado en su factura. Se excluyen de este ítem los medicamentos y materiales clínicos por tratamiento de cáncer, dado que se bonificarán en los porcentajes y topes específicos definidos para el ítem Quimioterapia. Se excluyen asimismo de la oferta preferente, los medicamentos y materiales clínicos por tratamiento de infertilidad, dado que se bonificarán en los porcentajes y topes específicos definidos para la modalidad de libre elección."
        },
        {
            "PÁGINA ORIGEN": "4",
            "CÓDIGO/SECCIÓN": "NOTA (5)",
            "SUBCATEGORÍA": "TOPES DE BONIFICACIÓN",
            "VALOR EXTRACTO LITERAL DETALLADO": "TOPES DE BONIFICACION: Los topes de bonificación se expresan en UF o en veces el Arancel Consalud (AC3). Los topes en UF se calcularán al valor oficial registrado por dicha unidad el último día del mes anterior a la fecha en que se bonifica la prestación."
        },
        {
            "PÁGINA ORIGEN": "4",
            "CÓDIGO/SECCIÓN": "NOTA (7)",
            "SUBCATEGORÍA": "QUIMIOTERAPIA",
            "VALOR EXTRACTO LITERAL DETALLADO": "QUIMIOTERAPIA HOSPITALARIA Y/O AMBULATORIA: Tendrán cobertura aquellos esquemas terapéuticos incorporados en el Grupo vigente del Arancel Fonasa los cuales se encuentran definidos en el Listado anual de drogas publicadas por la Unidad de Cáncer, dependiente del MINSAL. La cobertura para los esquemas terapéuticos que no se encuentren en este listado corresponderá exclusivamente para aquellos con acción citotóxica y/o citostática sobre el cáncer. No tendrán cobertura medicamentos que correspondan a inmunoterapia, inmunomoduladores, hormonoterapia, bifosfonatos, medicamentos coadyuvantes de la quimioterapia y aquéllos que previenen los efectos no deseados de ésta."
        },
        {
            "PÁGINA ORIGEN": "4",
            "CÓDIGO/SECCIÓN": "NOTA (18)",
            "SUBCATEGORÍA": "CAEC",
            "VALOR EXTRACTO LITERAL DETALLADO": "COBERTURA ADICIONAL PARA ENFERMEDADES CATASTRÓFICAS (CAEC): Es una cobertura que tiene por finalidad aumentar los beneficios del plan complementario de salud, que asegura un monto máximo a pagar de 126 UF por evento, en una red cerrada de prestadores definida por la Isapre para tratamientos médicos de alto costo."
        },
        {
            "PÁGINA ORIGEN": "5",
            "CÓDIGO/SECCIÓN": "OFERTA PREFERENTE",
            "SUBCATEGORÍA": "CONDICIÓN A.1",
            "VALOR EXTRACTO LITERAL DETALLADO": "Las Consultas Médicas, procedimientos ambulatorios y los Honorarios Médicos por prestaciones hospitalarias realizadas en los prestadores nominados en la carátula del plan en el recuadro de prestadores ambulatorios, tendrán cobertura preferente cuando sean efectuadas por médicos Staff en convenio entre Isapre Consalud y las Instituciones de Salud señaladas para cada prestación otorgada en el plan. En caso de no cumplir estas condiciones, la cobertura preferente se aplicará solo a la facturación de la clínica y los Honorarios Médicos serán bonificados de acuerdo a la modalidad libre elección."
        },
        {
            "PÁGINA ORIGEN": "6",
            "CÓDIGO/SECCIÓN": "NOTA (M)",
            "SUBCATEGORÍA": "CIRUGÍAS COPAGO FIJO",
            "VALOR EXTRACTO LITERAL DETALLADO": "Listado de prestaciones hospitalarias en las que pagarás el monto indicado (copago), disponible en la clínica identificada con una 'x'. Ante la eventualidad de existir dos o mas intervenciones hospitalarias en un mismo evento, se bonificará de acuerdo a la prestación principal que originó la hospitalización. El Copago Fijo indicado no considera prestaciones no bonificables (No aranceladas)."
        }
    ],
    "coberturas": [
        {
            "PRESTACIÓN CLAVE": "Dia Cama (17)",
            "MODALIDAD/RED": "OFERTA PREFERENTE",
            "TOPE LOCAL 1 (VAM/EVENTO)": "SIN TOPE",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "40% SIN TOPE | Clínica RedSalud Santiago, Clínica Bupa Santiago, Hospital Clínico Universidad de Chile (A.2) | (17) DÍA CAMA: Comprende día cama cirugía, pediatría, gineco-obstetricia, medicina, sala cuna, incubadora, cuidados intensivos o coronarios, intermedio, observación y aislamiento."
        },
        {
            "PRESTACIÓN CLAVE": "Dia Cama (17)",
            "MODALIDAD/RED": "LIBRE ELECCIÓN",
            "TOPE LOCAL 1 (VAM/EVENTO)": "2,00 UF",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "40% Bonificación | (17) DÍA CAMA: Comprende día cama cirugía, pediatría, gineco-obstetricia, medicina, sala cuna, incubadora, cuidados intensivos o coronarios, intermedio, observación y aislamiento."
        },
        {
            "PRESTACIÓN CLAVE": "Honorarios Medicos Quirurgicos",
            "MODALIDAD/RED": "OFERTA PREFERENTE",
            "TOPE LOCAL 1 (VAM/EVENTO)": "SIN TOPE",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "40% SIN TOPE | Clínica RedSalud Santiago, Clínica Bupa Santiago, Hospital Clínico Universidad de Chile (A.2) | Sujeto a condición A.1 (Médicos Staff)."
        },
        {
            "PRESTACIÓN CLAVE": "Honorarios Medicos Quirurgicos",
            "MODALIDAD/RED": "LIBRE ELECCIÓN",
            "TOPE LOCAL 1 (VAM/EVENTO)": "0,90 AC3",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "40% Bonificación."
        },
        {
            "PRESTACIÓN CLAVE": "Medicamentos Hospitalarios (2)",
            "MODALIDAD/RED": "OFERTA PREFERENTE",
            "TOPE LOCAL 1 (VAM/EVENTO)": "100 (AC3/UF?)",
            "TOPE LOCAL 2 (ANUAL/UF)": "20 UF",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "40% Bonificación | Clínica RedSalud Santiago, Clínica Bupa Santiago, Hospital Clínico Universidad de Chile (A.2) | (2) MEDICAMENTOS Y MATERIALES CLINICOS HOSPITALARIOS: Se excluyen medicamentos por tratamiento de cáncer e infertilidad."
        },
        {
            "PRESTACIÓN CLAVE": "Medicamentos Hospitalarios (2)",
            "MODALIDAD/RED": "LIBRE ELECCIÓN",
            "TOPE LOCAL 1 (VAM/EVENTO)": "20 UF",
            "TOPE LOCAL 2 (ANUAL/UF)": "20 UF",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "40% Bonificación | (2) MEDICAMENTOS Y MATERIALES CLINICOS HOSPITALARIOS: Se excluyen medicamentos por tratamiento de cáncer e infertilidad."
        },
        {
            "PRESTACIÓN CLAVE": "Consulta Médica Y Telemedicina En Especialidades (10)",
            "MODALIDAD/RED": "OFERTA PREFERENTE",
            "TOPE LOCAL 1 (VAM/EVENTO)": "Copago 0,19 UF",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "Paga 0,19 UF en consultas descritas en la letra (N) (Valor referencial de $7.446) | Centros Médicos RedSalud (A.3), Clínica RedSalud Santiago, Clínica Bupa Santiago, Hospital Clínico Universidad de Chile | (10) CONSULTA MEDICA DE TELEMEDICINA EN ESPECIALIDADES: Considera todas las especialidades aranceladas en FONASA."
        },
        {
            "PRESTACIÓN CLAVE": "Consulta Médica Y Telemedicina En Especialidades (10)",
            "MODALIDAD/RED": "LIBRE ELECCIÓN",
            "TOPE LOCAL 1 (VAM/EVENTO)": "0,30 UF",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "40% Bonificación | (10) CONSULTA MEDICA DE TELEMEDICINA EN ESPECIALIDADES: Considera todas las especialidades aranceladas en FONASA."
        },
        {
            "PRESTACIÓN CLAVE": "Apendicitis (1802053)",
            "MODALIDAD/RED": "OFERTA PREFERENTE (M)",
            "TOPE LOCAL 1 (VAM/EVENTO)": "Copago 19,0 UF",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "Malla Visual: Paga entre 2,7 UF y 47,2 UF en 17 prestaciones descritas en la letra(M) | Válido en Clínica RedSalud Santiago."
        },
        {
            "PRESTACIÓN CLAVE": "Histerectomía (2003010)",
            "MODALIDAD/RED": "OFERTA PREFERENTE (M)",
            "TOPE LOCAL 1 (VAM/EVENTO)": "Copago 19,6 UF",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "Malla Visual: Paga entre 2,7 UF y 47,2 UF en 17 prestaciones descritas en la letra(M) | Válido en Hospital Clínico Universidad de Chile, Clínica RedSalud Santiago, Clínica Bupa Santiago."
        },
        {
            "PRESTACIÓN CLAVE": "Cirugía Bariatrica Y Metabólica, Septoplastía, Rinoplastía",
            "MODALIDAD/RED": "LIBRE ELECCIÓN",
            "TOPE LOCAL 1 (VAM/EVENTO)": "Con tope Libre Elección",
            "TOPE LOCAL 2 (ANUAL/UF)": "Con tope Libre Elección",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "PRESTACIONES RESTRINGIDAS | 25% Bonificación | Sólo Cobertura Libre Elección."
        },
        {
            "PRESTACIÓN CLAVE": "Cirugía Presbicia, Cirugía Fotorrefractiva o Fototerapéutica",
            "MODALIDAD/RED": "OFERTA PREFERENTE",
            "TOPE LOCAL 1 (VAM/EVENTO)": "SIN TOPE",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "40% Sin Tope: Centro Oftalmológico Providencia, Clínica Oftalmológica IOPA."
        },
        {
            "PRESTACIÓN CLAVE": "Optica (Marcos y Cristales) (8)",
            "MODALIDAD/RED": "LIBRE ELECCIÓN",
            "TOPE LOCAL 1 (VAM/EVENTO)": "0,50 UF",
            "TOPE LOCAL 2 (ANUAL/UF)": "0,50 UF",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "40% Bonificación | (8) MARCOS Y CRISTALES OPTICOS: Corresponderá la bonificación previa presentación de prescripción profesional y boleta. No incluye cirugía Lasik o Fotorrefractiva."
        },
        {
            "PRESTACIÓN CLAVE": "Urgencia Adulto",
            "MODALIDAD/RED": "CLÍNICA REDSALUD SANTIAGO",
            "TOPE LOCAL 1 (VAM/EVENTO)": "1,84 UF (Simple) / 5,24 UF (Compleja)",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "ATENCIÓN INTEGRAL DE URGENCIA (D) (F) | Incluye consulta médica de urgencia, insumos, medicamentos, imagenología, exámenes, procedimientos y honorarios médicos."
        },
        {
            "PRESTACIÓN CLAVE": "Urgencia Adulto",
            "MODALIDAD/RED": "CLÍNICA BUPA SANTIAGO",
            "TOPE LOCAL 1 (VAM/EVENTO)": "2,39 UF (Simple) / 6,47 UF (Compleja)",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "ATENCIÓN INTEGRAL DE URGENCIA (D) (F) | Incluye consulta médica de urgencia, insumos, medicamentos, imagenología, exámenes, procedimientos y honorarios médicos."
        },
        {
            "PRESTACIÓN CLAVE": "Consulta Médica Electiva",
            "MODALIDAD/RED": "LIBRE ELECCIÓN",
            "TOPE LOCAL 1 (VAM/EVENTO)": "$11.757",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "40% Bonificación | Selección de Prestaciones Valorizadas (Pág 7)."
        },
        {
            "PRESTACIÓN CLAVE": "Consulta Médica Electiva",
            "MODALIDAD/RED": "BENEFICIOS ASOCIADOS A CIERTOS PRESTADORES",
            "TOPE LOCAL 1 (VAM/EVENTO)": "SIN TOPE",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "60% Bonificación | Prestador Número 1 | Selección de Prestaciones Valorizadas (Pág 7)."
        },
        {
            "PRESTACIÓN CLAVE": "Hemograma",
            "MODALIDAD/RED": "LIBRE ELECCIÓN",
            "TOPE LOCAL 1 (VAM/EVENTO)": "$3.103",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "40% Bonificación | Selección de Prestaciones Valorizadas (Pág 7)."
        },
        {
            "PRESTACIÓN CLAVE": "Hemograma",
            "MODALIDAD/RED": "BENEFICIOS ASOCIADOS A CIERTOS PRESTADORES",
            "TOPE LOCAL 1 (VAM/EVENTO)": "SIN TOPE",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "40% Bonificación | Prestador Número 1 | Selección de Prestaciones Valorizadas (Pág 7)."
        },
        {
            "PRESTACIÓN CLAVE": "Tomografía Axial Computarizada",
            "MODALIDAD/RED": "LIBRE ELECCIÓN",
            "TOPE LOCAL 1 (VAM/EVENTO)": "$63.917",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "40% Bonificación | Selección de Prestaciones Valorizadas (Pág 7)."
        },
        {
            "PRESTACIÓN CLAVE": "Tomografía Axial Computarizada",
            "MODALIDAD/RED": "BENEFICIOS ASOCIADOS A CIERTOS PRESTADORES",
            "TOPE LOCAL 1 (VAM/EVENTO)": "SIN TOPE",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "40% Bonificación | Prestador Número 1 | Selección de Prestaciones Valorizadas (Pág 7)."
        },
        {
            "PRESTACIÓN CLAVE": "Parto Normal (Honorarios Médicos)",
            "MODALIDAD/RED": "LIBRE ELECCIÓN",
            "TOPE LOCAL 1 (VAM/EVENTO)": "$339.335",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "40% Bonificación | Selección de Prestaciones Valorizadas (Pág 7)."
        },
        {
            "PRESTACIÓN CLAVE": "Parto Normal (Honorarios Médicos)",
            "MODALIDAD/RED": "BENEFICIOS ASOCIADOS A CIERTOS PRESTADORES",
            "TOPE LOCAL 1 (VAM/EVENTO)": "SIN TOPE",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "40% Bonificación | Prestador Número 1 | Selección de Prestaciones Valorizadas (Pág 7)."
        },
        {
            "PRESTACIÓN CLAVE": "Apendicectomía (Honorarios Médicos)",
            "MODALIDAD/RED": "BENEFICIOS ASOCIADOS A CIERTOS PRESTADORES",
            "TOPE LOCAL 1 (VAM/EVENTO)": "$744.600",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "Copago Fijo $744.600 | Prestador Número 1 | Selección de Prestaciones Valorizadas (Pág 7)."
        },
        {
            "PRESTACIÓN CLAVE": "Histerectomía Total (Honorarios Médicos)",
            "MODALIDAD/RED": "BENEFICIOS ASOCIADOS A CIERTOS PRESTADORES",
            "TOPE LOCAL 1 (VAM/EVENTO)": "$768.113",
            "TOPE LOCAL 2 (ANUAL/UF)": "SIN TOPE",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "Copago Fijo $768.113 | Prestador Número 1 | Selección de Prestaciones Valorizadas (Pág 7)."
        }
    ],
    "diseno_ux": {
        "nombre_isapre": "Consalud",
        "titulo_plan": "PLANES CORE",
        "subtitulo_plan": "CORE 206 25 (13-CORE206-25)",
        "layout": "forensic_report_v2",
        "funcionalidad": "pdf_isapre_analyzer_imperative",
        "salida_json": "strict_schema_v3_final"
    },
    "metrics": {
        "executionTimeMs": 41766,
        "tokenUsage": {
            "input": 14611,
            "output": 5128,
            "total": 21794,
            "costClp": 23
        }
    },
    "usage": {
        "promptTokens": 14611,
        "candidatesTokens": 5128,
        "totalTokens": 21794,
        "estimatedCostCLP": 23
    }
};
