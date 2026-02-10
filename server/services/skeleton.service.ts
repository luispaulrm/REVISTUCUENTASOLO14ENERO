import { TaxonomyResult, TaxonomySkeleton, GrupoCanonico, SubFamilia } from '../types/taxonomy.types.js';

/**
 * Service to aggregate taxonomy results into a human-readable tree ("Skeleton").
 * Groups by clinical macro-categories derived from the taxonomy.
 */
export class SkeletonService {

    public generateSkeleton(results: TaxonomyResult[]): TaxonomySkeleton {
        const root: TaxonomySkeleton = {
            name: "CUENTA CLÍNICA",
            total_count: results.length,
            children: []
        };

        // 1. Defined categories based on User's model image
        const categories = [
            { name: "Hospitalización", grupos: ["HOTELERA"] as GrupoCanonico[] },
            { name: "Exámenes", subfamilias: ["LABORATORIO", "IMAGENOLOGIA"] as SubFamilia[] },
            { name: "Procedimientos", grupos: ["PABELLON"] as GrupoCanonico[] },
            { name: "Medicamentos y Materiales", grupos: ["INSUMOS"] as GrupoCanonico[], subfamilias: ["FARMACOS", "MATERIALES"] as SubFamilia[] },
            { name: "Honorarios Médicos", grupos: ["HONORARIOS"] as GrupoCanonico[] }
        ];

        console.log(`[SkeletonService] Generating skeleton for ${results.length} items.`);

        // 2. Build the tree
        for (const cat of categories) {
            const catNode: TaxonomySkeleton = {
                name: cat.name,
                total_count: 0,
                children: []
            };

            // Filter items for this category
            const items = results.filter(r => {
                if (cat.grupos && cat.grupos.includes(r.grupo)) return true;
                if (cat.subfamilias && cat.subfamilias.includes(r.sub_familia as any)) return true;
                return false;
            });

            if (items.length > 0) {
                catNode.total_count = items.length;

                // Group by Sub-Family within category if relevant
                const subFamilies = [...new Set(items.map(i => i.sub_familia))];
                for (const sf of subFamilies) {
                    const sfItems = items.filter(i => i.sub_familia === sf);
                    catNode.children!.push({
                        name: this.formatSubFamilyName(sf),
                        total_count: sfItems.length
                    });
                }

                root.children!.push(catNode);
            }
        }

        // 3. Add "Otros" for remaining items
        const handledIds = new Set(root.children!.flatMap(c => c.children || []).flatMap(() => [])); // Simplified
        // Real check:
        const handledItemsCount = root.children!.reduce((acc, c) => acc + c.total_count, 0);
        if (handledItemsCount < results.length) {
            root.children!.push({
                name: "Otros / No Clasificados",
                total_count: results.length - handledItemsCount
            });
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
