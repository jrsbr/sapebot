import { FlagSpec } from "./types";

type AdminError = 'unclosed_quote' | 'unknown_flag' | 'missing_value';

const ADD_FLAGS: FlagSpec = {
    '-o': { hasValue: false },
    '-d': { hasValue: false },
    '-w': { hasValue: false },
    '-p': { hasValue: true },
    '-g': { hasValue: true },
    '-t': { hasValue: true },
    '-m': { hasValue: true },
}

const REMOVE_FLAGS: FlagSpec = {
    '-g': { hasValue: true },
    '-p': { hasValue: true },
    '-m': { hasValue: true },
}

const LIST_FLAGS: FlagSpec = {
    '-g': { hasValue: true },
    '-p': { hasValue: true },
}

const REPORT_FLAGS: FlagSpec = {
    '-p': { hasValue: true },
}

const SPECS: Record<string, FlagSpec> = {
    add: ADD_FLAGS,
    remove: REMOVE_FLAGS,
    list: LIST_FLAGS,
    report: REPORT_FLAGS,
}

export function tokenizeAdmin (
    raw: string,
): { tokens: string[] } | { error: AdminError} {
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

export function extractFlags(
    tokens: string[],
    spec: FlagSpec,
): { positionals: string[], flags: Map<string, string | true>} | { error: AdminError } {
    const positionals: string[] = [];
    const flags = new Map<string, string | true>();
    for (let i = 0 ; i < tokens.length ; i ++) {
        const token = tokens[i];
        const flag = spec[token];
        if (flag){
            if (flag.hasValue) {
                const value = tokens[i + 1];
                if (value === undefined || value.startsWith('-')) return { error: 'missing_value' }; 
                flags.set(token, value);
                i++;    
                continue;
            }
            flags.set(token, true);
            continue;
        }
        if (token.startsWith('-')) return { error: 'unknown_flag' };
        positionals.push(token);
    }
    return { positionals, flags };
}