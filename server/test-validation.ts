import dotenv from 'dotenv';
import { ValidationService } from './services/validation.service.js';

// Load env vars
dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY;

if (!API_KEY) {
    console.error("❌ No API KEY found in .env");
    process.exit(1);
}

// Mock Data
const MOCK_BILL_TEXT = "CLINICA INDISA\nCuenta N° 123456\nFecha: 12/12/2025\n\nDETALLE DE CUENTA\n1.0 | 3010 HA | DIA CAMA UCI | $500.000\nTOTAL: $500.000";
const MOCK_PAM_TEXT = "ISAPRE CRUZBLANCA\nBONO DE ATENCION MEDICA\nFOLIO: 99887766\nBonificación: $80.000\nCopago: $20.000";
const MOCK_MIXED_TEXT = "CLINICA INDISA\nCuenta N° 123456\nDETALLE DE CUENTA\n1.0 | 3010 | DIA CAMA | $500.000\n...\nISAPRE CRUZBLANCA\nBONO DE ATENCION MEDICA\nFOLIO: 99887766";
const MOCK_MEME_TEXT = "MEME: When you write code and it works on the first try.\n(Funny cat picture)";

// We need to encode these as base64 to simulate an image upload for the service
const encode = (str: string) => Buffer.from(str).toString('base64');

async function runTest() {
    console.log("🚀 Starting Validation Service Test...\n");
    const service = new ValidationService(API_KEY!);

    // TEST 1: Valid CUENTA
    console.log("--- TEST 1: Valid CUENTA (Expected: Valid) ---");
    const res1 = await service.validateDocumentType(encode(MOCK_BILL_TEXT), "text/plain", "CUENTA");
    console.log(`Result: ${res1.isValid ? '✅ PASS' : '❌ FAIL'} | Detected: ${res1.detectedType} | Reason: ${res1.reason}\n`);

    // TEST 2: Valid PAM
    console.log("--- TEST 2: Valid PAM (Expected: Valid) ---");
    const res2 = await service.validateDocumentType(encode(MOCK_PAM_TEXT), "text/plain", "PAM");
    console.log(`Result: ${res2.isValid ? '✅ PASS' : '❌ FAIL'} | Detected: ${res2.detectedType} | Reason: ${res2.reason}\n`);

    // TEST 3: Invalid (Meme as Contract)
    console.log("--- TEST 3: Invalid Meme as CONTRATO (Expected: INVALID) ---");
    const res3 = await service.validateDocumentType(encode(MOCK_MEME_TEXT), "text/plain", "CONTRATO");
    console.log(`Result: ${!res3.isValid ? '✅ PASS' : '❌ FAIL'} | Detected: ${res3.detectedType} | Reason: ${res3.reason}\n`);

    // TEST 4: Mismatch (PAM as CUENTA)
    console.log("--- TEST 4: Mismatch PAM as CUENTA (Expected: INVALID) ---");
    const res4 = await service.validateDocumentType(encode(MOCK_PAM_TEXT), "text/plain", "CUENTA");
    console.log(`Result: ${!res4.isValid ? '✅ PASS' : '❌ FAIL'} | Detected: ${res4.detectedType} | Reason: ${res4.reason}\n`);

    // TEST 5: Mixed Document (Cuenta + PAM) as CUENTA
    console.log("--- TEST 5: Mixed (Cuenta + PAM) as CUENTA (Expected: Valid) ---");
    const res5 = await service.validateDocumentType(encode(MOCK_MIXED_TEXT), "text/plain", "CUENTA");
    console.log(`Result: ${res5.isValid ? '✅ PASS' : '❌ FAIL'} | Detected: ${res5.detectedType} | Reason: ${res5.reason}\n`);
}

runTest();
