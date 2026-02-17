import { TaxonomyResult, TaxonomySkeleton, GrupoCanonico, SubFamilia } from '../types/taxonomy.types.js';

/**
 * Service to aggregate taxonomy results into a human-readable tree ("Skeleton").
 * Groups by clinical macro-categories derived from the taxonomy.
 */
export class SkeletonService {

    public generateSkeleton(results: TaxonomyResult[]): TaxonomySkeleton {
        const root: TaxonomySkeleton = {
            name: "CUENTA CLÍNICA (VISUAL)",
            total_count: results.length,
            children: []
        };

        console.log(`[SkeletonService] Generating VISUAL skeleton for ${results.length} items.`);

        // 1. Group by Visual Section (Primary) or Semantic Category (Fallback)
        const groups = new Map<string, TaxonomyResult[]>();

        results.forEach(res => {
            // Priority: Visual Section > Semantic Group > "Otros"
            let groupKey = "Otros / No Clasificados";

            if (res.atributos && res.atributos.section) {
                // Visual Fidelity: formatting not nice, but strictly follows PDF
                groupKey = res.atributos.section.toUpperCase();
            } else if (res.grupo) {
                // Fallback to Semantic
                groupKey = `[SEMANTIC] ${res.grupo}`;
            }

            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey)!.push(res);
        });

        // 2. Build Tree Nodes (Keys in Map insertion order = PDF Order)
        for (const [sectionName, items] of groups) {
            const sectionNode: TaxonomySkeleton = {
                name: sectionName,
                total_count: items.length,
                children: []
            };

            // Optional: Sub-group by Sub-Family for readability within the section
            const subFamilies = [...new Set(items.map(i => i.sub_familia))];

            for (const sf of subFamilies) {
                const sfItems = items.filter(i => i.sub_familia === sf);
                sectionNode.children!.push({
                    name: this.formatSubFamilyName(sf),
                    total_count: sfItems.length
                });
            }

            root.children!.push(sectionNode);
        }

        return root;
    }

    private formatSubFamilyName(sf: string): string {
        switch (sf) {
            case 'FARMACOS': return "Medicamentos";
            case 'MATERIALES': return "Materiales Clínicos";
            case 'LABORATORIO': return "Laboratorio";
            case 'IMAGENOLOGIA': return "Imagenología";
            case 'ADMINISTRATIVO': return "Administrativo";
            case 'N_A': return "General / Varios";
            default: return sf;
        }
    }
}
