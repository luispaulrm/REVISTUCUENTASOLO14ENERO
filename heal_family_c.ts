import fs from 'fs';

function healFamilyC() {
    const targetMembers = [
        '13-CORE406-25',
        'CMBS090625',
        'MX2246050',
        'PLAN VPRLU204B2 VIDA TRES',
        'pleno 847',
        'rse500',
        'VPLU241143',
        'VPTA241079'
    ];

    targetMembers.forEach(docName => {
        const mapFile = `spatial_map_${docName}.json`;
        const assFile = `assignments_${docName}.json`;

        // Heal Map
        if (fs.existsSync(mapFile)) {
            let data = JSON.parse(fs.readFileSync(mapFile, 'utf-8'));
            if (data.rows) {
                const initialCount = data.rows.length;
                data.rows = data.rows.filter((r: any) => typeof r === 'object' && r !== null && r.row_id);
                const finalCount = data.rows.length;
                if (initialCount !== finalCount) {
                    console.log(`Healed Map ${docName}: Removed ${initialCount - finalCount} malformed rows.`);
                    fs.writeFileSync(mapFile, JSON.stringify(data, null, 2));
                }
            }
        }

        // Heal Assignments
        if (fs.existsSync(assFile)) {
            let data = JSON.parse(fs.readFileSync(assFile, 'utf-8'));
            if (data.assignments) {
                const initialCount = data.assignments.length;
                data.assignments = data.assignments.filter((a: any) =>
                    typeof a === 'object' && a !== null && a.row_id && a.column_id
                );
                const finalCount = data.assignments.length;
                if (initialCount !== finalCount) {
                    console.log(`Healed Assignments ${docName}: Removed ${initialCount - finalCount} malformed entries.`);
                    fs.writeFileSync(assFile, JSON.stringify(data, null, 2));
                }
            }
        }
    });

    console.log("Healing complete.");
}

healFamilyC();
