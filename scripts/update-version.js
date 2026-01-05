
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const versionFilePath = path.join(__dirname, '../version.ts');

try {
    // CI/CD GUARD: Skip version bump in CI environments (GitHub Actions, Render, etc.)
    if (process.env.CI || process.env.RENDER || process.env.GITHUB_ACTIONS) {
        console.log('🛑 CI/CD Environment detected. Skipping version bump and metadata update.');
        console.log('   This build will use the version defined in the commit.');
        process.exit(0);
    }

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

        // --- GIT AUTOMATION DISABLED ---
        /*
        try {
            console.log('📦 Committing and pushing version update...');
            // Need to change directory to project root for git commands
            const projectRoot = path.join(__dirname, '..');

            execSync(`git add "${versionFilePath}"`, { stdio: 'inherit', cwd: projectRoot });
            execSync(`git commit -m "chore: bump version to ${newVersion} [skip ci]"`, { stdio: 'inherit', cwd: projectRoot });
            execSync('git push', { stdio: 'inherit', cwd: projectRoot });

            console.log('🚀 Successfully pushed version update to GitHub');
        } catch (gitError) {
            console.error('⚠️ Failed to auto-push to GitHub:', gitError.message);
            // Don't fail the build script just because push failed
        }
        */
        console.log('ℹ️ Git auto-push is disabled. Please commit and push manually.');

    } else {
        console.error('❌ Could not find version pattern in version.ts');
    }
} catch (error) {
    console.error('❌ Error updating version:', error);
}
