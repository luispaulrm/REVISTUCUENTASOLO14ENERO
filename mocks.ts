
export const CONSALUD_EJEMPLO = {
    "diseno_ux": {
        "nombre_isapre": "Consalud",
        "titulo_plan": "PLANES CORE",
        "subtitulo_plan": "CORE 106 25 (13-CORE106-25)",
        "layout": "forensic_report_v2",
        "funcionalidad": "pdf_isapre_analyzer_imperative",
        "salida_json": "strict_schema_v3_final"
    },
    "reglas": [
        {
            "PÁGINA ORIGEN": "2",
            "CÓDIGO/SECCIÓN": "IDENTIFICACIÓN DEL PLAN",
            "SUBCATEGORÍA": "NOMBRE Y CÓDIGO",
            "VALOR EXTRACTO LITERAL DETALLADO": "CORE 106 25 | Código: 13-CORE106-25"
        },
        {
            "PÁGINA ORIGEN": "2",
            "CÓDIGO/SECCIÓN": "NOTAS AL PIE (***)",
            "SUBCATEGORÍA": "VALOR UF REFERENCIAL",
            "VALOR EXTRACTO LITERAL DETALLADO": "Valor referencia calculado con el valor de la UF de $39.191, al 1 de Junio 2025"
        }
    ],
    "coberturas": [
        {
            "PRESTACIÓN CLAVE": "Dia Cama (17)",
            "MODALIDAD/RED": "OFERTA PREFERENTE",
            "TOPE LOCAL 1 (VAM/EVENTO)": "Sin Tope",
            "TOPE LOCAL 2 (ANUAL/UF)": "Sin Tope",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "40% Bonificación | Prestadores: Clínica RedSalud Santiago, Hospital Clínico Universidad de Chile (A.2) | Habitación Individual según disponibilidad (Nota A)."
        },
        {
            "PRESTACIÓN CLAVE": "Consulta Médica Y Telemedicina En Especialidades (10)",
            "MODALIDAD/RED": "OFERTA PREFERENTE",
            "TOPE LOCAL 1 (VAM/EVENTO)": "Sin Tope",
            "TOPE LOCAL 2 (ANUAL/UF)": "Sin Tope",
            "RESTRICCIÓN Y CONDICIONAMIENTO": "60% Bonificación | Paga Copago Fijo 0,19 UF (Valor ref. $7.446) en consultas descritas en letra (N) | Prestadores: Centros Médicos RedSalud (A.3), Clínica RedSalud Santiago, Hospital Clínico Universidad de Chile."
        }
    ],
    "metrics": {
        "executionTimeMs": 40154,
        "tokenUsage": {
            "input": 14527,
            "output": 5419,
            "total": 21370,
            "costClp": 24
        }
    },
    "usage": {
        "promptTokens": 14527,
        "candidatesTokens": 5419,
        "totalTokens": 21370,
        "estimatedCostCLP": 24
    }
};
