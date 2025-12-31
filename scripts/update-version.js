
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const versionFilePath = path.join(__dirname, '../version.ts');

try {
    let content = fs.readFileSync(versionFilePath, 'utf-8');

    // Extract current version
    const versionMatch = content.match(/export const VERSION = "v(\d+)\.(\d+)\.(\d+)";/);

    if (versionMatch) {
        let [_, major, minor, patch] = versionMatch;
        let newPatch = parseInt(patch) + 1;
        const newVersion = `v${major}.${minor}.${newPatch}`;

        // Create new timestamp using Chilean Time
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('es-CL', {
            timeZone: 'America/Santiago',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

        // formatter.format(now) returns something like "31-12-2025, 15:50" or "31/12/2025 15:50" depending on environment
        // We want strict format "DD/MM/YYYY HH:mm (Chile)"

        const parts = formatter.formatToParts(now);
        const getPart = (type) => parts.find(p => p.type === type)?.value || '';

        const day = getPart('day');
        const month = getPart('month');
        const year = getPart('year');
        const hour = getPart('hour');
        const minute = getPart('minute');

        const newTimestamp = `${day}/${month}/${year} ${hour}:${minute} (Chile)`;

        // Replace in content
        content = content.replace(
            /export const VERSION = ".*";/,
            `export const VERSION = "${newVersion}";`
        );
        content = content.replace(
            /export const LAST_MODIFIED = ".*";/,
            `export const LAST_MODIFIED = "${newTimestamp}";`
        );

        fs.writeFileSync(versionFilePath, content);
        console.log(`✅ Version updated to ${newVersion} at ${newTimestamp}`);
    } else {
        console.error('❌ Could not find version pattern in version.ts');
    }
} catch (error) {
    console.error('❌ Error updating version:', error);
}
