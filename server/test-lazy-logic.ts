
const metaLazyPhrases = [
    "[Documento continúa",
    "[Continúa",
    "[Document continues",
    "--- FIN PARCIAL ---",
    "(Resto del documento omitido)",
    "The rest of the document",
    "(omitido por brevedad)",
    "(se omiten",
    "tabla continúa",
    "la tabla sigue",
    "pattern repeats",
    "format continues",
];

function checkIsLazy(output: string) {
    const isSuspiciouslyShort = output.length < 500;
    const triggeredMeta = metaLazyPhrases.find(phrase => output.includes(phrase));
    return isSuspiciouslyShort && triggeredMeta ? triggeredMeta : null;
}

const testCases = [
    {
        name: "Legitimate contract phrase (Long Output)",
        text: "La Isapre otorgará cobertura para consultas, exámenes, procedimientos y así sucesivamente para todas las prestaciones del plan. ".repeat(20),
        expectedLazy: false
    },
    {
        name: "Legitimate contract phrase (Short Output)",
        text: "La Isapre otorgará cobertura para consultas, exámenes, procedimientos y así sucesivamente para todas las prestaciones del plan.",
        expectedLazy: false // "y así sucesivamente" is NO LONGER in the list
    },
    {
        name: "Actual laziness (Short Output)",
        text: "La tabla continúa con formato similar para el resto del documento. <!-- END_OF_DOCUMENT -->",
        expectedLazy: true
    },
    {
        name: "Meta-lazy with long output (Legitimate reference)",
        text: "Este anexo de contrato contiene la tabla de prestaciones que continúa en la siguiente sección del manual de beneficios... ".repeat(50),
        expectedLazy: false // Long output bypasses lazy check
    }
];

testCases.forEach(tc => {
    const triggered = checkIsLazy(tc.text);
    const isLazy = !!triggered;
    console.log(`Test: ${tc.name}`);
    console.log(`Triggered: ${triggered || 'None'}`);
    console.log(`Is Lazy: ${isLazy}`);
    console.log(`Success: ${isLazy === tc.expectedLazy}`);
    console.log('---');
});
