export function tokenizeAdmin (
    raw: string,
): { tokens: string[] } | { error: 'unclosed_quote'} {
    const tokens: string[] = [];
    let currentToken = "";
    let inQuotes = false;
    const pushToken = () => {
        if (currentToken.length > 0) {
            tokens.push(currentToken);
            currentToken = "";
        }
    };

    for (const c of raw) {
        if (c === '"') {
            pushToken();
            inQuotes = !inQuotes;
            continue;
        }
        if (inQuotes) {
            currentToken += c;
            continue;
        }
        if (c === " ") {
            pushToken();
            continue;
        }
        currentToken += c;
    }

    if (currentToken.length > 0) pushToken();

    return inQuotes ? { error: 'unclosed_quote'} : { tokens };
}
