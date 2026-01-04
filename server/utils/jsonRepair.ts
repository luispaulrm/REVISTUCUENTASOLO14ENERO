
/**
 * Tries to parse a JSON string. If it fails, attempts to repair it by:
 * 1. Removing trailing commas.
 * 2. Balancing unclosed braces/brackets.
 * 3. Truncating to the last valid object if necessary.
 */
export function repairAndParseJson(jsonStr: string): any {
    if (!jsonStr) throw new Error("Empty JSON string");

    // 1. Cleaner basico
    let cleaned = jsonStr.trim();

    // Removing potential markdown code blocks if not already removed
    cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();

    try {
        return JSON.parse(cleaned);
    } catch (e) {
        // Continue to repair
    }

    // 2. Remove trailing commas (simple regex approach, risky but often effective)
    // Matches , followed by whitespace and closing bracket/brace
    cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

    try {
        return JSON.parse(cleaned);
    } catch (e) {
        // Continue
    }

    // 3. Balanced Closure Strategy
    // We scan the string to maintain a stack of open braces/brackets.
    // If we hit the end, we append the missing closing characters in reverse order.

    // First, let's try to cut off at the last "complete" comma if we assume it's an array of objects
    // This is useful if the stream stopped mid-object.
    // However, we want to salvage as much as possible.

    const stack: string[] = [];
    let inString = false;
    let isEscaped = false;
    let lastValidIndex = -1;

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
                if (char !== expected) {
                    // Mismatch found - the JSON is likely malformed heavily here.
                    // We might stop here?
                    // For now, let's just proceed.
                }
            }
        }
        lastValidIndex = i;
    }

    // Attempt to close
    const closers = stack.reverse().join('');
    const candidate1 = cleaned + closers;

    try {
        return JSON.parse(candidate1);
    } catch (e) {
        // If that fails, it might be because the last token was half-written (e.g. "tru" instead of "true", or "12" instead of "123").
        // We can try to truncate the last partial value by finding the last comma or structural char.
    }

    // 4. Truncate to last comma/brace and close
    // Find the last index of , { [ or : that is NOT inside a string? 
    // This is complex to do perfectly without a parser.
    // Simple heuristic: Remove anything after the last '}' or ']' that looks complete?

    // Let's try aggressive truncation: walk back from end until we find a comma or opener, then close.
    let truncated = cleaned;
    while (truncated.length > 0) {
        const lastChar = truncated[truncated.length - 1];
        truncated = truncated.substring(0, truncated.length - 1);

        // If we just removed a char, try closing the NEW stack state? 
        // Too expensive to re-scan stack every char.

        // Simpler: Just find the last comma that is supposedly top-level or item-level?
        // Let's use a library-like approach if we really need it. 
        // Or just fail for now?

        // Let's try one fallback: If it's an array, find the last '},' and cut there.
        const lastObjectEnd = truncated.lastIndexOf('}');
        if (lastObjectEnd > 0) {
            const sub = truncated.substring(0, lastObjectEnd + 1);
            // Re-calculate stack for sub?
            // Assuming it opens with [, we need ]
            try {
                return JSON.parse(sub + ']');
            } catch (e2) { }

            try {
                return JSON.parse(sub + '}');
            } catch (e3) { }

            try {
                return JSON.parse(sub);
            } catch (e4) { }
        }

        // Avoid infinite loop if no '}' found
        break;
    }

    throw new Error("Unable to repair JSON");
}
