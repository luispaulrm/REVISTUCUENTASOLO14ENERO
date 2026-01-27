
import { Contract } from '../../src/types';

export interface ReconstructibilityResult {
    isReconstructible: boolean;
    confidence: number; // 0-1
    reasoning: string[];
    keyFactors: {
        hasCoverageRules: boolean;
        hasExplicitCaps: boolean;
        isClosedEvent: boolean;
        isIntegralScheme: boolean; // e.g., PAD, or 100% Hospitalario
    };
}

export class ContractReconstructibilityService {

    /**
     * Evaluates if the contract and account context allow for a reconstructed audit.
     * If True, "Opacity" should be treated as "Controversy" (Cat B) or "Unjustified" (Cat A),
     * rather than "Indeterminate" (Cat Z).
     */
    static assess(contract: Contract | null, accountContext: any): ReconstructibilityResult {
        const reasoning: string[] = [];
        let score = 0;

        // 1. Check for Contract Object Existence
        if (!contract) {
            return {
                isReconstructible: false,
                confidence: 0,
                reasoning: ['No contract object provided.'],
                keyFactors: { hasCoverageRules: false, hasExplicitCaps: false, isClosedEvent: false, isIntegralScheme: false }
            };
        }

        // 2. Check for Explicit Coverage Rules (The strongest indicator)
        const hasCoverageRules = (contract.coberturas && contract.coberturas.length > 0) ||
            (contract.reglas && contract.reglas.length > 0);

        if (hasCoverageRules) {
            score += 50;
            reasoning.push('Contrato contiene reglas de cobertura explícitas.');
        } else {
            reasoning.push('Contrato carece de reglas de cobertura estructuradas (Posible Regla C-01).');
        }

        // 3. Check for specific "High Integrity" schemes (Daisy Case Logic)
        // PLE 847, or explicit mention of "100%" in critical areas
        const contractText = JSON.stringify(contract).toUpperCase();
        const isIntegralScheme = contractText.includes('100%') ||
            contractText.includes('COBERTURA TOTAL') ||
            contractText.includes('SIN TOPE') ||
            contractText.includes('PAD');

        if (isIntegralScheme) {
            score += 30;
            reasoning.push('Esquema de cobertura integral detectado (100% o similar). Permite presunción de cobertura.');
        }

        // 4. Check for Caps (Topes)
        // If we have explicit caps, we can "audit against the cap".
        const hasExplicitCaps = contractText.includes('TOPE') && /\d+\s*UF/.test(contractText);
        if (hasExplicitCaps) {
            score += 10;
            reasoning.push('Existen topes explícitos en UF verificables.');
        }

        // 5. Context Factors (Closed Event)
        // If it's a specific surgery (e.g. Apendicectomía) vs generic Long Stay
        const accountStr = JSON.stringify(accountContext || {}).toUpperCase();
        const isClosedEvent = accountStr.includes('APENDIC') ||
            accountStr.includes('COLECIST') ||
            accountStr.includes('HERNIA') ||
            accountStr.includes('PARTO') ||
            accountStr.includes('CESAREA');

        if (isClosedEvent) {
            score += 10;
            reasoning.push('Evento clínico acotado (Evento Cerrado) facilita reconstrucción.');
        }

        // THRESHOLD
        // If we have rules OR (Integral Scheme + Event), we are good.
        const isReconstructible = score >= 50;

        return {
            isReconstructible,
            confidence: score / 100,
            reasoning,
            keyFactors: {
                hasCoverageRules,
                hasExplicitCaps,
                isClosedEvent,
                isIntegralScheme
            }
        };
    }
}
