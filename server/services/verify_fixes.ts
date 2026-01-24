import { extractFeatureSet } from './jurisprudence/jurisprudence.fingerprint.js';
import { preProcessEventos } from './eventProcessor.service.js';

async function testFixes() {
    console.log('--- TEST 1: LABORATORY EXAM DETECTION ---');
    const labLine = {
        descripcion: "DETECCION DE ANTICUERPOS",
        bonificacion: 0,
        copago: 15000
    };
    const contract = {
        coberturas: [
            { item: "EXAMEN", cobertura: 100 }
        ]
    };
    const features = extractFeatureSet(labLine, contract);
    console.log('Features for lab line:', Array.from(features));
    if (features.has('ES_EXAMEN') && features.has('IC_BREACH')) {
        console.log('✅ Lab exam correctly identified as IC_BREACH (Cat A)');
    } else {
        console.log('❌ Lab exam detection failed');
    }

    console.log('\n--- TEST 2: UNBUNDLING (MASCARILLA) ---');
    const maskLine = {
        descripcion: "MASCARILLA QUIRURGICA",
        bonificacion: 0,
        copago: 2000
    };
    const featuresMask = extractFeatureSet(maskLine, contract);
    console.log('Features for mask line:', Array.from(featuresMask));
    if (featuresMask.has('INHERENTLY_INCLUDED') && featuresMask.has('UB_DETECTED')) {
        console.log('✅ Mask correctly identified as UNBUNDLING (Cat A)');
    } else {
        console.log('❌ Mask unbundling detection failed');
    }

    console.log('\n--- TEST 3: STRATEGIC RECLASSIFICATION ---');
    const reclassLine = {
        descripcion: "MATERIAL CLINICO GASTO NO CUBIERTO",
        bonificacion: 0,
        copago: 50000
    };
    const featuresReclass = extractFeatureSet(reclassLine, contract);
    console.log('Features for reclass line:', Array.from(featuresReclass));
    if (featuresReclass.has('STRATEGIC_RECLASSIFICATION') && featuresReclass.has('IC_BREACH')) {
        console.log('✅ Strategic Reclassification correctly identified as Cat A');
    } else {
        console.log('❌ Strategic Reclassification detection failed');
    }

    console.log('\n--- TEST 4: EVENTO UNICO GROUPING ---');
    const mockPam = {
        folios: [
            {
                folioPAM: "123",
                fechaEmision: "2024-01-20",
                desglosePorPrestador: [
                    {
                        nombrePrestador: "URGENCIA CLINICA",
                        items: [
                            { descripcion: "CONSULTA URGENCIA", copago: 12106, fecha: "2024-01-20" }
                        ]
                    }
                ]
            },
            {
                folioPAM: "124",
                fechaEmision: "2024-01-20",
                desglosePorPrestador: [
                    {
                        nombrePrestador: "CLINICA PRINCIPAL",
                        items: [
                            { descripcion: "DIA CAMA", copago: 100000, fecha: "2024-01-20" },
                            { descripcion: "DERECHO PABELLON", copago: 50000, fecha: "2024-01-20" }
                        ]
                    }
                ]
            }
        ]
    };

    const processedEvents = preProcessEventos(mockPam);
    console.log('Processed Events Count:', processedEvents.length);
    const urgencyEvent = processedEvents.find(e => e.prestador === "URGENCIA CLINICA");
    if (urgencyEvent && urgencyEvent.posible_continuidad && urgencyEvent.recomendacion_accion === "IMPUGNAR") {
        console.log('✅ Evento Único correctly identified for linking urgency to hospitalization');
    } else {
        console.log('❌ Evento Único identification failed', urgencyEvent);
    }
}

testFixes().catch(console.error);
