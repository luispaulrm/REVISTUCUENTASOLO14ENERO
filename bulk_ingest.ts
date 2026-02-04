import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * BULK INGEST SCRIPT
 * 
 * Purpose: Install the 28 Rescued Forensic Contracts into the Application Cache.
 * Mechanism: 
 * 1. Read the PDF to calculate the exact SHA256 hash (as the app does).
 * 2. Save the Forensic JSON to `server/cache/canonicos/<HASH>.json`.
 * 
 * This turns the "Rescued Contracts" into "Live Application Knowledge".
 */

const SOURCE_DIR = process.cwd();
const CACHE_DIR = path.join(process.cwd(), 'server', 'cache', 'canonicos');

// Ensure cache exists
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function calculateHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

const SEARCH_DIRS = [
    process.cwd(),
    path.join(process.cwd(), 'agent', 'skills', 'canonizar-contrato-salud'),
    path.join(process.cwd(), 'server', 'knowledge')
];

// Recursive search helper
function findFileInDirs(dirs: string[], filename: string): string | null {
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        const fullPath = path.join(dir, filename);
        if (fs.existsSync(fullPath)) return fullPath;

        // Try fuzzy match in this dir
        const files = fs.readdirSync(dir);
        const match = files.find(f => f.toLowerCase() === filename.toLowerCase());
        if (match) return path.join(dir, match);
    }
    return null;
}

// Map of canonical names (from audit packages) to potential PDF filenames
function findPdfForContract(contractName: string): string | null {
    // 1. Try exact name + .pdf
    let found = findFileInDirs(SEARCH_DIRS, `${contractName}.pdf`);
    if (found) return found;

    // 2. Try cleaned name (remove '13-' prefix sometimes used in names but not files)
    if (contractName.startsWith('13-')) {
        found = findFileInDirs(SEARCH_DIRS, `${contractName.replace('13-', '')}.pdf`);
        if (found) return found;
    }

    // 3. Try partial/fuzzy match across all dirs
    for (const dir of SEARCH_DIRS) {
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));
        const match = files.find(f => {
            const fNorm = f.toLowerCase().replace('.pdf', '');
            const cNorm = contractName.toLowerCase();
            return fNorm.includes(cNorm) || cNorm.includes(fNorm);
        });
        if (match) return path.join(dir, match);
    }

    return null;
}

async function runoptions() {
    console.log('🚀 Starting Bulk Ingestion of 28 Contracts...\n');

    // Get all audit packages
    const pkgFiles = fs.readdirSync(SOURCE_DIR).filter(f => f.startsWith('audit_package_') && f.endsWith('.json'));

    let successCount = 0;
    let failCount = 0;

    for (const pkgFile of pkgFiles) {
        const contractName = pkgFile.replace('audit_package_', '').replace('_v1.5.0.json', '');

        // 1. Load the Forensic Package
        const pkgContent = fs.readFileSync(path.join(SOURCE_DIR, pkgFile), 'utf-8');
        const pkgJson = JSON.parse(pkgContent);

        // 2. Find the Source PDF to get the Hash
        const pdfPath = findPdfForContract(contractName);

        if (!pdfPath) {
            console.warn(`⚠️  Skipping [${contractName}]: Source PDF not found for hash calculation.`);
            failCount++;
            continue;
        }

        // 3. Calculate Hash
        const pdfBuffer = fs.readFileSync(pdfPath);
        const hash = calculateHash(pdfBuffer);

        // 4. Inject into Cache
        const targetPath = path.join(CACHE_DIR, `${hash}.json`);

        // Enhance package with "cached: true" as the service does
        const cacheEntry = {
            ...pkgJson,
            cached: true,
            ingestedAt: new Date().toISOString(),
            originalFilename: path.basename(pdfPath)
        };

        fs.writeFileSync(targetPath, JSON.stringify(cacheEntry, null, 2));

        console.log(`✅ Installed [${contractName}] -> ${hash.substring(0, 12)}...json`);
        successCount++;
    }

    console.log(`\n🏁 Ingestion Complete.`);
    console.log(`   Installed: ${successCount}`);
    console.log(`   Skipped:   ${failCount}`);
    console.log(`   Target Dir: ${CACHE_DIR}`);
}

runoptions();
