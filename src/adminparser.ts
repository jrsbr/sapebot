import { FlagSpec, AdminError, AdminCommand } from "./types";

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

export function parseAdminCommand(
    tokens: string[],
): AdminCommand | { error: AdminError } {
    const sub = tokens[1];
    const spec = SPECS[sub];
    if (!spec) return { error: 'unknown_subcommand' };

    const result = extractFlags(tokens.slice(2), spec);
    if ('error' in result) return result;
    const { flags } = result;

    if (sub === 'add') {
        const descricao = flags.get('-m');
        if (typeof descricao !== 'string') return { error: 'missing_description' };

        const pessoa = flags.get('-p');
        if (typeof pessoa !== 'string') return { error: 'missing_target' };

        const periodicidades = [
            ['-o', 'once'],
            ['-w', 'weekly'],
            ['-d', 'daily'],
        ] as const;
        const present = periodicidades.filter(([flag]) => flags.has(flag));
        if (present.length > 1) return { error: 'periodicity_conflict' };
        if (present.length === 0) return { error: 'missing_periodicity' };
        const periodicidade = present[0][1];

        const grupoValue = flags.get('-g');
        const grupo = typeof grupoValue === 'string' ? grupoValue : '';

        const dataValue = flags.get('-t');
        let data = '';
        if (typeof dataValue === 'string') {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dataValue)) return { error: 'invalid_date' };
            data = dataValue;
        }

        return { sub: 'add', pessoa, descricao, periodicidade, grupo, data };
    }

    return { error: 'unknown_subcommand' };
}