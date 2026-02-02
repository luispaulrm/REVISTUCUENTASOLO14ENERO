
import { Request, Response } from 'express';
import { preProcessEventos } from '../services/eventProcessor.service.js';

/**
 * Pre-Check Endpoint
 * Performs deterministic preprocessing to show V.A/VAM deduction and event structure
 * WITHOUT calling the LLM. Fast and transparent.
 */
export async function handlePreCheck(req: Request, res: Response) {
    console.log('[PRE-CHECK] New Pre-Check Request Initiated');

    try {
        const { pamJson, contratoJson } = req.body;

        if (!pamJson || !contratoJson) {
            return res.status(400).json({
                error: 'Missing required data (PAM or Contrato for pre-check)'
            });
        }

        // Run the deterministic layer
        const eventosHospitalarios = await preProcessEventos(pamJson, contratoJson);

        // Extract the V.A deduction from the first event (it's global per preProcessEventos)
        let vd = {
            tipo: "DESCONOCIDA",
            valor: 0,
            evidencia: ["No se encontraron ítems ancla suficientes."],
            cobertura: 0
        };

        if (eventosHospitalarios.length > 0 && eventosHospitalarios[0].analisis_financiero) {
            const fin = eventosHospitalarios[0].analisis_financiero;
            vd = {
                tipo: fin.unit_type || "VA",
                valor: fin.valor_unidad_inferido || 0,
                evidencia: [fin.glosa_tope],
                cobertura: eventosHospitalarios[0].analisis_financiero.metodo_validacion === 'FACTOR_ESTANDAR' ? 0.7 : 0 // This needs to be better but for now works
            };
        }

        return res.json({
            success: true,
            v_a_deducido: vd,
            eventos_detectados: eventosHospitalarios.map(e => ({
                id: e.id_evento,
                tipo: e.tipo_evento,
                prestador: e.prestador,
                copago: e.total_copago,
                bonificacion: e.total_bonificacion,
                tope_cumplido: e.analisis_financiero?.tope_cumplido
            }))
        });

    } catch (error: any) {
        console.error('[PRE-CHECK] Error:', error);
        return res.status(500).json({
            error: error.message || 'Internal Server Error during pre-check'
        });
    }
}
