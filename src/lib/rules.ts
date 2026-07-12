export interface KeywordTag {
    keyword: string;
    tag: string;
}

export interface CommandRule {
    keywordTags?: KeywordTag[];
    defaultTag?: string;
    replyTemplate?: string;
}

export interface RuleResult {
    tag: string;
    reply: string;
}

/**
 * Applies a command's configured rule to the text the user submitted
 * (e.g. the `text` option on /report). Falls back to sensible defaults
 * if no rule is configured at all, so commands work even before an
 * admin has set anything up.
 */
export function applyRule(rule: CommandRule | null | undefined, text: string | undefined): RuleResult {
    const safeText = text ?? '';
    const lowerText = safeText.toLowerCase();

    let tag = rule?.defaultTag ?? 'general';

    if (rule?.keywordTags) {
        for (const { keyword, tag: matchedTag } of rule.keywordTags) {
            if (keyword && lowerText.includes(keyword.toLowerCase())) {
                tag = matchedTag;
                break; // first match wins
            }
        }
    }

    const template = rule?.replyTemplate ?? 'Got it! Tagged as: {tag}';
    const reply = template.replace(/{tag}/g, tag).replace(/{text}/g, safeText);

    return { tag, reply };
}