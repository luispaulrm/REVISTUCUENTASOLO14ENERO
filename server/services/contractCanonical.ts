/**
 * ARCHITECTURE v11 - CANONICAL NORMALIZATION LAYER (v9.0)
 * 
 * This file defines the universal categories that every contract item
 * must be mapped to, regardless of its original Isapre naming.
 */

export enum CATEGORIA_CANONICA {
    HOSPITALARIO = 'HOSPITALARIO',
    AMBULATORIO = 'AMBULATORIO',
    MATERNIDAD = 'MATERNIDAD',
    URGENCIA = 'URGENCIA',
    ONCOLOGIA = 'ONCOLOGIA',
    DENTAL = 'DENTAL',
    LEGAL = 'LEGAL',
    FINANCIERO = 'FINANCIERO',
    ADMINISTRATIVO = 'ADMINISTRATIVO',
    SALUD_MENTAL = 'SALUD_MENTAL',
    GES = 'GES',
    CAEC = 'CAEC',
    FACTORES = 'FACTORES',
    EXCLUSION = 'EXCLUSION',
    OTRO = 'OTRO'
}

/**
 * Semantic Mapping Dictionary
 * Maps raw keywords/patterns to canonical categories.
 */
export const MAPEOS_CANONICOS: Record<string, CATEGORIA_CANONICA> = {
    // Hospitalario
    'dia cama': CATEGORIA_CANONICA.HOSPITALARIO,
    'hospitalizacion': CATEGORIA_CANONICA.HOSPITALARIO,
    'pabellon': CATEGORIA_CANONICA.HOSPITALARIO,
    'derecho sala': CATEGORIA_CANONICA.HOSPITALARIO,
    'insumos hospitalarios': CATEGORIA_CANONICA.HOSPITALARIO,

    // Ambulatorio
    'consulta': CATEGORIA_CANONICA.AMBULATORIO,
    'visita': CATEGORIA_CANONICA.AMBULATORIO,
    'laboratorio': CATEGORIA_CANONICA.AMBULATORIO,
    'examen': CATEGORIA_CANONICA.AMBULATORIO,
    'radiologia': CATEGORIA_CANONICA.AMBULATORIO,
    'ecografia': CATEGORIA_CANONICA.AMBULATORIO,
    'procedimientos': CATEGORIA_CANONICA.AMBULATORIO,

    // Maternidad
    'parto': CATEGORIA_CANONICA.MATERNIDAD,
    'cesarea': CATEGORIA_CANONICA.MATERNIDAD,
    'neonatologia': CATEGORIA_CANONICA.MATERNIDAD,
    'aborto': CATEGORIA_CANONICA.MATERNIDAD,
    'embarazo': CATEGORIA_CANONICA.MATERNIDAD,
    'obstetrica': CATEGORIA_CANONICA.MATERNIDAD,

    // Especialidades
    'quimioterapia': CATEGORIA_CANONICA.ONCOLOGIA,
    'radioterapia': CATEGORIA_CANONICA.ONCOLOGIA,
    'oncologi': CATEGORIA_CANONICA.ONCOLOGIA,
    'psicologia': CATEGORIA_CANONICA.SALUD_MENTAL,
    'psiquiatria': CATEGORIA_CANONICA.SALUD_MENTAL,
    'salud mental': CATEGORIA_CANONICA.SALUD_MENTAL,
    'dental': CATEGORIA_CANONICA.DENTAL,
    'odontologi': CATEGORIA_CANONICA.DENTAL,

    // Administrativo / Legal
    'exclusiones': CATEGORIA_CANONICA.EXCLUSION,
    'no cubre': CATEGORIA_CANONICA.EXCLUSION,
    'ley': CATEGORIA_CANONICA.LEGAL,
    'articulo': CATEGORIA_CANONICA.LEGAL,
    'dfl': CATEGORIA_CANONICA.LEGAL,
    'uf': CATEGORIA_CANONICA.FINANCIERO,
    'reajuste': CATEGORIA_CANONICA.FINANCIERO,
    'ipc': CATEGORIA_CANONICA.FINANCIERO,
    'unidad de fomento': CATEGORIA_CANONICA.FINANCIERO,
    'ges': CATEGORIA_CANONICA.GES,
    'explicit': CATEGORIA_CANONICA.GES,
    'caec': CATEGORIA_CANONICA.CAEC,
    'catastrof': CATEGORIA_CANONICA.CAEC,
    'factores': CATEGORIA_CANONICA.FACTORES,
    'riesgo': CATEGORIA_CANONICA.FACTORES
};

/**
 * Normalizes a raw string or current category to its canonical equivalent.
 */
export function getCanonicalCategory(rawText: string = '', currentCategory: string = ''): CATEGORIA_CANONICA {
    const text = (rawText + ' ' + currentCategory).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    for (const [key, category] of Object.entries(MAPEOS_CANONICOS)) {
        if (text.includes(key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
            return category;
        }
    }

    // Fallback based on typical keywords
    if (text.includes('hosp')) return CATEGORIA_CANONICA.HOSPITALARIO;
    if (text.includes('amb')) return CATEGORIA_CANONICA.AMBULATORIO;
    if (text.includes('urg')) return CATEGORIA_CANONICA.URGENCIA;

    return CATEGORIA_CANONICA.OTRO;
}
