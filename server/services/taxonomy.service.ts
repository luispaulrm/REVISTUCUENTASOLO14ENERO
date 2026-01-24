
import { BillingItem } from '../../types.js';

export enum ZoneA {
    PABELLON = "PABELLON",
    HOSPITALIZACION = "HOSPITALIZACION",
    UCI_INTERMEDIO = "UCI_INTERMEDIO",
    URGENCIA = "URGENCIA",
    LABORATORIO = "LABORATORIO",
    IMAGENOLOGIA = "IMAGENOLOGIA",
    BANCO_SANGRE = "BANCO_SANGRE",
    HONORARIOS = "HONORARIOS",
    OTROS = "OTROS"
}

export enum FamilyB {
    PRESTACION_CLINICA = "PRESTACION_CLINICA",
    ESTADA_CAMA = "ESTADA_CAMA",
    MEDICAMENTOS = "MEDICAMENTOS",
    INSUMOS_MATERIALES = "INSUMOS_MATERIALES",
    EXAMENES = "EXAMENES",
    IMAGENOLOGIA = "IMAGENOLOGIA",
    IMPLANTES_PROTESIS = "IMPLANTES_PROTESIS",
    PAQUETES_GENERICOS = "PAQUETES_GENERICOS"
}

export interface ItemTaxonomy {
    zona: ZoneA;
    familia: FamilyB;
    subfamilia: string;
    normalizedDesc: string;
    confidence: number;
}

export class TaxonomyService {
    private static MEDICAL_KEYWORDS = /INY|AMP|SOL|GRAG|TAB|CAPS|SUSP|MG|ML|UI|UG|MCG|MEQ|G|UNID|DOSIS|SACHET|SUERO|NATRECUR|PROPO|FENT|SEVO|CLORURO|POTASIO|SODIO|GLUCOSA|DESTROSA|CEFTRIAXONA|ATROPINA|HEPARINA|KETOPROFENO|LIDOCAINA|OMEPRAZOL|PROPOFOL|MIDAZOLAM|REMIFENTANIL/i;

    private static MATERIAL_KEYWORDS = /GASA|JERINGA|GUANTE|DRENAJE|SUTURA|SONDA|CATETER|EQUIPO.FLEBO|LLAVE.3.PASOS|BRANULA|DELANTAL|PAQUETE|SABANA|MANGA|FUNDA|ELECTRODO|PARCHE|BISTURI|TUBO.ENDOTRAQUEAL|ESTILETE|CANULA.MAYO|CIRCUITO.ANESTESIA|MASCARA.LARINGEA|FILTRO|ALUSA|BANDEJA|SET.ASEO|TERMOMETRO|CALZON|CONFORT|CEPILLO|AGUJA|CURACION|PROTECTOR|CLIP|TROCAR|ENDO.*BAG|GRAPA|MALLA|HEMOVAC|FOLEY|APOSITO|TAPA|ALARGADOR|SENSOR|OXISENSOR/i;

    public static classify(item: BillingItem, section: string): ItemTaxonomy {
        const desc = (item.description || "").toUpperCase();
        const sec = (section || "").toUpperCase();

        // 1. ZONA A (Manda la sección del PDF)
        let zona = ZoneA.OTROS;
        if (/PABELLON|PBELLON|QUIRURG|ANEST|RECUPER/i.test(sec)) zona = ZoneA.PABELLON;
        else if (/U\.C\.I|U\.T\.I|INTERMEDIO|U\.C\.E/i.test(sec)) zona = ZoneA.UCI_INTERMEDIO;
        else if (/HOSPITALIZACION|HABITACION|DIA CAMA|H\/MED/i.test(sec)) zona = ZoneA.HOSPITALIZACION;
        else if (/URGENCIA|EMERGENCIA|ATENCION ABIERTA/i.test(sec)) zona = ZoneA.URGENCIA;
        else if (/LABORATORIO/i.test(sec)) zona = ZoneA.LABORATORIO;
        else if (/IMAGEN|RAYOS|SCANNER|ECOGRAFIA/i.test(sec)) zona = ZoneA.IMAGENOLOGIA;
        else if (/BANCO.*SANGRE/i.test(sec)) zona = ZoneA.BANCO_SANGRE;
        else if (/HONORARIO|VISITA|PROFESIONAL/i.test(sec)) zona = ZoneA.HONORARIOS;

        // 2. FAMILIA B (Qué es el ítem)
        let familia = FamilyB.INSUMOS_MATERIALES;
        if (/DIA CAMA|ESTANCIA|HABITACION/i.test(desc)) familia = FamilyB.ESTADA_CAMA;
        else if (this.MEDICAL_KEYWORDS.test(desc)) familia = FamilyB.MEDICAMENTOS;
        else if (this.MATERIAL_KEYWORDS.test(desc)) familia = FamilyB.INSUMOS_MATERIALES;
        else if (/STENT|PLACA|TORNILLO|PROTESIS|MARCAPASO/i.test(desc)) familia = FamilyB.IMPLANTES_PROTESIS;
        else if (/COLECISTECTOMIA|APENDICECTOMIA|CIRUGIA|PROCEDIMIENTO/i.test(desc)) familia = FamilyB.PRESTACION_CLINICA;

        // 3. SUBFAMILIA C (Fino)
        let subfamilia = "OTROS";
        if (familia === FamilyB.MEDICAMENTOS) {
            if (zona === ZoneA.PABELLON) subfamilia = "C3.1 - MEDICAMENTOS PABELLON";
            else subfamilia = "C3.2 - MEDICAMENTOS HOSPITALIZACION";
        } else if (familia === FamilyB.INSUMOS_MATERIALES) {
            if (/DELANTAL|SABANA|CAMPO|ESTERIL/i.test(desc)) subfamilia = "C4.1 - EPP_ROPA_ESTERIL";
            else if (/JERINGA|AGUJA|TAPA|ALARGADOR|BRANULA|LLAVE/i.test(desc)) subfamilia = "C4.2 - VENOPUNCION_ADMON";
            else if (/CLIP|TROCAR|ENDO.*BAG|SUTURA/i.test(desc)) subfamilia = "C4.5 - QUIRURGICO_ESPECIFICO";
        }

        return {
            zona,
            familia,
            subfamilia,
            normalizedDesc: desc.trim(),
            confidence: 0.95
        };
    }

    /**
     * V-01 (Incompatibilidad semántica): No aprons in meds, no ceftriaxones in materials.
     */
    public static validateIntegrity(tax: ItemTaxonomy): boolean {
        const isMed = tax.familia === FamilyB.MEDICAMENTOS;
        const isMat = tax.familia === FamilyB.INSUMOS_MATERIALES;

        if (isMed && this.MATERIAL_KEYWORDS.test(tax.normalizedDesc)) return false;
        if (isMat && this.MEDICAL_KEYWORDS.test(tax.normalizedDesc)) return false;

        return true;
    }
}
