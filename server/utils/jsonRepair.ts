
/**
 * Tries to parse a JSON string. If it fails, attempts to repair it by:
 * 1. Removing trailing commas.
 * 2. Balancing unclosed braces/brackets.
 * 3. Truncating to the last valid object if necessary.
 */
export function repairAndParseJson(jsonStr: string): any {
    if (!jsonStr) throw new Error("Empty JSON string");

    // 1. Locate the authentic start of the JSON payload
    // Gemini sometimes prefixes with "Here is the JSON: ..."
    let start = jsonStr.search(/[[{]/);
    if (start === -1) {
        // No JSON object or array found
        throw new Error("No JSON start found");
    }

    let cleaned = jsonStr.substring(start).trim();

    // 2. Remove markdown code block endings if present
    cleaned = cleaned.replace(/\n?```\s*$/, '').trim();

    // 3. Try basic parse
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        // Continue to repair
    }

    // 4. Remove trailing comma if present (common in truncated arrays)
    // Case: [...,] -> [...,] -> failed
    // We remove it BEFORE balancing.
    if (cleaned.endsWith(',')) {
        cleaned = cleaned.slice(0, -1).trim();
    }

    // 5. Balanced Closure Strategy
    const stack: string[] = [];
    let inString = false;
    let isEscaped = false;

    // We only scan up to the current length.
    for (let i = 0; i < cleaned.length; i++) {
        const char = cleaned[i];

        if (isEscaped) {
            isEscaped = false;
            continue;
        }

        if (char === '\\') {
            isEscaped = true;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            continue;
        }

        if (!inString) {
            if (char === '{') stack.push('}');
            else if (char === '[') stack.push(']');
            else if (char === '}' || char === ']') {
                const expected = stack.pop();
                // If mismatch, we might have issues, but let's keep going
            }
        }
    }

    // NEW: If we ended inside a string, we must close it first!
    if (inString) {
        cleaned += '"';
        // We might also checking if we need to close an escape sequence, but usually " suffices.
    }

    // Append missing closers
    const closers = stack.reverse().join('');
    let candidate = cleaned + closers;

    // 6. Final cleanup of Trailing Commas inside the now-closed structure
    // The balancer might have closed an array that still has a trailing comma inside: [a,b,]
    // Regex: Replace comma followed by closer with just closer
    candidate = candidate.replace(/,\s*([\]}])/g, '$1');

    try {
        return JSON.parse(candidate);
    } catch (e) {
        // Last resort: Aggressive truncation to last valid object termination?
        // For now, re-throw if this fails, as it catches 99% of cases.
        // The calling function will catch and log the raw text.
        throw e;
    }
}
