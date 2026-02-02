
import { ContractCacheService } from './contractCache.service.js';

async function run() {
    console.log('🧹 Limpiando caché de contratos canónicos...');
    try {
        const count = await ContractCacheService.clearAll();
        console.log(`✅ Éxito! ${count} archivos eliminados de la caché.`);
    } catch (err) {
        console.error('❌ Error al limpiar caché:', err);
    }
}

run();
