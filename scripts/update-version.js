
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

        // Create new timestamp
        const now = new Date();
        const day = now.getDate().toString().padStart(2, '0');
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const year = now.getFullYear();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const newTimestamp = `${day}/${month}/${year} ${hours}:${minutes} (Chile)`;

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
